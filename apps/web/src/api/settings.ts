import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Context } from "hono";
import {
  readSettingsRawText,
  parseSettings,
  stringifySettings,
  writeSettingsFile,
  commitDataDirFile,
  SETTINGS_REL,
} from "@selfwright/adapter-storage-git";
import { SettingsUpdateRequestSchema, SettingsUpdateResponseSchema } from "@selfwright/api-contract";
import { createLogger } from "@selfwright/shared-logger";
import { checkOrigin, checkWriteThrottle, getSessionId, verifyCsrfToken } from "../auth.js";
import { withWriteLock } from "../write-lock.js";
import { apiError, apiOk, getCsrfHeaderToken, handleCommitFailure } from "./shared.js";

const logger = createLogger("web-api-settings");

/**
 * GET /api/settings — the validated settings.yml document (defaults to {}
 * when the file is absent). A present-but-corrupt file (unparseable or
 * schema-invalid) is surfaced as a clear error instead of silently serving
 * defaults, so the cockpit never looks like settings were reset.
 */
export async function getSettingsRoute(c: Context, dataDir: string): Promise<Response> {
  const raw = await readSettingsRawText(dataDir);
  const result = parseSettings(raw);
  if (result.status === "corrupt") {
    return apiError(
      c,
      "DATA_CORRUPT",
      "settings.yml exists but is corrupt (unparseable or fails validation) -- fix it manually",
      500,
    );
  }
  return apiOk(c, result.status === "ok" ? result.settings : {});
}

/**
 * PUT /api/settings — full-document replace of settings.yml, validated by
 * the same SettingsSchema the file itself is read with (shared-config),
 * written through the same audited git-commit path as the other two v1.1
 * writes (ADR 0019: read -> validate -> write -> commit -> fail-closed
 * revert). Designed additively: T5.11 extends SettingsSchema with more
 * fields; this endpoint does not need to change when that happens.
 */
export async function putSettingsRoute(c: Context, dataDir: string): Promise<Response> {
  if (!checkOrigin(c)) return apiError(c, "FORBIDDEN_ORIGIN", "Forbidden", 403);

  const sessionId = getSessionId(c.req.header("cookie") ?? null);
  if (sessionId === null) return apiError(c, "UNAUTHORIZED", "Unauthorized", 401);

  if (!verifyCsrfToken(sessionId, getCsrfHeaderToken(c))) {
    return apiError(c, "FORBIDDEN_CSRF", "Forbidden: invalid CSRF token", 403);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return apiError(c, "VALIDATION_ERROR", "Invalid request: malformed JSON body", 400);
  }

  const parsed = SettingsUpdateRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(c, "VALIDATION_ERROR", "Invalid request: malformed settings document", 400);
  }

  if (!checkWriteThrottle(sessionId)) {
    return apiError(c, "RATE_LIMITED", "Too many write requests -- slow down and try again", 429);
  }

  return withWriteLock(async () => {
    const originalRaw = await readSettingsRawText(dataDir);
    if (originalRaw !== null && parseSettings(originalRaw).status === "corrupt") {
      // Fail-closed: refuse to overwrite a present-but-corrupt file. A
      // read-modify-write here would silently replace whatever is
      // recoverable in the broken file with a fresh default-shaped document.
      return apiError(
        c,
        "DATA_CORRUPT",
        "settings.yml exists but is corrupt (unparseable or fails validation) -- fix it manually before writing",
        500,
      );
    }
    const newRaw = stringifySettings(parsed.data);
    await writeSettingsFile(dataDir, newRaw);

    const commit = await commitDataDirFile(dataDir, SETTINGS_REL, "web: settings update");
    if (!commit.ok) {
      // Fail-closed: revert to the pre-write byte-for-byte original (or
      // delete the file if it didn't exist before this write).
      if (originalRaw !== null) {
        await writeSettingsFile(dataDir, originalRaw);
      } else {
        await rm(join(dataDir, SETTINGS_REL), { force: true });
      }
      return handleCommitFailure(c, logger, "Settings update", commit);
    }

    const body = SettingsUpdateResponseSchema.parse({ settings: parsed.data });
    return apiOk(c, body);
  });
}
