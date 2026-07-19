import { serve } from "@hono/node-server";
import { createLogger } from "@selfwright/shared-logger";
import { createApp } from "./app.js";

const logger = createLogger("web-server");

const dataDir = process.env["SELFWRIGHT_DATA_DIR"];
if (!dataDir) {
  process.stderr.write("Error: SELFWRIGHT_DATA_DIR environment variable is not set\n");
  process.exit(1);
}

const port = parseInt(process.env["SELFWRIGHT_WEB_PORT"] ?? "8787", 10);
const app = createApp(dataDir);

serve({
  fetch: app.fetch,
  port,
  hostname: "127.0.0.1",
});

logger.info("Server started", { port, hostname: "127.0.0.1" });
