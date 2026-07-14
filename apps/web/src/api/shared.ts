// Shared helpers for the /api/* JSON contract (T5.9).
//
// CSRF mechanism: ADR 0019's original SSR write forms (deleted in the T5.10
// clean cutover) embedded the per-session token as a hidden field
// (name="csrf_token") because a browser form has nowhere else to carry it. A
// JSON request has no form — instead the caller (the React cockpit) reads
// the token once from GET /api/meta and resends it on every write as a
// request header. This is not a weaker mechanism: it is checked with the
// exact same verifyCsrfToken() (timingSafeEqual, session-bound, ADR 0019)
// the SSR forms used, and a custom header additionally can't be set by a
// cross-site <form> submission or a no-CORS cross-origin fetch (this server
// sends no Access-Control-Allow-Origin header, so a browser blocks any
// cross-origin script from ever completing a request that carries this
// header). Origin checking (checkOrigin) and the per-session write throttle
// (checkWriteThrottle) are reused unchanged.
import type { Context } from "hono";
import type { ApiErrorCode } from "@selfwright/api-contract";
import type { GitCommitResult } from "@selfwright/adapter-storage-git";
import type { Logger } from "@selfwright/shared-logger";

/** Header carrying the per-session CSRF token for state-changing JSON requests. */
export const CSRF_HEADER = "x-csrf-token";

/** Hono's Context#header() lookup is case-insensitive per the Fetch spec. */
export function getCsrfHeaderToken(c: Context): string {
  return c.req.header(CSRF_HEADER) ?? "";
}

export function apiError(
  c: Context,
  code: ApiErrorCode,
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500,
): Response {
  c.header("Cache-Control", "no-store");
  return c.json({ error: { code, message } }, status);
}

export function apiOk(c: Context, body: object, status: 200 | 201 = 200): Response {
  c.header("Cache-Control", "no-store");
  return c.json(body, status);
}

/**
 * Shared fail-closed commit-error response — every /api/* write route follows
 * ADR 0019's identical three-way commit-failure mapping (concurrent-write ->
 * 409, not-a-git-repo -> 500, anything else treated as a hook rejection ->
 * 422) after already reverting the working tree to its pre-write state (the
 * revert itself stays in each route, since what gets reverted differs:
 * one file, two files, or a delete-if-never-existed). This was copy-pasted
 * six times (applications.ts, coaching.ts, queue.ts x2, scan-targets.ts,
 * settings.ts) before being extracted here — pure refactor, same responses.
 *
 * @param actionLabel a short, route-specific label for the log lines (e.g.
 *   "Status update", "Promote", "Settings update") — everything else
 *   (messages, codes, statuses) is identical across every route.
 */
export function handleCommitFailure(
  c: Context,
  logger: Logger,
  actionLabel: string,
  commit: Extract<GitCommitResult, { ok: false }>,
): Response {
  if (commit.kind === "concurrent-write") {
    logger.warn(`${actionLabel} blocked by concurrent write`, { reason: commit.stderr.slice(0, 500) });
    return apiError(c, "CONFLICT", "Concurrent write in progress — try again in a moment", 409);
  }
  if (commit.kind === "not-a-git-repo") {
    logger.error("Data directory is not a git repository", { reason: commit.stderr.slice(0, 500) });
    return apiError(c, "INTERNAL_ERROR", "Internal error: data directory is not a git repository", 500);
  }
  logger.warn(`${actionLabel} rejected by data-repo hook`, { reason: commit.stderr.slice(0, 500) });
  return apiError(c, "HOOK_REJECTED", `Write rejected by data-repo hook: ${commit.stderr}`, 422);
}
