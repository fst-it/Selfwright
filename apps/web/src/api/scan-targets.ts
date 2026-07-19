import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Context } from "hono";
import {
  readScanTargetsRawText,
  parseScanTargets,
  stringifyScanTargets,
  writeScanTargetsFile,
  commitDataDirFile,
  SCAN_TARGETS_REL,
} from "@selfwright/adapter-storage-git";
import {
  ScanTargetsUpdateRequestSchema,
  ScanTargetsUpdateResponseSchema,
} from "@selfwright/api-contract";
import { createLogger } from "@selfwright/shared-logger";
import { checkOrigin, checkWriteThrottle, getSessionId, verifyCsrfToken } from "../auth.js";
import { withWriteLock } from "../write-lock.js";
import { apiError, apiOk, getCsrfHeaderToken, handleCommitFailure } from "./shared.js";

const logger = createLogger("web-api-scan-targets");

/**
 * GET /api/scan-targets — the validated pipeline/scan-targets.yml document
 * (defaults to { targets: [] } when the file is absent). A present-but-corrupt
 * file (unparseable or schema-invalid) is surfaced as a clear error instead
 * of silently serving defaults.
 */
export async function getScanTargetsRoute(c: Context, dataDir: string): Promise<Response> {
  const raw = await readScanTargetsRawText(dataDir);
  const result = parseScanTargets(raw);
  if (result.status === "corrupt") {
    return apiError(
      c,
      "DATA_CORRUPT",
      "scan-targets.yml exists but is corrupt (unparseable or fails validation) -- fix it manually",
      500,
    );
  }
  return apiOk(c, result.status === "ok" ? result.config : { targets: [] });
}

/**
 * PUT /api/scan-targets — full-document replace of pipeline/scan-targets.yml,
 * validated by the same ScanTargetsConfigSchema the file itself is read with.
 * Same session/CSRF/origin/throttle/write-lock/audited-commit/fail-closed-
 * revert posture as every other write route in this app (ADR 0019).
 */
export async function putScanTargetsRoute(c: Context, dataDir: string): Promise<Response> {
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

  const parsed = ScanTargetsUpdateRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(c, "VALIDATION_ERROR", "Invalid request: malformed scan-targets document", 400);
  }

  if (!checkWriteThrottle(sessionId)) {
    return apiError(c, "RATE_LIMITED", "Too many write requests -- slow down and try again", 429);
  }

  return withWriteLock(async () => {
    const originalRaw = await readScanTargetsRawText(dataDir);
    if (originalRaw !== null && parseScanTargets(originalRaw).status === "corrupt") {
      // Fail-closed: refuse to overwrite a present-but-corrupt file. A
      // read-modify-write here would silently replace whatever is
      // recoverable in the broken file with a fresh default-shaped document.
      return apiError(
        c,
        "DATA_CORRUPT",
        "scan-targets.yml exists but is corrupt (unparseable or fails validation) -- fix it manually before writing",
        500,
      );
    }
    const newRaw = stringifyScanTargets(parsed.data);
    await writeScanTargetsFile(dataDir, newRaw);

    const commit = await commitDataDirFile(dataDir, SCAN_TARGETS_REL, "web: scan-targets update");
    if (!commit.ok) {
      // Fail-closed: revert to the pre-write byte-for-byte original (or
      // delete the file if it didn't exist before this write).
      if (originalRaw !== null) {
        await writeScanTargetsFile(dataDir, originalRaw);
      } else {
        await rm(join(dataDir, SCAN_TARGETS_REL), { force: true });
      }
      return handleCommitFailure(c, logger, "Scan-targets update", commit);
    }

    const body = ScanTargetsUpdateResponseSchema.parse({ targets: parsed.data.targets });
    return apiOk(c, body);
  });
}
