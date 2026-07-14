// ── Scanner domain types (Scanning/Intake bounded context) ────────────────────
// A RawPosting is what a ScanProvider fetches; scorePosting (scoring/score.ts)
// already implements the scan-time fit rubric over its Posting-shaped fields.

export interface RawPosting {
  url: string;
  title: string;
  company: string;
  location: string;
  description?: string;
  // Set only by single-page-fetch providers (e.g. the generic company-page
  // fetcher) that observe a real HTTP response for this exact posting URL —
  // 403/404/410/503 are liveness signals evaluatePosting() feeds into
  // checkLiveness(). ATS JSON-API providers (Greenhouse/Lever/etc.) fetch a
  // whole board in one call, so no single posting has its own HTTP status;
  // they leave this undefined and liveness falls back to text-pattern-only
  // classification of `description`.
  httpStatus?: number;
  finalUrl?: string;
  source: string;
  fetchedAt: string;
  // "structured" — posting came from an ATS board's own JSON API (Greenhouse,
  // Lever, Ashby, Workday, SmartRecruiters, BambooHR); the API only surfaces
  // active postings, so the posting is live by construction — no content
  // heuristics needed. "scraped" — HTML page fetched by the generic provider;
  // liveness must be inferred from HTTP status + page text. Absent = "scraped"
  // (backwards compat for any callers that don't set the field).
  sourceKind?: "structured" | "scraped";
}

export interface ScanTarget {
  company: string;
  provider: string;
  // Explicit `| undefined` (not just `careersUrl?: string`) to stay
  // assignable from Zod-inferred optional fields under
  // exactOptionalPropertyTypes (@selfwright/shared-config's ScanTargetSchema).
  careersUrl?: string | undefined;
  api?: string | undefined;
  // 2-letter country code for Adzuna (e.g. "nl", "ch"). Sets the URL path
  // segment; defaults to "gb" when absent. See adzuna.ts for interaction with
  // locationFilter / where param.
  country?: string | undefined;
  titleFilter?: string[] | undefined;
  locationFilter?: string[] | undefined;
  skipTiers?: string[] | undefined;
}

export type LivenessStatus = "live" | "expired" | "uncertain";

export interface LivenessVerdict {
  status: LivenessStatus;
  reason: string;
}

export interface SeenEntry {
  url: string;
  firstSeen: string;
  source: string;
  status: LivenessStatus;
}

export interface ScanResult {
  posting: RawPosting;
  liveness: LivenessVerdict;
  archetype: string | null;
  fitScore: number;
  grade: string;
}

export interface QueueEntry {
  id: string;
  company: string;
  derived_role?: string;
  fit_score?: number | null;
  comp_eur?: number | null;
  /** "manual" for entries added via queue-add; absent for scan-derived entries. */
  source?: string;
  /** ISO timestamp when this entry was first added to queue.yml. */
  queuedAt?: string;
  /**
   * ISO timestamp when a scan last confirmed this posting URL is still being
   * listed by the source. Updated by runScan when an already-queued URL
   * re-appears in a scan pass. Absent on manual entries and legacy entries
   * written before T5.5.
   */
  lastSeenAt?: string;
}
