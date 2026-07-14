import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createLogger } from "@selfwright/shared-logger";
import {
  authMiddleware,
  handleLoginGet,
  handleLoginPost,
  handleLogout,
} from "./auth.js";
import { mountCockpitStaticHost } from "./static.js";
import { getMetaRoute } from "./api/meta.js";
import { getOverviewApiRoute } from "./api/overview.js";
import { getInboxRoute } from "./api/inbox.js";
import { listApplicationsRoute, updateStatusApiRoute } from "./api/applications.js";
import { getQueueRoute, promoteQueueEntryRoute, dismissQueueEntryRoute } from "./api/queue.js";
import { getCoachingApiRoute, addDebriefApiRoute } from "./api/coaching.js";
import { getContentApiRoute } from "./api/content.js";
import { getReportingApiRoute } from "./api/reporting.js";
import { getSettingsRoute, putSettingsRoute } from "./api/settings.js";
import { getScanTargetsRoute, putScanTargetsRoute } from "./api/scan-targets.js";

const logger = createLogger("web-app");

export function createApp(dataDir: string): Hono {
  const app = new Hono();

  // Auth middleware registered first — runs before all route handlers.
  // Skips /login; sets Cache-Control: no-store on authenticated responses.
  app.use("*", authMiddleware);

  // Public: login / logout
  app.get("/login", () => handleLoginGet());
  app.post("/login", (c) => handleLoginPost(c, dataDir));
  app.post("/logout", (c) => handleLogout(c));

  // Public: brand favicon (no PII — safe pre-auth)
  const iconPath = fileURLToPath(new URL("../assets/brand-icon-dark.png", import.meta.url));
  app.get("/brand-icon.png", async () => {
    try {
      const data = await readFile(iconPath);
      return new Response(data, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=3600",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });

  // ── /api/* — typed JSON contract for the cockpit (T5.9) ────────────────────
  // Same authMiddleware (registered above, before all routes) and same
  // CSRF/throttle/origin/audited-commit posture as the SSR write actions —
  // see apps/web/src/api/shared.ts for the header-based CSRF mechanism.
  app.get("/api/meta", (c) => getMetaRoute(c));
  app.get("/api/overview", (c) => getOverviewApiRoute(c, dataDir));
  app.get("/api/inbox", (c) => getInboxRoute(c, dataDir));
  app.get("/api/applications", (c) => listApplicationsRoute(c, dataDir));
  app.post("/api/applications/:id/status", (c) => updateStatusApiRoute(c, dataDir));
  app.get("/api/queue", (c) => getQueueRoute(c, dataDir));
  app.post("/api/queue/:id/promote", (c) => promoteQueueEntryRoute(c, dataDir));
  app.post("/api/queue/:id/dismiss", (c) => dismissQueueEntryRoute(c, dataDir));
  app.get("/api/coaching", (c) => getCoachingApiRoute(c, dataDir));
  app.post("/api/debriefs", (c) => addDebriefApiRoute(c, dataDir));
  app.get("/api/content", (c) => getContentApiRoute(c, dataDir));
  app.get("/api/reporting", (c) => getReportingApiRoute(c, dataDir));
  app.get("/api/settings", (c) => getSettingsRoute(c, dataDir));
  app.put("/api/settings", (c) => putSettingsRoute(c, dataDir));
  app.get("/api/scan-targets", (c) => getScanTargetsRoute(c, dataDir));
  app.put("/api/scan-targets", (c) => putScanTargetsRoute(c, dataDir));

  // ── Cockpit static host + SPA fallback (T5.10 clean cutover) ────────────────
  // Serves apps/web-ui's built bundle at / for every remaining authenticated
  // GET (client routes like /pipeline, /queue, etc. all render the same SPA
  // shell — react-router takes over from there). Must be registered after
  // every /api/* route above so those keep matching first.
  mountCockpitStaticHost(app);

  // Generic 404 — use c.text() so pending headers from authMiddleware are applied.
  // /api/* gets the same consistent JSON error envelope as every other
  // /api/* response (design requirement #4) instead of the SSR pages' plain text.
  app.notFound((c) => {
    const path = new URL(c.req.url).pathname;
    logger.info("404", { method: c.req.method, path });
    if (path.startsWith("/api/")) {
      c.header("Cache-Control", "no-store");
      return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    }
    return c.text("Not found", 404);
  });

  // Generic 500 — use c.text() so pending headers from authMiddleware are applied.
  // Never echo err.message to an /api/* client (design requirement #4: no
  // stack traces or internals) — only the fixed generic message, same as SSR.
  app.onError((err, c) => {
    logger.error("Unhandled error", { message: err.message });
    const path = new URL(c.req.url).pathname;
    if (path.startsWith("/api/")) {
      c.header("Cache-Control", "no-store");
      return c.json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong" } }, 500);
    }
    return c.text("Something went wrong", 500);
  });

  return app;
}
