// Queue aging — 30-day staleness classifier (T5.5).
// Pure: no I/O, no Date.now() — callers supply the reference date.
import type { QueueEntry, SeenEntry } from "./types.js";
import { hashUrl } from "./queue-entry.js";

export const DEFAULT_AGING_WINDOW_DAYS = 30;

/**
 * A queue entry is stale when the most-recent activity timestamp is older
 * than `windowDays`.
 *
 * - `lastSeenAt` wins over `queuedAt` (a re-scan refreshing lastSeenAt is the
 *   mechanism that keeps live postings from going stale).
 * - If neither field is present (legacy entries predating T5.5) the entry is
 *   treated as NOT stale — backward-compat rule so existing queue.yml files
 *   load without every entry vanishing from the default view on first upgrade.
 * - A malformed timestamp (not parseable by Date.parse) is treated as not
 *   stale for the same reason.
 */
export function isStaleEntry(
  entry: QueueEntry,
  windowDays: number,
  asOf: Date,
): boolean {
  const ts = entry.lastSeenAt ?? entry.queuedAt;
  if (ts === undefined) return false;
  const parsed = Date.parse(ts);
  if (Number.isNaN(parsed)) return false;
  return asOf.getTime() - parsed > windowDays * 86_400_000;
}

export interface QueueAgePartition {
  active: QueueEntry[];
  stale: QueueEntry[];
}

/**
 * Backfill `queuedAt` for legacy queue entries that predate T5.5.
 *
 * Without `queuedAt`, entries are permanently non-stale and the aging window
 * never cleans them. For each entry missing `queuedAt` this function:
 *
 * 1. Looks up the seen ledger for a matching URL (by hash portion of the id).
 * 2. Uses the ledger's `firstSeen` timestamp if found — so the entry ages out
 *    relative to when the posting was first discovered, not the upgrade date.
 * 3. Falls back to `now` when no seen ledger entry matches (the entry then
 *    ages out 30 days from the first post-upgrade scan).
 *
 * Returns a new array; the input is never mutated.
 * Pure — callers supply `now` (no Date.now() inside core).
 * Only called from the non-dry-run scan write path in the CLI.
 */
export function backfillQueuedAt(
  queue: QueueEntry[],
  seen: SeenEntry[],
  now: string,
): QueueEntry[] {
  if (queue.every((e) => e.queuedAt !== undefined)) return queue;

  // Build hash→firstSeen from the seen ledger (first match wins if dupes exist).
  const hashToFirstSeen = new Map<string, string>();
  for (const s of seen) {
    const h = hashUrl(s.url);
    if (!hashToFirstSeen.has(h)) {
      hashToFirstSeen.set(h, s.firstSeen);
    }
  }

  return queue.map((entry) => {
    if (entry.queuedAt !== undefined) return entry;
    const hash = entry.id.replace(/^(?:SCAN|MAN)-/, "");
    const firstSeen = hashToFirstSeen.get(hash) ?? now;
    return { ...entry, queuedAt: firstSeen };
  });
}

/**
 * Split a queue into active (fresh within window) and stale entries.
 * Maintains the original order within each partition.
 */
export function partitionQueueByAge(
  entries: QueueEntry[],
  windowDays: number,
  asOf: Date,
): QueueAgePartition {
  const active: QueueEntry[] = [];
  const stale: QueueEntry[] = [];
  for (const entry of entries) {
    if (isStaleEntry(entry, windowDays, asOf)) {
      stale.push(entry);
    } else {
      active.push(entry);
    }
  }
  return { active, stale };
}
