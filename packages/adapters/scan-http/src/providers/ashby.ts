import type { ScanFetchContext, ScanProvider, ScanTarget } from "@selfwright/core";

// Ported from santifer/career-ops's providers/ashby.mjs — hits the public
// posting-api endpoint. Auto-detects from a careersUrl pattern
// `https://jobs.ashbyhq.com/<slug>`. The API host is always the fixed
// `api.ashbyhq.com` (never derived from user-controlled input), so there is
// no hostname-allowlist step here, same as Lever.
//
// resolveApiUrl parses careersUrl as a real URL and checks .hostname exactly
// (not a substring/regex match against the raw string) -- same fragility
// found in Lever during review: an unanchored regex match against the raw
// URL string accepts a crafted careersUrl whose *path* merely contains
// "jobs.ashbyhq.com/<slug>" on an unrelated host. Not currently exploitable
// (the request always targets the hardcoded api.ashbyhq.com host), but a
// future edit that reused the matched substring for anything host-related
// would silently reintroduce an SSRF path. Parsing the URL properly removes
// that footgun.
//
// Rate-limit retry (429) is handled at the http-context layer. Deferred: a
// per-request AbortController timeout to handle Ashby's high server-side
// latency floor without blocking the entire scan pass.
//
// v1 simplification: compensation parsing/annualization (parseCompensation,
// INTERVAL_MULTIPLIERS) is not ported — RawPosting has no comp field.

const ASHBY_POSTING_HOST = "jobs.ashbyhq.com";

function resolveApiUrl(target: ScanTarget): string | null {
  const raw = target.careersUrl ?? "";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== ASHBY_POSTING_HOST) return null;
  const slug = parsed.pathname.split("/").filter(Boolean)[0];
  if (!slug) return null;
  return `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`;
}

// Finding 3 (SSRF, defense in depth): `jobUrl` comes verbatim from Ashby's
// third-party JSON response — nothing about the fixed api.ashbyhq.com
// endpoint constrains what a posting's own jobUrl can be. A posting whose
// jobUrl fails this check is dropped rather than passed downstream (it would
// otherwise reach fetchRendered's real-browser navigation for an
// "uncertain" liveness re-check).
function isAllowedPostingUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === ASHBY_POSTING_HOST;
  } catch {
    return false;
  }
}

interface AshbySecondaryLocation {
  location?: string;
  address?: { postalAddress?: { addressLocality?: string; addressCountry?: string } };
}

interface AshbyJob {
  title?: string;
  jobUrl?: string;
  location?: string;
  secondaryLocations?: AshbySecondaryLocation[];
}

// Build the full location string from primary + secondary locations. Ashby's
// posting-api puts extra hiring regions in `secondaryLocations[]` (each with
// a region label + a postalAddress). Using only `j.location` drops them, so
// an EU-eligible role whose primary label is e.g. "Canada" would read as
// Canada-only. We fold in each secondary's region, locality, and country so
// downstream location filtering can match. Deduped, joined with " · ".
function formatLocation(j: AshbyJob): string {
  const parts: string[] = [];
  if (typeof j.location === "string" && j.location.trim()) parts.push(j.location.trim());
  if (Array.isArray(j.secondaryLocations)) {
    for (const s of j.secondaryLocations) {
      if (typeof s.location === "string" && s.location.trim()) parts.push(s.location.trim());
      const pa = s.address?.postalAddress;
      if (pa) {
        for (const k of ["addressLocality", "addressCountry"] as const) {
          const v = pa[k];
          if (typeof v === "string" && v.trim()) parts.push(v.trim());
        }
      }
    }
  }
  return [...new Set(parts)].join(" · ");
}

export const ashbyProvider: ScanProvider = {
  id: "ashby",

  detect(target: ScanTarget) {
    const apiUrl = resolveApiUrl(target);
    return apiUrl ? { url: apiUrl } : null;
  },

  async fetch(target: ScanTarget, ctx: ScanFetchContext) {
    const apiUrl = resolveApiUrl(target);
    if (!apiUrl) throw new Error(`ashby: cannot derive API URL for ${target.company}`);
    const json = (await ctx.fetchJson(apiUrl, { redirect: "error" })) as { jobs?: AshbyJob[] };
    const jobs = Array.isArray(json.jobs) ? json.jobs : [];
    const fetchedAt = new Date().toISOString();
    const out = jobs
      .filter((j) => typeof j.jobUrl !== "string" || isAllowedPostingUrl(j.jobUrl))
      .map((j) => ({
        title: j.title ?? "",
        url: j.jobUrl ?? "",
        company: target.company,
        location: formatLocation(j),
        source: "ashby",
        sourceKind: "structured" as const,
        fetchedAt,
      }));
    if (out.length === 0) {
      process.stderr.write(`warn: ashby: ${target.company}: 0 postings returned\n`);
    }
    return out;
  },
};
