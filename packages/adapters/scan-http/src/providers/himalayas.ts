import type { RawPosting, ScanFetchContext, ScanProvider, ScanTarget } from "@selfwright/core";

// Himalayas aggregator provider — curated remote job board.
//
// API: https://himalayas.app/jobs/api
//   Optional query params: ?limit=<n>&offset=<n>
//   Response: { totalCount: N, jobs: [...] }
//   Each job: { title, companyName, applicationLink, guid,
//               locationRestrictions, employmentType, pubDate,
//               minSalary, maxSalary, currency, salaryPeriod }
//
// Both applicationLink and guid contain the canonical job URL on himalayas.app;
// applicationLink is preferred as it is documented as the candidate-facing URL.
//
// Config (on the scan target):
//   provider: himalayas
//   titleFilter   — first entry used as ?search= keyword when supported
//                   (current API does not expose a search param; kept for
//                   forward-compatibility and used in the detect URL)
//
// SSRF: fixed-host lock — only https://himalayas.app (+ www.) is ever contacted.
//   Posting URLs (applicationLink) are validated against the same trusted hosts.

const API_BASE = "https://himalayas.app/jobs/api";
const TRUSTED_HOSTS = new Set(["himalayas.app", "www.himalayas.app"]);
const RESULTS_PER_PAGE = 100;
const MAX_PAGES = 10; // matches adzuna's cap; warn if hit with more available

function assertHimalayasApiUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`himalayas: invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`himalayas: URL must use HTTPS: ${url}`);
  }
  if (!TRUSTED_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `himalayas: untrusted hostname "${parsed.hostname}" — must be himalayas.app`,
    );
  }
}

function isAllowedPostingUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && TRUSTED_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

interface HimalayasJob {
  title?: unknown;
  companyName?: unknown;
  applicationLink?: unknown;
  guid?: unknown;
  locationRestrictions?: unknown;
  employmentType?: unknown;
}

export const himalayasProvider: ScanProvider = {
  id: "himalayas",

  detect(target: ScanTarget) {
    if (target.provider !== "himalayas") return null;
    return { url: API_BASE };
  },

  async fetch(target: ScanTarget, ctx: ScanFetchContext) {
    const fetchedAt = new Date().toISOString();
    assertHimalayasApiUrl(API_BASE);

    // titleFilter is used client-side to narrow the job list from the full feed.
    // The current API has no server-side search param; apply a case-insensitive
    // substring match on title when titleFilter is set.
    const filters = (target.titleFilter ?? [])
      .map((f) => f.trim().toLowerCase())
      .filter(Boolean);

    const out: RawPosting[] = [];
    let totalCount = 0;
    let hitCap = false;

    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(API_BASE);
      url.searchParams.set("limit", String(RESULTS_PER_PAGE));
      url.searchParams.set("offset", String(page * RESULTS_PER_PAGE));
      // Re-assert the base URL (without search params) after URLSearchParams are
      // appended — same pattern as adzuna, which checks origin+pathname only.
      assertHimalayasApiUrl(url.origin + url.pathname);

      const json = (await ctx.fetchJson(url.toString(), { redirect: "error" })) as {
        totalCount?: unknown;
        jobs?: HimalayasJob[];
      };

      if (!Array.isArray(json.jobs)) {
        throw new Error(
          `himalayas: unexpected API response for ${target.company} — expected { jobs: [...] }`,
        );
      }

      if (page === 0 && typeof json.totalCount === "number") {
        totalCount = json.totalCount;
      }

      for (const j of json.jobs) {
        if (typeof j.title !== "string" || !j.title.trim()) continue;
        // Extract into a typed local so the closure below avoids the non-null assertion.
        const jobTitle: string = j.title.trim();

        // Client-side title filter (any-of OR semantics)
        if (
          filters.length > 0 &&
          !filters.some((f) => jobTitle.toLowerCase().includes(f))
        ) {
          continue;
        }

        // applicationLink preferred; fall back to guid (same value in practice)
        const postUrl =
          typeof j.applicationLink === "string" && j.applicationLink.trim()
            ? j.applicationLink.trim()
            : typeof j.guid === "string" && j.guid.trim()
              ? j.guid.trim()
              : "";
        if (!postUrl) continue;
        if (!isAllowedPostingUrl(postUrl)) continue;

        const location =
          Array.isArray(j.locationRestrictions) && j.locationRestrictions.length > 0 &&
          typeof j.locationRestrictions[0] === "string"
            ? j.locationRestrictions[0].trim()
            : "Remote";

        out.push({
          title: jobTitle,
          url: postUrl,
          company:
            typeof j.companyName === "string" && j.companyName.trim()
              ? j.companyName.trim()
              : target.company,
          location,
          source: "himalayas",
          sourceKind: "structured",
          fetchedAt,
        });
      }

      if (json.jobs.length < RESULTS_PER_PAGE) break; // last page (short)
      if (page === MAX_PAGES - 1) hitCap = true;
    }

    // Truncation warn: hit the page cap and the API reports more than we fetched.
    if (hitCap && totalCount > out.length) {
      process.stderr.write(
        `warn: himalayas: ${target.company}: fetched ${out.length} of ${totalCount} available` +
          (filters.length > 0 ? ` (titleFilter=${filters.join(", ")})` : "") +
          ` — hit ${MAX_PAGES}-page cap; consider narrowing titleFilter\n`,
      );
    }

    if (out.length === 0) {
      process.stderr.write(
        `warn: himalayas: ${target.company}: 0 postings returned` +
          (filters.length > 0 ? ` (titleFilter=${filters.join(", ")})` : "") +
          "\n",
      );
    }

    return out;
  },
};
