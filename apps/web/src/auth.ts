import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { Context, Next } from "hono";
import { z } from "zod";
import { createLogger } from "@selfwright/shared-logger";

const logger = createLogger("web-auth");

const LoginBody = z.object({ password: z.string().min(1).max(1024) });

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;
const FAILURE_DELAY_MS_DEFAULT = 500;
function getFailureDelayMs(): number {
  const raw = process.env["SELFWRIGHT_WEB_FAILURE_DELAY_MS"];
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return FAILURE_DELAY_MS_DEFAULT;
}
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const LOCKOUT_KEY = "default";

// Per-session write throttle (ADR 0019): at most this many write actions per
// rolling window. Read-only navigation is unaffected — only POST write routes
// call recordWrite/checkWriteThrottle.
const WRITE_THROTTLE_LIMIT = 10;
const WRITE_THROTTLE_WINDOW_MS = 60 * 1000;

type Session = { createdAt: number; csrfToken: string };
type LockoutEntry = { count: number; lockedUntil: number; lastFailureAt: number };
type WriteThrottleEntry = { windowStart: number; count: number };

export type Credential = { salt: string; hash: string };

// Public (unauthenticated) routes — the single source of truth for which paths
// bypass authMiddleware. FF-WEB-1 asserts every write route is absent from
// this set (docs/adr/0019-web-dashboard-v1.1-write-actions.md).
export const PUBLIC_PATHS: ReadonlySet<string> = new Set(["/login", "/brand-icon.png"]);

export const sessionStore = new Map<string, Session>();
const lockoutStore = new Map<string, LockoutEntry>();
const writeThrottleStore = new Map<string, WriteThrottleEntry>();

/** Reset in-memory state — for use in tests only. */
export function resetAuthState(): void {
  sessionStore.clear();
  lockoutStore.clear();
  writeThrottleStore.clear();
}

function deriveKey(password: string, salt: Buffer | string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, (err, key) => {
      if (err !== null) reject(err);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<Credential> {
  const saltBuf = randomBytes(16);
  const hashBuf = await deriveKey(password, saltBuf);
  return {
    salt: saltBuf.toString("hex"),
    hash: hashBuf.toString("hex"),
  };
}

export async function verifyPassword(
  password: string,
  credential: Credential,
): Promise<boolean> {
  const saltBuf = Buffer.from(credential.salt, "hex");
  const storedHash = Buffer.from(credential.hash, "hex");
  const derived = await deriveKey(password, saltBuf);
  return timingSafeEqual(derived, storedHash);
}

export async function saveCredential(
  dataDir: string,
  credential: Credential,
): Promise<void> {
  const credPath = join(dataDir, "web", "credentials.json");
  await mkdir(dirname(credPath), { recursive: true });
  await writeFile(credPath, JSON.stringify(credential, null, 2) + "\n", "utf-8");
}

export async function loadCredential(dataDir: string): Promise<Credential | null> {
  // Env override takes priority: "salt:hash" hex format
  const envOverride = process.env["SELFWRIGHT_WEB_PASSWORD_HASH"];
  if (envOverride !== undefined && envOverride.length > 0) {
    const colonIdx = envOverride.indexOf(":");
    if (colonIdx > 0) {
      const salt = envOverride.slice(0, colonIdx);
      const hash = envOverride.slice(colonIdx + 1);
      if (salt.length > 0 && hash.length > 0) {
        return { salt, hash };
      }
    }
  }

  const credPath = join(dataDir, "web", "credentials.json");
  try {
    const raw = await readFile(credPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "salt" in parsed &&
      "hash" in parsed &&
      typeof (parsed as Record<string, unknown>)["salt"] === "string" &&
      typeof (parsed as Record<string, unknown>)["hash"] === "string"
    ) {
      return {
        salt: (parsed as { salt: string; hash: string }).salt,
        hash: (parsed as { salt: string; hash: string }).hash,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function isLocked(): boolean {
  const entry = lockoutStore.get(LOCKOUT_KEY);
  if (entry === undefined) return false;
  return entry.lockedUntil > Date.now();
}

// Sliding-expiry decay (renewable-lock DoS fix): a burst of failures locks
// for LOCKOUT_DURATION_MS as before, but the counter itself is not
// permanent. If the gap since the *last* failure exceeds LOCKOUT_DURATION_MS
// — which is always true once a triggered lockout has fully expired, since
// lockedUntil == lastFailureAt + LOCKOUT_DURATION_MS — the next failure
// starts a fresh count of 1 instead of re-triggering the lock immediately.
function recordFailure(): void {
  const now = Date.now();
  const existing = lockoutStore.get(LOCKOUT_KEY);
  const isStale = existing !== undefined && now - existing.lastFailureAt > LOCKOUT_DURATION_MS;
  const count = existing === undefined || isStale ? 1 : existing.count + 1;
  const lockedUntil = count >= LOCKOUT_THRESHOLD ? now + LOCKOUT_DURATION_MS : 0;
  lockoutStore.set(LOCKOUT_KEY, { count, lockedUntil, lastFailureAt: now });
}

function clearLockout(): void {
  lockoutStore.delete(LOCKOUT_KEY);
}

export function createSession(): string {
  const id = randomBytes(32).toString("hex");
  sessionStore.set(id, { createdAt: Date.now(), csrfToken: randomBytes(32).toString("hex") });
  return id;
}

/**
 * Return the CSRF token for a valid session, generating one if the session
 * predates this field (defensive — createSession always sets it now). Returns
 * null if the session id is invalid.
 */
export function getCsrfToken(sessionId: string): string | null {
  const session = sessionStore.get(sessionId);
  if (session === undefined) return null;
  return session.csrfToken;
}

/**
 * Constant-time comparison of a submitted CSRF token against the session's
 * token. Length is checked first (timingSafeEqual requires equal-length
 * buffers) — a length mismatch already fails closed before any timing-
 * sensitive comparison happens.
 */
export function verifyCsrfToken(sessionId: string, submitted: string): boolean {
  const expected = getCsrfToken(sessionId);
  if (expected === null) return false;
  const expectedBuf = Buffer.from(expected, "utf-8");
  const submittedBuf = Buffer.from(submitted, "utf-8");
  if (expectedBuf.length !== submittedBuf.length) return false;
  return timingSafeEqual(expectedBuf, submittedBuf);
}

/**
 * Per-session write throttle: at most WRITE_THROTTLE_LIMIT writes per
 * WRITE_THROTTLE_WINDOW_MS. Checks and records atomically (single synchronous
 * call, same "reserve before the expensive part" shape as the login lockout)
 * so concurrent requests can't all pass the check before any of them records.
 * Returns true if the write is allowed (and has been recorded), false if the
 * session is over the limit (caller should respond 429).
 */
export function checkWriteThrottle(sessionId: string): boolean {
  const now = Date.now();
  const entry = writeThrottleStore.get(sessionId);
  if (entry === undefined || now - entry.windowStart >= WRITE_THROTTLE_WINDOW_MS) {
    writeThrottleStore.set(sessionId, { windowStart: now, count: 1 });
    return true;
  }
  if (entry.count >= WRITE_THROTTLE_LIMIT) return false;
  entry.count += 1;
  return true;
}

export function getSessionId(cookieHeader: string | null): string | null {
  if (cookieHeader === null) return null;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const name = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (name === "sw_session") return value;
  }
  return null;
}

export function isValidSession(id: string): boolean {
  const session = sessionStore.get(id);
  if (session === undefined) return false;
  if (Date.now() - session.createdAt > SESSION_MAX_AGE_MS) {
    sessionStore.delete(id);
    return false;
  }
  return true;
}

export function deleteSession(id: string): void {
  sessionStore.delete(id);
}

function sessionCookieValue(id: string): string {
  return `sw_session=${id}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${COOKIE_MAX_AGE_S}`;
}

function clearCookieValue(): string {
  return `sw_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export function checkOrigin(c: Context): boolean {
  const origin = c.req.header("origin");
  // Fail-closed: absent or empty Origin is rejected on mutation routes.
  // Modern browsers always send Origin on same-origin form POSTs; SameSite=Strict
  // is the primary CSRF defence — this is defence-in-depth.
  if (origin === undefined || origin === "") return false;
  // Host header is mandatory in HTTP/1.1 real traffic; fall back to the URL host
  // so Hono's in-process test utility (which omits Host) behaves identically to
  // production. The host is compared to the Origin's host after URL parsing.
  const host = c.req.header("host") ?? new URL(c.req.url).host;
  try {
    const originHost = new URL(origin).host;
    return originHost === host;
  } catch {
    return false;
  }
}

// "same-origin", not "no-referrer": a real browser (proven by T5.10's
// Playwright E2E spec, apps/web-ui/e2e/cockpit.e2e.ts -- the first thing in
// this codebase to ever drive the login form with an actual browser instead
// of a test harness setting whatever Origin header it likes) sends
// `Origin: null` on the login form's POST navigation when the page that
// served the form has `Referrer-Policy: no-referrer` -- browsers null out
// Origin together with Referer under a "no-referrer" policy, per the Fetch
// standard's request-Origin-header algorithm. checkOrigin() then correctly,
// and fail-closed, rejects that as a mismatch: 403 on every real-browser
// login attempt. "same-origin" still suppresses the Referer header on any
// cross-origin navigation (the actual leakage this header exists to
// prevent) while leaving Origin intact for the same-origin form POST this
// page always submits to itself.
const LOGIN_SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "Cache-Control": "no-store",
  "Referrer-Policy": "same-origin",
};

export function handleLoginGet(): Response {
  return new Response(loginPageHtml(), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", ...LOGIN_SECURITY_HEADERS },
  });
}

export async function handleLoginPost(c: Context, dataDir: string): Promise<Response> {
  if (!checkOrigin(c)) {
    return c.text("Forbidden", 403);
  }

  if (isLocked()) {
    await delay(getFailureDelayMs());
    return new Response(loginPageHtml("Login unavailable — try again later"), {
      status: 401,
      headers: { "Content-Type": "text/html; charset=utf-8", ...LOGIN_SECURITY_HEADERS },
    });
  }

  // Speculatively reserve an attempt BEFORE the expensive scrypt verify.
  // Prevents N concurrent wrong-password POSTs from all passing isLocked()
  // before any of them calls recordFailure(). Cleared via clearLockout() on
  // success. Must remain synchronous (no await between isLocked and recordFailure).
  recordFailure();

  const body = await c.req.parseBody();
  const parsed = LoginBody.safeParse(body);
  if (!parsed.success) {
    // Missing or oversized password field — treat as invalid without running scrypt.
    await delay(getFailureDelayMs());
    return new Response(loginPageHtml("Invalid password"), {
      status: 401,
      headers: { "Content-Type": "text/html; charset=utf-8", ...LOGIN_SECURITY_HEADERS },
    });
  }
  const password = parsed.data.password;

  const credential = await loadCredential(dataDir);
  if (credential === null) {
    logger.warn("Login: no credentials configured", { outcome: "failure" });
    await delay(getFailureDelayMs());
    return new Response(loginPageHtml("Invalid password"), {
      status: 401,
      headers: { "Content-Type": "text/html; charset=utf-8", ...LOGIN_SECURITY_HEADERS },
    });
  }

  const ok = await verifyPassword(password, credential);
  if (!ok) {
    logger.info("Login", { outcome: "failure" });
    await delay(getFailureDelayMs());
    return new Response(loginPageHtml("Invalid password"), {
      status: 401,
      headers: { "Content-Type": "text/html; charset=utf-8", ...LOGIN_SECURITY_HEADERS },
    });
  }

  clearLockout();
  const sessionId = createSession();
  logger.info("Login", { outcome: "success" });

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": sessionCookieValue(sessionId),
    },
  });
}

export function handleLogout(c: Context): Response {
  if (!checkOrigin(c)) {
    return c.text("Forbidden", 403);
  }
  const sessionId = getSessionId(c.req.header("cookie") ?? null);
  if (sessionId !== null) {
    deleteSession(sessionId);
  }
  logger.info("Logout");
  // Use Hono context methods so pending headers (Cache-Control: no-store from
  // authMiddleware) are merged into the response instead of being discarded.
  c.header("Set-Cookie", clearCookieValue());
  return c.redirect("/login", 302);
}

export async function authMiddleware(c: Context, next: Next) {
  const path = new URL(c.req.url).pathname;

  if (PUBLIC_PATHS.has(path)) {
    return next();
  }

  const sessionId = getSessionId(c.req.header("cookie") ?? null);
  if (sessionId === null || !isValidSession(sessionId)) {
    logger.info("Auth", { outcome: "unauthenticated", method: c.req.method, path });
    // /api/* is a JSON contract (T5.9): a fetch() caller can't follow an HTML
    // redirect the way a browser navigation can, so unauthenticated JSON
    // requests get a JSON 401 instead of the SSR pages' redirect-to-/login.
    // Same session-validity check, same posture — only the response shape
    // differs by content type.
    if (path.startsWith("/api/")) {
      c.header("Cache-Control", "no-store");
      return c.json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
    }
    return c.redirect("/login", 302);
  }

  logger.info("Auth", { outcome: "success", method: c.req.method, path });
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
  return next();
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const LOGIN_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f5f5f5;color:#1a1a1a}
.card{background:#fff;padding:2rem;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);width:100%;max-width:360px}
h1{font-size:1.25rem;font-weight:600;margin-bottom:1.5rem}
label{display:block;font-size:.875rem;font-weight:500;margin-bottom:.25rem}
input{display:block;width:100%;padding:.5rem .75rem;font-size:1rem;border:1px solid #ccc;border-radius:4px;margin-bottom:1rem;background:#fff}
button{width:100%;padding:.625rem;font-size:1rem;background:#1a1a1a;color:#fff;border:none;border-radius:4px;cursor:pointer}
.error{background:#fef2f2;color:#b91c1c;padding:.5rem .75rem;border-radius:4px;margin-bottom:1rem;font-size:.875rem}
`.trim();

function loginPageHtml(error?: string): string {
  const errorBlock =
    error !== undefined
      ? `<p class="error">${escHtml(error)}</p>`
      : "";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Selfwright — Login</title><link rel="icon" type="image/png" href="/brand-icon.png"><style>${LOGIN_CSS}</style></head><body><div class="card"><img src="/brand-icon.png" alt="Selfwright logo" style="display:block;width:64px;height:64px;border-radius:50%;margin:0 auto 1rem"><h1>Selfwright</h1><form method="POST" action="/login">${errorBlock}<label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" autofocus required><button type="submit">Sign in</button></form></div></body></html>`;
}
