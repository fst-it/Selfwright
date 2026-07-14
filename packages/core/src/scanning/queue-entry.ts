import type { QueueEntry } from "./types.js";
import type { ScanResult } from "./types.js";

// Pure, dependency-free hash (djb2) — core has zero I/O/builtin imports (see
// packages/core's existing modules); a stable id only needs to be
// deterministic per-URL, not cryptographically strong.
export function hashUrl(url: string): string {
  let hash = 5381;
  for (let i = 0; i < url.length; i++) {
    hash = (hash * 33) ^ url.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

export function toQueueEntry(result: ScanResult, now?: string): QueueEntry {
  return {
    id: `SCAN-${hashUrl(result.posting.url)}`,
    company: result.posting.company,
    derived_role: result.posting.title,
    fit_score: result.fitScore,
    ...(now !== undefined ? { queuedAt: now } : {}),
  };
}
