// Static host + SPA fallback for the built React cockpit (T5.10 clean
// cutover). apps/web-ui builds to apps/web-ui/dist; this server serves that
// bundle at / and falls back to index.html for client-side (react-router)
// routes so a browser refresh on e.g. /pipeline still works. Registered
// AFTER authMiddleware and every /api/* route in app.ts, so:
//   - an unauthenticated request never reaches a static file or the SPA
//     shell (authMiddleware already redirected to /login for non-PUBLIC_PATHS)
//   - a request for a real built asset (JS/CSS/images under /assets/*, or
//     "/" itself, which serveStatic resolves to index.html via its own
//     directory-index behavior) is served with the correct Content-Type
//   - anything else that isn't /api/* (a client route like /pipeline or
//     /queue) serves the SPA shell (index.html) with 200 so react-router can
//     take over — the standard SPA-hosting pattern
//   - anything else that IS /api/* and reached this point is genuinely
//     unmatched by every registered /api/* route above; c.notFound() hands
//     it to app.ts's app.notFound() handler for the existing JSON 404
//     envelope, rather than wrongly serving HTML for an API 404
import { serveStatic } from "@hono/node-server/serve-static";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Hono } from "hono";

// Relative to this server process's CWD (apps/web — how `pnpm start` and the
// Windows Scheduled Task both invoke it; @hono/node-server's serveStatic
// does not support an absolute root).
const WEB_UI_DIST = "../web-ui/dist";

export function mountCockpitStaticHost(app: Hono): void {
  app.use("*", serveStatic({ root: WEB_UI_DIST }));

  app.get("*", async (c) => {
    const path = new URL(c.req.url).pathname;
    if (path.startsWith("/api/")) return c.notFound();

    const indexPath = join(WEB_UI_DIST, "index.html");
    const html = await readFile(indexPath, "utf-8").catch(() => null);
    if (html === null) {
      c.header("Cache-Control", "no-store");
      return c.text(
        "Cockpit build not found — run `pnpm --filter @selfwright/web-ui build` first",
        500,
      );
    }
    c.header("Cache-Control", "no-store");
    return c.html(html);
  });
}
