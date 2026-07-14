import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// apps/web (Hono) serves the built bundle at / with SPA fallback — see
// docs/adr (cutover) and apps/web/src/static.ts. Base stays "/" (served from
// the app's own origin root, not a sub-path or CDN).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    // Local `vite dev` proxies /api/* to the Hono server (apps/web) so the
    // cockpit can be developed without a full production build. Not used in
    // production — the built bundle is served by apps/web directly.
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
