import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Context } from "hono";
import type { ApplicationRecord } from "@selfwright/core";
import {
  APPLICATIONS_REL,
  applyStatusUpdate,
  commitDataDirFile,
  hashApplicationsContent,
  readApplicationsRaw,
  writeApplicationsRaw,
} from "@selfwright/adapter-storage-git";
import {
  ApplicationsListResponseSchema,
  StatusUpdateRequestSchema,
  StatusUpdateResponseSchema,
} from "@selfwright/api-contract";
import { createLogger } from "@selfwright/shared-logger";
import { checkOrigin, checkWriteThrottle, getSessionId, verifyCsrfToken } from "../auth.js";
import { tryReadFile, filterValidApplications } from "../utils.js";
import { withWriteLock } from "../write-lock.js";
import { apiError, apiOk, getCsrfHeaderToken, handleCommitFailure } from "./shared.js";

const logger = createLogger("web-api-applications");

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** GET /api/applications — the cockpit's Pipeline board applications table data. */
export async function listApplicationsRoute(c: Context, dataDir: string): Promise<Response> {
  const appsRaw = await tryReadFile(join(dataDir, "applications", "applications.yml"));
  let applications: ApplicationRecord[] = [];
  if (appsRaw !== null) {
    try {
      const parsed: unknown = parseYaml(appsRaw);
      if (Array.isArray(parsed)) applications = filterValidApplications(parsed);
    } catch {
      // graceful empty
    }
  }
  const contentHash = appsRaw !== null ? hashApplicationsContent(appsRaw) : null;

  const body = ApplicationsListResponseSchema.parse({ applications, contentHash });
  return apiOk(c, body);
}

/**
 * POST /api/applications/:id/status — status-transition write for the
 * cockpit's Pipeline board. Same validation, CSRF, throttle, optimistic-lock,
 * and audited-commit-with-fail-closed-revert semantics ADR 0019 established
 * (originally alongside an SSR form write route deleted in the T5.10 clean
 * cutover — this JSON endpoint is now the only surface for this write).
 */
export async function updateStatusApiRoute(c: Context, dataDir: string): Promise<Response> {
  if (!checkOrigin(c)) return apiError(c, "FORBIDDEN_ORIGIN", "Forbidden", 403);

  const sessionId = getSessionId(c.req.header("cookie") ?? null);
  if (sessionId === null) return apiError(c, "UNAUTHORIZED", "Unauthorized", 401);

  const id = c.req.param("id");
  if (id === undefined || id.length === 0) {
    return apiError(c, "VALIDATION_ERROR", "Invalid request: missing application id", 400);
  }

  // CSRF check runs before full body validation so a missing/wrong token
  // never reaches business logic (ADR 0019 posture, unchanged).
  if (!verifyCsrfToken(sessionId, getCsrfHeaderToken(c))) {
    return apiError(c, "FORBIDDEN_CSRF", "Forbidden: invalid CSRF token", 403);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return apiError(c, "VALIDATION_ERROR", "Invalid request: malformed JSON body", 400);
  }

  const parsed = StatusUpdateRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(c, "VALIDATION_ERROR", "Invalid request: malformed status update", 400);
  }
  const { status, contentHash } = parsed.data;
  const note = parsed.data.note;

  if (!checkWriteThrottle(sessionId)) {
    return apiError(c, "RATE_LIMITED", "Too many write requests -- slow down and try again", 429);
  }

  return withWriteLock(async () => {
    const raw = await readApplicationsRaw(dataDir);
    if (raw === null) {
      return apiError(c, "NOT_FOUND", "applications.yml not found", 404);
    }

    const currentHash = hashApplicationsContent(raw);
    if (currentHash !== contentHash) {
      return apiError(
        c,
        "CONFLICT",
        "Conflict: applications.yml changed since this was read -- reload and retry",
        409,
      );
    }

    const result = applyStatusUpdate(raw, id, status, note, today());
    if (!result.ok) {
      return apiError(
        c,
        "NOT_FOUND",
        result.kind === "NOT_FOUND" ? "Application not found" : "applications.yml is not parseable",
        404,
      );
    }

    await writeApplicationsRaw(dataDir, result.raw);

    const message = `web: status ${today()} ${result.previousStatus}->${status}`;
    const commit = await commitDataDirFile(dataDir, APPLICATIONS_REL, message);
    if (!commit.ok) {
      // Fail-closed: revert the working tree to the pre-write original.
      await writeApplicationsRaw(dataDir, raw);
      return handleCommitFailure(c, logger, "Status update", commit);
    }

    const updatedParsed: unknown = parseYaml(result.raw);
    const updatedApps = Array.isArray(updatedParsed) ? filterValidApplications(updatedParsed) : [];
    const updatedApp = updatedApps.find((a) => a.id === id);
    if (updatedApp === undefined) {
      return apiError(c, "INTERNAL_ERROR", "Internal error: updated application not found after write", 500);
    }

    const body = StatusUpdateResponseSchema.parse({ application: updatedApp });
    return apiOk(c, body);
  });
}
