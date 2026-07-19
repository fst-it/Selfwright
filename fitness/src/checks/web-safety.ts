// FF-WEB-1: Web dashboard safety invariants (ADR 0016, extended by ADR 0019,
// adapted for the T5.10 clean cutover to the React cockpit)
// (a) server.ts explicitly passes hostname: "127.0.0.1" to serve()
// (b) auth middleware is registered before route handlers in app.ts
// (c) no external hosts in templates; raw() from hono/html never used in apps/web
// (d) authenticated responses set Cache-Control: no-store (in auth middleware)
// (e) every write route (app.post(...) other than /login, /logout) is POST-only
//     (no app.get for the same path) and absent from auth.ts's PUBLIC_PATHS
// (f) write-route handlers call verifyCsrfToken(
// (g) SSR write-route form templates embed the CSRF token (name="csrf_token")
//     — N/A post-cutover by design (T5.10 deleted every SSR form; the check
//     logic is kept, unmodified, because it degrades safely: with zero
//     non-/api/* write routes, its guard clause is vacuously satisfied
//     rather than silently skipped. If an SSR form write route is ever
//     reintroduced, this clause immediately re-activates and enforces the
//     same invariant it always has.)
// (h) JSON /api/* write routes read the CSRF token via getCsrfHeaderToken(
// (i) [T5.10] zero SSR page GET routes remain in app.ts: the only literal
//     (non-wildcard, non-/api/*) GETs are /login and /brand-icon.png; every
//     other path is served by the cockpit's static host + SPA fallback
// (j) [T5.10] apps/web-ui/src never imports @selfwright/core,
//     @selfwright/adapter-storage-git, or the full @selfwright/shared-config
//     barrel — the cockpit consumes ONLY /api/* (the @selfwright/api-contract
//     package, plus shared-config's schema-only "/schemas" subpath, are the
//     one sanctioned exception: pure zod schemas with zero I/O, safe to
//     bundle into a browser build)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { CheckResult } from "./shared.js";

const CHECK_NAME = "FF-WEB-1: web dashboard safety invariants (ADR 0016)";
const WEB_SRC = join("apps", "web", "src");
const WEB_UI_SRC = join("apps", "web-ui", "src");

// Allowed URL prefixes in templates (literal host strings)
const ALLOWED_URL_PATTERNS = [
  /https?:\/\/localhost/,
  /https?:\/\/127\.0\.0\.1/,
  /https?:\/\/[a-zA-Z0-9-]+\.ts\.net/,
];

function isAllowedUrl(url: string): boolean {
  return ALLOWED_URL_PATTERNS.some((re) => re.test(url));
}

function walkSrc(dir: string, files: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    try {
      const stat = statSync(full);
      if (stat.isDirectory() && entry !== "node_modules" && entry !== "dist" && entry !== ".turbo" && entry !== "__tests__") {
        walkSrc(full, files);
      } else if (
        (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
        !entry.endsWith(".d.ts") &&
        !entry.endsWith(".test.ts")
      ) {
        files.push(full);
      }
    } catch {
      // skip
    }
  }
  return files;
}

export function checkWebSafety(repoRoot: string): CheckResult {
  const violations: string[] = [];

  // (a) server.ts must contain hostname: "127.0.0.1" in the serve() call
  const serverPath = join(repoRoot, WEB_SRC, "server.ts");
  let serverSrc: string;
  try {
    serverSrc = readFileSync(serverPath, "utf-8");
  } catch {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `apps/web/src/server.ts not found — web package not implemented`,
    };
  }

  // Require the literal inside the serve() call, not just anywhere in the file
  // (a stale comment earlier in the file must not satisfy this check).
  const serveCallIdx = serverSrc.indexOf("serve(");
  const inServeCall =
    serveCallIdx >= 0 && serverSrc.slice(serveCallIdx).includes(`hostname: "127.0.0.1"`);
  if (!inServeCall) {
    violations.push(
      `server.ts: missing explicit hostname: "127.0.0.1" inside serve() call (ADR 0016: binding all interfaces when hostname is omitted)`,
    );
  }

  // (b) auth middleware registered before routes in app.ts
  const appPath = join(repoRoot, WEB_SRC, "app.ts");
  let appSrc: string;
  try {
    appSrc = readFileSync(appPath, "utf-8");
  } catch {
    violations.push(`apps/web/src/app.ts not found`);
    appSrc = "";
  }

  if (appSrc.length > 0) {
    // Anchor on the exact literal so an unrelated app.use() earlier in the file
    // does not satisfy the check while the real auth middleware appears after routes.
    const authMiddlewareIdx = appSrc.indexOf(`app.use("*", authMiddleware)`);
    const firstRouteIdx = Math.min(
      ...[`app.get(`, `app.post(`].map((s) => {
        const i = appSrc.indexOf(s);
        return i < 0 ? Infinity : i;
      }),
    );
    if (authMiddlewareIdx < 0) {
      violations.push(`app.ts: app.use("*", authMiddleware) not found`);
    } else if (authMiddlewareIdx > firstRouteIdx) {
      violations.push(
        `app.ts: app.use("*", authMiddleware) registered AFTER first route handler — must be first`,
      );
    }
  }

  // (c) scan apps/web/src for external hosts and raw() usage
  const srcFiles = walkSrc(join(repoRoot, WEB_SRC));
  const URL_RE = /https?:\/\/[^\s"'`<>]+/g;

  for (const file of srcFiles) {
    const relPath = relative(repoRoot, file);
    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    // Check for raw() usage (forbidden escape hatch per ADR 0016)
    if (/\braw\s*\(/.test(content)) {
      violations.push(`${relPath}: uses raw() — forbidden for data-dir content (ADR 0016)`);
    }

    // Check for external host URLs
    let match: RegExpExecArray | null;
    URL_RE.lastIndex = 0;
    while ((match = URL_RE.exec(content)) !== null) {
      const url = match[0];
      if (!isAllowedUrl(url)) {
        violations.push(`${relPath}: external host URL not in allowlist: ${url}`);
      }
    }
  }

  // (d) auth.ts must set Cache-Control: no-store
  const authPath = join(repoRoot, WEB_SRC, "auth.ts");
  let authSrc: string;
  try {
    authSrc = readFileSync(authPath, "utf-8");
  } catch {
    violations.push(`apps/web/src/auth.ts not found`);
    authSrc = "";
  }

  if (authSrc.length > 0 && !authSrc.includes(`"Cache-Control", "no-store"`)) {
    violations.push(
      `auth.ts: authenticated responses must set Cache-Control: no-store via c.header("Cache-Control", "no-store")`,
    );
  }

  // (e) write routes (any app.post(...)/app.put(...) other than /login) must
  // be absent from PUBLIC_PATHS — positive assertions per ADR 0019, since an
  // absence-of-GET grep alone would pass a route nobody ever registered.
  // app.put(...) was added for T5.9's PUT /api/settings (a JSON contract
  // full-document replace) — this widens detection, it does not narrow it.
  //
  // The "no matching GET" collision check applies only to app.post(...)
  // routes: ADR 0019's two SSR write actions are pure write endpoints with no
  // corresponding read view at the same URL, so a GET appearing there would
  // mean the route silently doubles as an unauthenticated-shaped read path.
  // A PUT write route pairing with a GET at the *same* path (e.g.
  // GET+PUT /api/settings) is the opposite: standard, intentional REST
  // (read the resource / replace the resource), not a regression to catch.
  if (appSrc.length > 0) {
    const postPathRe = /app\.post\("([^"]+)"/g;
    const putPathRe = /app\.put\("([^"]+)"/g;
    const postWritePaths: string[] = [];
    const putWritePaths: string[] = [];
    let postMatch: RegExpExecArray | null;
    while ((postMatch = postPathRe.exec(appSrc)) !== null) {
      const path = postMatch[1];
      if (path !== undefined && path !== "/login" && path !== "/logout") {
        postWritePaths.push(path);
      }
    }
    let putMatch: RegExpExecArray | null;
    while ((putMatch = putPathRe.exec(appSrc)) !== null) {
      const path = putMatch[1];
      if (path !== undefined) putWritePaths.push(path);
    }
    const writePaths = [...postWritePaths, ...putWritePaths];
    if (writePaths.length === 0) {
      violations.push(
        `app.ts: no write routes (app.post(...)/app.put(...)) found beyond /login and /logout — ADR 0019 expects the two write actions to be registered`,
      );
    }
    for (const path of postWritePaths) {
      if (appSrc.includes(`app.get("${path}"`)) {
        violations.push(`app.ts: write route ${path} also has a GET handler — POST write routes must be POST-only`);
      }
    }

    if (authSrc.length > 0) {
      const publicPathsIdx = authSrc.indexOf("PUBLIC_PATHS");
      const publicPathsBlock =
        publicPathsIdx >= 0 ? authSrc.slice(publicPathsIdx, authSrc.indexOf(";", publicPathsIdx)) : "";
      for (const path of writePaths) {
        if (publicPathsBlock.includes(`"${path}"`)) {
          violations.push(`auth.ts: write route ${path} must not be listed in PUBLIC_PATHS`);
        }
      }
    }

    // T5.9: the JSON /api/* write routes verify CSRF the same way
    // (verifyCsrfToken) but read the token from a request header instead of
    // a hidden form field (there is no HTML form to carry one) — see
    // apps/web/src/api/shared.ts. SSR form routes and API routes are
    // therefore checked separately for (f)/(g)/(h) below.
    const formWritePaths = writePaths.filter((p) => !p.startsWith("/api/"));
    const apiWritePaths = writePaths.filter((p) => p.startsWith("/api/"));

    // (f) every write route's handler must call verifyCsrfToken( — one per
    // write route, counted across all of apps/web/src (not just
    // routes/actions.ts) since T5.9 added API write handlers under
    // apps/web/src/api/. auth.ts is excluded from the scan: it's where
    // verifyCsrfToken is DEFINED (`export function verifyCsrfToken(...) {`),
    // and that definition line itself matches `verifyCsrfToken\(` — counting
    // it would let a real call-site regression hide behind the definition's
    // own match (caught by manual negative-control testing before this
    // exclusion was added).
    let csrfCallCount = 0;
    for (const file of srcFiles) {
      if (file === authPath) continue;
      let content: string;
      try {
        content = readFileSync(file, "utf-8");
      } catch {
        continue;
      }
      csrfCallCount += (content.match(/verifyCsrfToken\(/g) ?? []).length;
    }
    if (writePaths.length > 0 && csrfCallCount < writePaths.length) {
      violations.push(
        `apps/web/src: expected at least ${String(writePaths.length)} verifyCsrfToken( call(s) (one per write route), found ${String(csrfCallCount)}`,
      );
    }

    // (g) SSR write-route form templates must embed the CSRF token as a
    // hidden field — only the non-/api/ write routes, since JSON routes have
    // no form (checked instead by (h)).
    let csrfFieldCount = 0;
    for (const file of srcFiles) {
      let content: string;
      try {
        content = readFileSync(file, "utf-8");
      } catch {
        continue;
      }
      csrfFieldCount += (content.match(/name="csrf_token"/g) ?? []).length;
    }
    if (formWritePaths.length > 0 && csrfFieldCount < formWritePaths.length) {
      violations.push(
        `apps/web/src: expected at least ${String(formWritePaths.length)} form(s) with name="csrf_token" (one per SSR write route), found ${String(csrfFieldCount)}`,
      );
    }

    // (h) JSON /api/* write routes must read the CSRF token via the shared
    // header-token helper (getCsrfHeaderToken) — one call per API write
    // route, the JSON-contract equivalent of (g)'s hidden-field count.
    // apps/web/src/api/shared.ts is excluded from the scan for the same
    // reason auth.ts is excluded from (f): it's where getCsrfHeaderToken is
    // DEFINED, and that definition line itself matches the call regex.
    const apiSharedPath = join(repoRoot, WEB_SRC, "api", "shared.ts");
    let csrfHeaderCallCount = 0;
    for (const file of srcFiles) {
      if (file === apiSharedPath) continue;
      let content: string;
      try {
        content = readFileSync(file, "utf-8");
      } catch {
        continue;
      }
      csrfHeaderCallCount += (content.match(/getCsrfHeaderToken\(/g) ?? []).length;
    }
    if (apiWritePaths.length > 0 && csrfHeaderCallCount < apiWritePaths.length) {
      violations.push(
        `apps/web/src: expected at least ${String(apiWritePaths.length)} getCsrfHeaderToken( call(s) (one per /api/* write route), found ${String(csrfHeaderCallCount)}`,
      );
    }

    // (i) [T5.10 cutover] zero SSR page GET routes remain across the whole
    // apps/web/src tree — not just app.ts. A route registered in a sub-router
    // file, a helper module, or via app.on("GET"|"get", ...) would evade a
    // single-file scan. The regex covers:
    //   app.get("path")  /  router.get("path")
    //   app.on("GET"|"get", "path")  /  router.on("GET"|"get", "path")
    // The cockpit catch-all ("*") registered inside static.ts's
    // mountCockpitStaticHost uses a wildcard literal, not matched by this regex.
    const GET_ROUTE_RE =
      /(?:app|router)\.get\("([^"]+)"|(?:app|router)\.on\(\s*["'](?:GET|get)["']\s*,\s*"([^"]+)"/g;
    const ALLOWED_LITERAL_GETS = new Set(["/login", "/brand-icon.png", "*"]);
    for (const srcFile of srcFiles) {
      const srcFileRelPath = relative(repoRoot, srcFile);
      let fileSrc: string;
      try {
        fileSrc = readFileSync(srcFile, "utf-8");
      } catch {
        continue;
      }
      GET_ROUTE_RE.lastIndex = 0;
      let getMatch: RegExpExecArray | null;
      while ((getMatch = GET_ROUTE_RE.exec(fileSrc)) !== null) {
        const path = getMatch[1] ?? getMatch[2];
        if (path === undefined) continue;
        if (ALLOWED_LITERAL_GETS.has(path)) continue;
        if (path.startsWith("/api/")) continue;
        violations.push(
          `${srcFileRelPath}: unexpected GET route "${path}" — SSR page routes were deleted in the T5.10 clean cutover; only /login, /brand-icon.png, and /api/* GETs are allowed here`,
        );
      }
    }
  }

  // (j) [T5.10] apps/web-ui/src must never import @selfwright/core,
  // @selfwright/adapter-storage-git, or the full @selfwright/shared-config
  // barrel — the cockpit consumes ONLY /api/*. @selfwright/api-contract and
  // @selfwright/shared-config/schemas (pure zod, zero I/O) are the sanctioned
  // exceptions.
  const webUiFiles = walkSrc(join(repoRoot, WEB_UI_SRC));
  const FORBIDDEN_IMPORT_RE =
    /from\s+["'](@selfwright\/core|@selfwright\/adapter-storage-git|@selfwright\/shared-config)(?!\/schemas)(?:\/[^"']*)?["']/g;
  for (const file of webUiFiles) {
    const relPath = relative(repoRoot, file).split("\\").join("/");
    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    FORBIDDEN_IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FORBIDDEN_IMPORT_RE.exec(content)) !== null) {
      violations.push(
        `${relPath}: imports "${m[1]}" directly — apps/web-ui may only consume /api/* (via @selfwright/api-contract or @selfwright/shared-config/schemas), never core/adapter packages`,
      );
    }
  }

  if (violations.length > 0) {
    return { name: CHECK_NAME, passed: false, details: violations.join("\n") };
  }
  return { name: CHECK_NAME, passed: true };
}
