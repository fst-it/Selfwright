import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../app.js";
import {
  hashPassword,
  verifyPassword,
  resetAuthState,
  sessionStore,
  loadCredential,
} from "../auth.js";

// ── fixture helpers ──────────────────────────────────────────────────────────

function makeDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-web-test-"));
  // Required empty dirs so routes don't crash
  for (const sub of ["applications", "pipeline", "content/digests", "coaching/drills", "web"]) {
    mkdirSync(join(dir, sub), { recursive: true });
  }
  return dir;
}

function writeCredentials(dataDir: string, salt: string, hash: string): void {
  writeFileSync(
    join(dataDir, "web", "credentials.json"),
    JSON.stringify({ salt, hash }),
  );
}

// ── setup ────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = makeDataDir();
  resetAuthState();
  delete process.env["SELFWRIGHT_WEB_PASSWORD_HASH"];
  process.env["SELFWRIGHT_WEB_FAILURE_DELAY_MS"] = "0";
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env["SELFWRIGHT_WEB_PASSWORD_HASH"];
  delete process.env["SELFWRIGHT_WEB_FAILURE_DELAY_MS"];
});

// ── credential round-trip ────────────────────────────────────────────────────

describe("credential round-trip", () => {
  it("hashes and verifies a passphrase", async () => {
    const cred = await hashPassword("hunter2");
    expect(cred.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(cred.hash).toMatch(/^[0-9a-f]{128}$/);
    expect(await verifyPassword("hunter2", cred)).toBe(true);
    expect(await verifyPassword("wrong", cred)).toBe(false);
  });

  it("env override SELFWRIGHT_WEB_PASSWORD_HASH is read by loadCredential", async () => {
    const cred = await hashPassword("s3cr3t");
    process.env["SELFWRIGHT_WEB_PASSWORD_HASH"] = `${cred.salt}:${cred.hash}`;
    const loaded = await loadCredential(tmpDir);
    if (loaded === null) throw new Error("expected credential from env override");
    expect(await verifyPassword("s3cr3t", loaded)).toBe(true);
  });

  it("loadCredential returns null when credentials file is absent and no env override", async () => {
    const loaded = await loadCredential(tmpDir);
    expect(loaded).toBeNull();
  });
});

// ── unauthenticated redirect ─────────────────────────────────────────────────

describe("unauthenticated access", () => {
  it("GET /pipeline → 302 /login with no data body", async () => {
    const app = createApp(tmpDir);
    const res = await app.request("/pipeline");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
    const body = await res.text();
    expect(body).toBe("");
  });

  it("GET / → 302 /login", async () => {
    const app = createApp(tmpDir);
    const res = await app.request("/");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });
});

// ── login ────────────────────────────────────────────────────────────────────

describe("login", () => {
  it("wrong password → 401 with generic message", async () => {
    const cred = await hashPassword("correct");
    writeCredentials(tmpDir, cred.salt, cred.hash);
    const app = createApp(tmpDir);
    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://localhost" },
      body: "password=wrong",
    });
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).toContain("Invalid password");
  });

  it("5 wrong attempts → lockout (6th attempt returns lockout message)", async () => {
    const cred = await hashPassword("correct");
    writeCredentials(tmpDir, cred.salt, cred.hash);
    const app = createApp(tmpDir);

    for (let i = 0; i < 5; i++) {
      await app.request("/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://localhost" },
        body: "password=wrong",
      });
    }
    // 6th attempt hits lockout
    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://localhost" },
      body: "password=correct",
    });
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).toContain("unavailable");
  });

  it("correct password → 302 redirect with session cookie containing required flags", async () => {
    const cred = await hashPassword("correct");
    writeCredentials(tmpDir, cred.salt, cred.hash);
    const app = createApp(tmpDir);
    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://localhost" },
      body: "password=correct",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    const cookie = res.headers.get("set-cookie");
    expect(cookie).not.toBeNull();
    expect(cookie).toContain("sw_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=2592000");
  });

  it("POST /login with mismatched Origin → 403", async () => {
    const cred = await hashPassword("correct");
    writeCredentials(tmpDir, cred.salt, cred.hash);
    const app = createApp(tmpDir);
    const res = await app.request("/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Host: "127.0.0.1:8787",
        Origin: "https://evil.example.com",
      },
      body: "password=correct",
    });
    expect(res.status).toBe(403);
  });
});

// ── authenticated session ────────────────────────────────────────────────────

describe("authenticated session", () => {
  async function login(app: ReturnType<typeof createApp>, dataDir: string): Promise<string> {
    const cred = await hashPassword("correct");
    writeCredentials(dataDir, cred.salt, cred.hash);
    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://localhost" },
      body: "password=correct",
    });
    const cookie = res.headers.get("set-cookie");
    if (!cookie) throw new Error("no set-cookie header");
    const match = /sw_session=([^;]+)/.exec(cookie);
    if (!match) throw new Error("no sw_session in cookie");
    return `sw_session=${match[1]}`;
  }

  it("authenticated GET /pipeline → 200 with Cache-Control: no-store", async () => {
    const app = createApp(tmpDir);
    const cookie = await login(app, tmpDir);
    const res = await app.request("/pipeline", {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("POST /logout clears session — subsequent request redirects to login", async () => {
    const app = createApp(tmpDir);
    const cookie = await login(app, tmpDir);

    const logoutRes = await app.request("/logout", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "http://localhost" },
    });
    expect(logoutRes.status).toBe(302);
    expect(logoutRes.headers.get("location")).toBe("/login");

    // Session must be gone
    const afterLogout = await app.request("/pipeline", {
      headers: { Cookie: cookie },
    });
    expect(afterLogout.status).toBe(302);
    expect(afterLogout.headers.get("location")).toBe("/login");
  });

  it("POST /logout with mismatched Origin → 403", async () => {
    const app = createApp(tmpDir);
    const cookie = await login(app, tmpDir);
    const res = await app.request("/logout", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Host: "127.0.0.1:8787",
        Origin: "https://evil.example.com",
      },
    });
    expect(res.status).toBe(403);
    // Session must still be valid after rejected logout
    expect(sessionStore.size).toBeGreaterThan(0);
  });
});

// ── CSRF: absent Origin rejects ───────────────────────────────────────────────

describe("CSRF: absent Origin fails closed", () => {
  it("POST /login with absent Origin → 403", async () => {
    const app = createApp(tmpDir);
    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "password=anything",
    });
    expect(res.status).toBe(403);
  });

  it("POST /logout with absent Origin → 403", async () => {
    const cred = await hashPassword("correct");
    writeCredentials(tmpDir, cred.salt, cred.hash);
    const app = createApp(tmpDir);
    const loginRes = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://localhost" },
      body: "password=correct",
    });
    const cookie = loginRes.headers.get("set-cookie") ?? "";
    const match = /sw_session=([^;]+)/.exec(cookie);
    const sessionCookie = match !== null ? `sw_session=${match[1]}` : "";

    const res = await app.request("/logout", {
      method: "POST",
      headers: { Cookie: sessionCookie },
    });
    expect(res.status).toBe(403);
    expect(sessionStore.size).toBeGreaterThan(0);
  });
});

// ── lockout: concurrent request race ─────────────────────────────────────────

describe("lockout: concurrent requests", () => {
  it("N concurrent wrong-password POSTs — only first LOCKOUT_THRESHOLD get to verify; rest are locked out", async () => {
    const LOCKOUT_THRESHOLD = 5;
    const N = 20;
    const cred = await hashPassword("correct");
    writeCredentials(tmpDir, cred.salt, cred.hash);
    const app = createApp(tmpDir);

    const bodies = await Promise.all(
      Array.from({ length: N }, async () => {
        const res = await app.request("/login", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://localhost" },
          body: "password=wrong",
        });
        return res.text();
      }),
    );
    const lockedCount = bodies.filter((b) => b.includes("unavailable")).length;

    // At least N - LOCKOUT_THRESHOLD responses must be locked-out rejections.
    expect(lockedCount).toBeGreaterThanOrEqual(N - LOCKOUT_THRESHOLD);
  });
});

// ── lockout: decay ────────────────────────────────────────────────────────────

describe("lockout: decay (renewable-lock DoS fix)", () => {
  const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

  afterEach(() => {
    vi.useRealTimers();
  });

  it("after the lockout window fully expires, a single stale failure does not immediately re-lock", async () => {
    const cred = await hashPassword("correct");
    writeCredentials(tmpDir, cred.salt, cred.hash);
    const app = createApp(tmpDir);

    for (let i = 0; i < 5; i++) {
      await app.request("/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://localhost" },
        body: "password=wrong",
      });
    }
    const lockedRes = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://localhost" },
      body: "password=wrong",
    });
    expect(await lockedRes.text()).toContain("unavailable");

    // Jump the clock past the lockout window without faking setTimeout —
    // the SELFWRIGHT_WEB_FAILURE_DELAY_MS=0 override still resolves via the
    // real event loop.
    const realNow = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(realNow + LOCKOUT_DURATION_MS + 1000);

    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://localhost" },
      body: "password=wrong",
    });
    const body = await res.text();
    expect(body).not.toContain("unavailable");
    expect(body).toContain("Invalid password");
  });

  it("5-in-window burst still locks even with the decay model in place", async () => {
    const cred = await hashPassword("correct");
    writeCredentials(tmpDir, cred.salt, cred.hash);
    const app = createApp(tmpDir);

    for (let i = 0; i < 5; i++) {
      await app.request("/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://localhost" },
        body: "password=wrong",
      });
    }
    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://localhost" },
      body: "password=correct",
    });
    expect(await res.text()).toContain("unavailable");
  });

  it("a successful login clears lockout state entirely — a later burst still needs the full threshold to lock", async () => {
    const cred = await hashPassword("correct");
    writeCredentials(tmpDir, cred.salt, cred.hash);
    const app = createApp(tmpDir);

    for (let i = 0; i < 3; i++) {
      await app.request("/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://localhost" },
        body: "password=wrong",
      });
    }
    const okRes = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://localhost" },
      body: "password=correct",
    });
    expect(okRes.status).toBe(302);

    for (let i = 0; i < 4; i++) {
      const res = await app.request("/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://localhost" },
        body: "password=wrong",
      });
      expect(await res.text()).not.toContain("unavailable");
    }
  });
});

// ── Cache-Control: no-store on raw-Response paths ────────────────────────────

describe("Cache-Control: no-store on all authenticated paths", () => {
  async function login(app: ReturnType<typeof createApp>, dataDir: string): Promise<string> {
    const cred = await hashPassword("correct");
    writeCredentials(dataDir, cred.salt, cred.hash);
    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://localhost" },
      body: "password=correct",
    });
    const cookie = res.headers.get("set-cookie") ?? "";
    const match = /sw_session=([^;]+)/.exec(cookie);
    if (!match) throw new Error("no sw_session in set-cookie");
    return `sw_session=${match[1]}`;
  }

  it("404 response carries Cache-Control: no-store", async () => {
    // Post-cutover (T5.10), an unmatched non-/api/* GET serves the cockpit's
    // SPA shell (200), not a 404 — that's the standard SPA-hosting pattern
    // (client-side routing owns 404s for its own paths). A genuine 404 now
    // only ever comes from an unmatched /api/* route.
    const app = createApp(tmpDir);
    const cookie = await login(app, tmpDir);
    const res = await app.request("/api/does-not-exist", { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("500 error response carries Cache-Control: no-store", async () => {
    const app = createApp(tmpDir);
    // POST, not GET: post-cutover (T5.10) createApp already registers a
    // catch-all GET "*" route (the cockpit's SPA fallback) ahead of
    // anything a test appends afterward, so a GET test route added here
    // would never be reached. No POST wildcard exists, so a POST route
    // registered on this exact, otherwise-unclaimed path is matched normally.
    app.post("/api/__test-error__", () => { throw new Error("forced"); });
    const cookie = await login(app, tmpDir);
    const res = await app.request("/api/__test-error__", { method: "POST", headers: { Cookie: cookie } });
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("POST /logout redirect carries Cache-Control: no-store", async () => {
    const app = createApp(tmpDir);
    const cookie = await login(app, tmpDir);
    const res = await app.request("/logout", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "http://localhost" },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

// ── login page security headers (F11) ────────────────────────────────────────

describe("login page anti-clickjacking and cache headers", () => {
  it("GET /login → X-Frame-Options: DENY and Cache-Control: no-store", async () => {
    const app = createApp(tmpDir);
    const res = await app.request("/login");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("GET /login → Referrer-Policy is same-origin, not no-referrer (a real browser nulls Origin on the form's own POST under no-referrer, which checkOrigin then fail-closed-rejects -- found via the T5.10 Playwright E2E spec)", async () => {
    const app = createApp(tmpDir);
    const res = await app.request("/login");
    expect(res.headers.get("referrer-policy")).toBe("same-origin");
  });

  it("POST /login with wrong password → X-Frame-Options: DENY and Cache-Control: no-store", async () => {
    const cred = await hashPassword("correct");
    writeCredentials(tmpDir, cred.salt, cred.hash);
    const app = createApp(tmpDir);
    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://localhost" },
      body: "password=wrong",
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

// ── defence-in-depth headers ─────────────────────────────────────────────────

describe("defence-in-depth headers on authenticated pages", () => {
  async function login(app: ReturnType<typeof createApp>, dataDir: string): Promise<string> {
    const cred = await hashPassword("correct");
    writeCredentials(dataDir, cred.salt, cred.hash);
    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://localhost" },
      body: "password=correct",
    });
    const cookie = res.headers.get("set-cookie") ?? "";
    const match = /sw_session=([^;]+)/.exec(cookie);
    if (!match) throw new Error("no sw_session in set-cookie");
    return `sw_session=${match[1]}`;
  }

  it("authenticated page carries X-Content-Type-Options, X-Frame-Options, Referrer-Policy", async () => {
    const app = createApp(tmpDir);
    const cookie = await login(app, tmpDir);
    const res = await app.request("/", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });
});

// ── login page brand logo ────────────────────────────────────────────────────

describe("login page brand logo", () => {
  it("GET /login → HTML includes brand favicon link and logo img", async () => {
    const app = createApp(tmpDir);
    const res = await app.request("/login");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(`rel="icon"`);
    expect(body).toContain(`href="/brand-icon.png"`);
    expect(body).toContain(`src="/brand-icon.png"`);
  });
});
