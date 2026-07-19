import { rm } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Context } from "hono";
import type { ApplicationRecord, QueueEntry } from "@selfwright/core";
import { partitionQueueByAge, promoteQueueEntry } from "@selfwright/core";
import { loadSettings } from "@selfwright/shared-config";
import {
  APPLICATIONS_REL,
  QUEUE_REL,
  commitDataDirFile,
  hashQueueContent,
  readApplicationsRaw,
  readQueueRaw,
  removeQueueEntry,
  writeApplicationsRaw,
  writeQueueRaw,
} from "@selfwright/adapter-storage-git";
import {
  DismissQueueEntryResponseSchema,
  PromoteQueueEntryRequestSchema,
  PromoteQueueEntryResponseSchema,
  QueueResponseSchema,
} from "@selfwright/api-contract";
import { createLogger } from "@selfwright/shared-logger";
import { checkOrigin, checkWriteThrottle, getSessionId, verifyCsrfToken } from "../auth.js";
import { tryReadFile, filterValidApplications } from "../utils.js";
import { withWriteLock } from "../write-lock.js";
import { apiError, apiOk, getCsrfHeaderToken, handleCommitFailure } from "./shared.js";

const logger = createLogger("web-api-queue");

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** GET /api/queue — queue entries partitioned by the T5.5 aging window, for the cockpit's Queue triage page. */
export async function getQueueRoute(c: Context, dataDir: string): Promise<Response> {
  const queueRaw = await tryReadFile(join(dataDir, "pipeline", "queue.yml"));
  let queue: QueueEntry[] = [];
  if (queueRaw !== null) {
    try {
      const parsed: unknown = parseYaml(queueRaw);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "queue" in parsed &&
        Array.isArray((parsed as Record<string, unknown>)["queue"])
      ) {
        queue = (parsed as { queue: QueueEntry[] }).queue;
      }
    } catch {
      // graceful empty
    }
  }

  const settings = loadSettings(join(dataDir, "settings.yml"));
  const { active, stale } = partitionQueueByAge(queue, settings.agingWindowDays, new Date());
  const contentHash = queueRaw !== null ? hashQueueContent(queueRaw) : null;

  const body = QueueResponseSchema.parse({
    active,
    staleCount: stale.length,
    agingWindowDays: settings.agingWindowDays,
    contentHash,
  });
  return apiOk(c, body);
}

/**
 * POST /api/queue/:id/promote — turn a triaged queue entry into a new
 * application (ADR 0024). Removes the entry from queue.yml and appends the
 * mapped ApplicationRecord (packages/core's promoteQueueEntry) to
 * applications.yml, both staged in ONE atomic git commit (commitDataDirFile's
 * multi-path form) so the two files never go out of sync with each other —
 * unlike the single-file writes elsewhere in this app, a partial write here
 * (queue entry gone but no application, or vice versa) would be a real data
 * inconsistency, not just a stale read.
 *
 * Same session/CSRF/origin/throttle/write-lock/audited-commit/fail-closed-
 * revert posture as every other write route in this app (ADR 0019).
 */
export async function promoteQueueEntryRoute(c: Context, dataDir: string): Promise<Response> {
  if (!checkOrigin(c)) return apiError(c, "FORBIDDEN_ORIGIN", "Forbidden", 403);

  const sessionId = getSessionId(c.req.header("cookie") ?? null);
  if (sessionId === null) return apiError(c, "UNAUTHORIZED", "Unauthorized", 401);

  const id = c.req.param("id");
  if (id === undefined || id.length === 0) {
    return apiError(c, "VALIDATION_ERROR", "Invalid request: missing queue entry id", 400);
  }

  if (!verifyCsrfToken(sessionId, getCsrfHeaderToken(c))) {
    return apiError(c, "FORBIDDEN_CSRF", "Forbidden: invalid CSRF token", 403);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return apiError(c, "VALIDATION_ERROR", "Invalid request: malformed JSON body", 400);
  }

  const parsed = PromoteQueueEntryRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(c, "VALIDATION_ERROR", "Invalid request: malformed promote request", 400);
  }
  const { contentHash } = parsed.data;

  if (!checkWriteThrottle(sessionId)) {
    return apiError(c, "RATE_LIMITED", "Too many write requests -- slow down and try again", 429);
  }

  return withWriteLock(async () => {
    const originalQueueRaw = await readQueueRaw(dataDir);
    if (originalQueueRaw === null) {
      return apiError(c, "NOT_FOUND", "Queue entry not found", 404);
    }

    const currentHash = hashQueueContent(originalQueueRaw);
    if (currentHash !== contentHash) {
      return apiError(
        c,
        "CONFLICT",
        "Conflict: queue.yml changed since this was read -- reload and retry",
        409,
      );
    }

    const removeResult = removeQueueEntry(originalQueueRaw, id);
    if (!removeResult.ok) {
      return apiError(
        c,
        "NOT_FOUND",
        removeResult.kind === "NOT_FOUND" ? "Queue entry not found" : "queue.yml is not parseable",
        404,
      );
    }

    const originalAppsRaw = await readApplicationsRaw(dataDir);
    let applications: ApplicationRecord[] = [];
    if (originalAppsRaw !== null) {
      try {
        const parsed: unknown = parseYaml(originalAppsRaw);
        if (Array.isArray(parsed)) applications = filterValidApplications(parsed);
      } catch {
        return apiError(c, "INTERNAL_ERROR", "Internal error: applications.yml is not parseable", 500);
      }
    }
    if (applications.some((a) => a.id === removeResult.entry.id)) {
      return apiError(
        c,
        "CONFLICT",
        "An application with this id already exists — cannot promote",
        409,
      );
    }

    const newApplication = promoteQueueEntry(removeResult.entry, today());
    const newAppsRaw = stringifyYaml([...applications, newApplication]);

    await writeQueueRaw(dataDir, removeResult.raw);
    await writeApplicationsRaw(dataDir, newAppsRaw);

    const message = `web: promote ${removeResult.entry.company} - ${newApplication.role} (${today()})`;
    const commit = await commitDataDirFile(dataDir, [QUEUE_REL, APPLICATIONS_REL], message);
    if (!commit.ok) {
      // Fail-closed: revert both files to their pre-write state (or delete
      // applications.yml if it did not exist before this promote — writing an
      // empty array here would leave an untracked file in the data dir rather
      // than the clean "file never existed" state, matching the rm convention
      // in settings.ts and coaching.ts).
      await writeQueueRaw(dataDir, originalQueueRaw);
      if (originalAppsRaw !== null) {
        await writeApplicationsRaw(dataDir, originalAppsRaw);
      } else {
        await rm(join(dataDir, APPLICATIONS_REL), { force: true });
      }
      return handleCommitFailure(c, logger, "Promote", commit);
    }

    const body = PromoteQueueEntryResponseSchema.parse({ application: newApplication });
    return apiOk(c, body, 201);
  });
}

/**
 * POST /api/queue/:id/dismiss — remove a queue entry the human has decided
 * not to pursue (ADR 0024). No separate dismissal ledger: scan-history.yml
 * (ADR 0007) already records this posting's URL as permanently "seen," so a
 * dismissed entry cannot resurface on the next scan even after clean
 * removal — there is nothing a ledger would add here. The git commit that
 * removes the entry (naming company/role/fit score) is the audit trail,
 * matching every other write in this app.
 */
export async function dismissQueueEntryRoute(c: Context, dataDir: string): Promise<Response> {
  if (!checkOrigin(c)) return apiError(c, "FORBIDDEN_ORIGIN", "Forbidden", 403);

  const sessionId = getSessionId(c.req.header("cookie") ?? null);
  if (sessionId === null) return apiError(c, "UNAUTHORIZED", "Unauthorized", 401);

  const id = c.req.param("id");
  if (id === undefined || id.length === 0) {
    return apiError(c, "VALIDATION_ERROR", "Invalid request: missing queue entry id", 400);
  }

  if (!verifyCsrfToken(sessionId, getCsrfHeaderToken(c))) {
    return apiError(c, "FORBIDDEN_CSRF", "Forbidden: invalid CSRF token", 403);
  }

  if (!checkWriteThrottle(sessionId)) {
    return apiError(c, "RATE_LIMITED", "Too many write requests -- slow down and try again", 429);
  }

  return withWriteLock(async () => {
    const originalRaw = await readQueueRaw(dataDir);
    const removeResult = removeQueueEntry(originalRaw, id);
    if (!removeResult.ok) {
      return apiError(
        c,
        "NOT_FOUND",
        removeResult.kind === "NOT_FOUND" ? "Queue entry not found" : "queue.yml is not parseable",
        404,
      );
    }

    await writeQueueRaw(dataDir, removeResult.raw);

    const message = `web: dismiss ${removeResult.entry.company} (${today()})`;
    const commit = await commitDataDirFile(dataDir, QUEUE_REL, message);
    if (!commit.ok) {
      // Fail-closed: revert to the pre-write original.
      await writeQueueRaw(dataDir, originalRaw ?? "");
      return handleCommitFailure(c, logger, "Dismiss", commit);
    }

    const body = DismissQueueEntryResponseSchema.parse({ dismissed: removeResult.entry });
    return apiOk(c, body);
  });
}
