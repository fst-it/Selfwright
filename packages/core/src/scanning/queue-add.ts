// LinkedIn-safe manual capture lane (ADR PLAN.md D3 — no scraping allowed).
// This module is pure: no I/O, no Date.now(). Callers (CLI/MCP) supply the
// timestamp and the existing data so this stays trivially unit-testable.
import type { QueueEntry } from "./types.js";
import type { SeenEntry } from "./types.js";
import { isSeen, areSimilarTitles } from "./dedup.js";
import { hashUrl } from "./queue-entry.js";

/** Normalise company string the same way orchestrate.ts does for cross-dedup. */
function normalizeCompany(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface ManualAddInput {
  /** Posting URL. Not fetched — used only as a dedup key and for the id hash. */
  url: string;
  company: string;
  role: string;
  /** ISO timestamp supplied by the caller (no Date.now() inside core). */
  now: string;
  /** Optional fit score from the caller's scoring pass (same path as `score --jd`). */
  fitScore?: number | null;
}

export type ManualAddResult =
  | { ok: true; entry: QueueEntry; seenEntry: SeenEntry }
  | { ok: false; reason: "url-seen"; existingUrl: string }
  | {
      ok: false;
      reason: "queue-duplicate";
      existingId: string;
      existingCompany: string;
      existingRole: string;
    }
  | {
      ok: false;
      reason: "application-duplicate";
      existingId: string;
      existingCompany: string;
      existingRole: string;
    };

/**
 * Build a manual queue entry after checking dedup against the existing seen
 * ledger, queue, and applications.
 *
 * Dedup precedence (first match wins):
 *   1. URL already in scan-history → "url-seen"
 *   2. Queue already has company + fuzzy-matching role → "queue-duplicate"
 *   3. Applications already has company + fuzzy-matching role → "application-duplicate"
 *
 * On success, both an entry (for queue.yml) and a seenEntry (for
 * scan-history.yml) are returned so a single atomic write can update both.
 */
export function buildManualEntry(
  input: ManualAddInput,
  existingSeen: SeenEntry[],
  existingQueue: QueueEntry[],
  existingApplications: { id: string; company: string; role: string }[],
): ManualAddResult {
  // 1. URL dedup via the seen ledger.
  if (isSeen(input.url, existingSeen)) {
    return { ok: false, reason: "url-seen", existingUrl: input.url };
  }

  const inputCo = normalizeCompany(input.company);

  // 2. Queue dedup — same fuzzy company+role logic as orchestrate.ts cross-dedup.
  for (const q of existingQueue) {
    if (
      normalizeCompany(q.company) === inputCo &&
      areSimilarTitles(q.derived_role ?? "", input.role)
    ) {
      return {
        ok: false,
        reason: "queue-duplicate",
        existingId: q.id,
        existingCompany: q.company,
        existingRole: q.derived_role ?? "",
      };
    }
  }

  // 3. Application dedup.
  for (const app of existingApplications) {
    if (
      normalizeCompany(app.company) === inputCo &&
      areSimilarTitles(app.role, input.role)
    ) {
      return {
        ok: false,
        reason: "application-duplicate",
        existingId: app.id,
        existingCompany: app.company,
        existingRole: app.role,
      };
    }
  }

  const entry: QueueEntry = {
    id: `MAN-${hashUrl(input.url)}`,
    company: input.company,
    derived_role: input.role,
    ...(input.fitScore !== undefined && input.fitScore !== null
      ? { fit_score: input.fitScore }
      : {}),
    source: "manual",
    queuedAt: input.now,
  };

  const seenEntry: SeenEntry = {
    url: input.url,
    firstSeen: input.now,
    source: "manual",
    status: "live",
  };

  return { ok: true, entry, seenEntry };
}
