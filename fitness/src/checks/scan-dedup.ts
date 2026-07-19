// FF-SCAN-2: scanner dedup (Task T2.3). Synthetic fixtures (Tier 1) — a URL
// already recorded in the scan-history ledger must never be re-queued; near-duplicate
// postings (same company, similar title) must collapse via fuzzy dedup.
import { isSeen, dedupeByCompanyRole, dedupeByCompanyRoleFuzzy } from "@selfwright/core";
import type { RawPosting, SeenEntry } from "@selfwright/core";
import type { CheckResult } from "./shared.js";

const CHECK_NAME = "FF-SCAN-2: scan dedup (a seen URL is never re-queued; fuzzy near-duplicates collapse)";

export function checkScanDedup(): CheckResult {
  const seen: SeenEntry[] = [
    { url: "https://boards-api.greenhouse.io/v1/boards/acme/jobs/1", firstSeen: "2026-01-01", source: "greenhouse", status: "live" },
  ];

  if (!isSeen("https://boards-api.greenhouse.io/v1/boards/acme/jobs/1", seen)) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: "A URL already in the scan-history ledger must be reported as seen",
    };
  }

  if (isSeen("https://boards-api.greenhouse.io/v1/boards/acme/jobs/2", seen)) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: "A URL not in the scan-history ledger must not be reported as seen",
    };
  }

  // Exact-match baseline: case/whitespace variants collapse.
  const exactPostings: RawPosting[] = [
    { url: "https://a.example/1", title: "Enterprise Architect", company: "Acme", location: "Amsterdam, NL", source: "greenhouse", fetchedAt: "2026-07-03T00:00:00.000Z" },
    { url: "https://a.example/2", title: "  Enterprise   Architect  ", company: "ACME", location: "Amsterdam, NL", source: "greenhouse", fetchedAt: "2026-07-03T00:00:00.000Z" },
  ];
  const exactDeduped = dedupeByCompanyRole(exactPostings);
  if (exactDeduped.length !== 1) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `Expected exact-normalized company+title duplicates to collapse to 1 posting; got ${exactDeduped.length}`,
    };
  }

  // Fuzzy dedup: seniority-prefix variants collapse ("Senior Engineer" ≈ "Sr. Engineer").
  const fuzzyPostings: RawPosting[] = [
    { url: "https://b.example/1", title: "Senior Engineer", company: "Acme", location: "Amsterdam, NL", source: "greenhouse", fetchedAt: "2026-07-03T00:00:00.000Z" },
    { url: "https://b.example/2", title: "Sr. Engineer", company: "Acme", location: "Amsterdam, NL", source: "greenhouse", fetchedAt: "2026-07-03T00:00:00.000Z" },
  ];
  const fuzzyDeduped = dedupeByCompanyRoleFuzzy(fuzzyPostings);
  if (fuzzyDeduped.length !== 1) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `Expected 'Senior Engineer' and 'Sr. Engineer' to collapse to 1 posting via fuzzy dedup; got ${fuzzyDeduped.length}`,
    };
  }

  return { name: CHECK_NAME, passed: true };
}
