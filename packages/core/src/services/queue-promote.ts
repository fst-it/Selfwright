// Queue-triage "promote" mapping (T5.10, ADR 0024): turns a triaged QueueEntry
// into a new ApplicationRecord. Pure — no I/O, no Date.now(); the caller
// (apps/web's promote endpoint) supplies `today` (YYYY-MM-DD) and is
// responsible for actually removing the entry from queue.yml and appending
// the returned record to applications.yml.
import type { QueueEntry } from "../scanning/index.js";
import type { ApplicationRecord } from "./types.js";

/**
 * Build a new ApplicationRecord from a queue entry the human has decided to
 * pursue.
 *
 * Field mapping (see ADR 0024 for the full rationale):
 *  - id: reuses the queue entry's own id rather than minting a new scheme —
 *    ids are already unique (`SCAN-<hash>` for scan-derived entries,
 *    a dedup-checked manual id for `queue-add` entries) and reusing it keeps
 *    the resulting application traceable back to the exact queue/scan-history
 *    record it was promoted from, at zero collision risk.
 *  - company / role: carried over as-is (`derived_role` -> `role`).
 *  - status: "evaluating" — a queue entry has already cleared scan-time
 *    scoring and triage (past "discovered"); promoting it means the human is
 *    now deciding whether to actually apply, which is exactly what
 *    "evaluating" denotes in APPLICATION_STATUSES.
 *  - fit_score: carried over unchanged.
 *  - dates.discovered: the entry's `queuedAt` timestamp truncated to a date,
 *    or `today` for legacy entries with no `queuedAt` (T5.5 predates it).
 *  - dates.promoted / dates.last_update: `today`.
 *  - channel, ats_score, notes: intentionally left unset. None of this
 *    exists on a QueueEntry: `channel` is a submission-channel concept
 *    (referral/portal/direct) unrelated to which ATS board a posting was
 *    scanned from; `ats_score` is computed at CV-tailoring time, not scan
 *    time; there is no scan-time note.
 *  - No posting URL is carried over: QueueEntry does not store one by design
 *    (the URL lives only in the separate scan-history.yml seen ledger, ADR
 *    0007) — there is nothing to promote here even though a reader might
 *    expect a link.
 */
export function promoteQueueEntry(entry: QueueEntry, today: string): ApplicationRecord {
  const discovered = entry.queuedAt !== undefined ? entry.queuedAt.slice(0, 10) : today;
  return {
    id: entry.id,
    company: entry.company,
    role: entry.derived_role ?? "Unknown role",
    status: "evaluating",
    dates: {
      discovered,
      promoted: today,
      last_update: today,
    },
    fit_score: entry.fit_score ?? null,
  };
}
