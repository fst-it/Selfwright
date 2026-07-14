// Pure payload-building functions for scheduled push notifications.
// IDs only — no claim text, no company names beyond what an id itself contains.
// Callers pass the result to notify() from @selfwright/shared-notify.

import type { QueueEntry, InboxReport } from "@selfwright/core";

export interface NotifyPayload {
  message: string;
  title: string;
}

/**
 * Build a scan notification payload from newly-queued entries.
 * Returns null when there are no new entries (nothing to push).
 * Message contains only IDs and a count — no company names or role titles.
 */
export function buildScanNotifyPayload(newEntries: QueueEntry[]): NotifyPayload | null {
  if (newEntries.length === 0) return null;
  const ids = newEntries.map((e) => e.id).join(", ");
  return {
    message: `${newEntries.length} new queue entries: ${ids}`,
    title: "Scan complete",
  };
}

/**
 * Build an inbox digest notification payload from an InboxReport.
 * Returns null when there are no decide-now or review-soon items.
 * Message: "inbox: N decide-now, M review-soon — ID1, ID2, ..." (IDs capped at 10).
 * IDs from decide-now then review-soon; deduplicated.
 */
export function buildInboxNotifyPayload(report: InboxReport): NotifyPayload | null {
  const decideCount = report.decideNow.length;
  const reviewCount = report.reviewSoon.length;
  if (decideCount === 0 && reviewCount === 0) return null;

  const ids = [...report.decideNow, ...report.reviewSoon]
    .map((item) => item.id)
    .filter((id) => id.length > 0) // skip blank ids
    .filter((id, i, arr) => arr.indexOf(id) === i) // dedupe
    .slice(0, 10);

  const parts: string[] = [];
  if (decideCount > 0) parts.push(`${decideCount} decide-now`);
  if (reviewCount > 0) parts.push(`${reviewCount} review-soon`);
  const summary = parts.join(", ");
  const message = ids.length > 0 ? `inbox: ${summary} — ${ids.join(", ")}` : `inbox: ${summary}`;
  return { message, title: "Selfwright inbox" };
}
