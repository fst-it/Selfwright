import { join } from "node:path";
import type { Context } from "hono";
import { API_CONTRACT_VERSION, MetaResponseSchema } from "@selfwright/api-contract";
import { getCsrfToken, getSessionId } from "../auth.js";
import { tryReadFile } from "../utils.js";
import { apiOk } from "./shared.js";

async function readPlatformVersion(repoRoot: string): Promise<string> {
  const raw = await tryReadFile(join(repoRoot, "package.json"));
  if (raw === null) return "unknown";
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof (parsed as Record<string, unknown>)["version"] === "string"
    ) {
      return (parsed as { version: string }).version;
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * GET /api/meta — contract version + platform version + the caller's CSRF
 * token (design requirement #2: cheap, helps the cockpit; also doubles as the
 * "service-status placeholder" the task named — a single lightweight
 * always-available endpoint covers both needs).
 */
export async function getMetaRoute(c: Context): Promise<Response> {
  const repoRoot = process.cwd();
  const platformVersion = await readPlatformVersion(repoRoot);
  const sessionId = getSessionId(c.req.header("cookie") ?? null);
  // /api/meta sits behind authMiddleware like every other /api/* route, so a
  // request only ever reaches this handler with a valid session — sessionId
  // is never null here in practice. The null branch is kept only because
  // getSessionId's return type is string | null regardless of call site.
  /* v8 ignore next -- unreachable: authMiddleware guarantees a valid session before this handler runs */
  const csrfToken = sessionId !== null ? getCsrfToken(sessionId) : null;

  const body = MetaResponseSchema.parse({
    contractVersion: API_CONTRACT_VERSION,
    platformVersion,
    status: "ok",
    csrfToken,
  });
  return apiOk(c, body);
}
