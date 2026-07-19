import type { RawPosting, ScanFetchContext, ScanProvider, ScanTarget } from "@selfwright/core";

// Remotive aggregator provider — remote-only job board.
//
// API: https://remotive.com/api/remote-jobs
//   Optional query params: ?category=<slug>&search=<keyword>
//   Response: { "job-count": N, "total-job-count": M, jobs: [...] }
//   Each job: { id, url, title, company_name, category,
//               candidate_required_location, publication_date, salary,
//               job_type, tags, description }
//
// API attribution: Remotive asks aggregators to link back to remotive.com and
// credit "Remotive" as the job source. Jobs are linked directly to their
// remotive.com listing pages (not the employer's ATS).
// See https://remotive.com/api for terms.
//
// Config (on the scan target):
//   provider: remotive
//   titleFilter  — first entry used as ?search= keyword
//                  (Remotive full-text search across title + description)
//   api          — optional ?category= slug override; must stay on remotive.com
//
// SSRF: fixed-host lock — only https://remotive.com (+ www.) is ever contacted.
//   Posting URLs are accepted only from the same host (remotive.com / www.).

const API_BASE = "https://remotive.com/api/remote-jobs";
const TRUSTED_HOSTS = new Set(["remotive.com", "www.remotive.com"]);

function assertRemotiveApiUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`remotive: invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`remotive: URL must use HTTPS: ${url}`);
  }
  if (!TRUSTED_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `remotive: untrusted hostname "${parsed.hostname}" — must be remotive.com`,
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

interface RemotiveJob {
  id?: unknown;
  url?: unknown;
  title?: unknown;
  company_name?: unknown;
  candidate_required_location?: unknown;
  category?: unknown;
  publication_date?: unknown;
}

export const remotiveProvider: ScanProvider = {
  id: "remotive",

  detect(target: ScanTarget) {
    if (target.provider !== "remotive") return null;
    return { url: API_BASE };
  },

  async fetch(target: ScanTarget, ctx: ScanFetchContext) {
    const fetchedAt = new Date().toISOString();

    const apiUrl = new URL(API_BASE);
    // titleFilter[0] → ?search= (full-text; Remotive applies it server-side)
    const search = (target.titleFilter ?? [])[0]?.trim() ?? "";
    if (search) apiUrl.searchParams.set("search", search);

    // api field may carry a ?category= slug (must still be on remotive.com)
    const rawApi = target.api?.trim() ?? "";
    if (rawApi) {
      assertRemotiveApiUrl(rawApi);
      const overrideUrl = new URL(rawApi);
      const cat = overrideUrl.searchParams.get("category");
      if (cat) apiUrl.searchParams.set("category", cat);
    }

    assertRemotiveApiUrl(apiUrl.origin + apiUrl.pathname);

    const json = (await ctx.fetchJson(apiUrl.toString(), { redirect: "error" })) as {
      "job-count"?: unknown;
      jobs?: RemotiveJob[];
    };

    if (!Array.isArray(json.jobs)) {
      throw new Error(
        `remotive: unexpected API response for ${target.company} — expected { jobs: [...] }`,
      );
    }

    const out: RawPosting[] = [];
    for (const j of json.jobs) {
      if (typeof j.url !== "string") continue;
      if (!isAllowedPostingUrl(j.url)) continue;
      if (typeof j.title !== "string" || !j.title.trim()) continue;

      const location =
        typeof j.candidate_required_location === "string" && j.candidate_required_location.trim()
          ? j.candidate_required_location.trim()
          : "Remote";

      out.push({
        title: j.title.trim(),
        url: j.url,
        company:
          typeof j.company_name === "string" && j.company_name.trim()
            ? j.company_name.trim()
            : target.company,
        location,
        source: "remotive",
        sourceKind: "structured",
        fetchedAt,
      });
    }

    if (out.length === 0) {
      process.stderr.write(
        `warn: remotive: ${target.company}: 0 postings returned` +
          (search ? ` (search=${search})` : "") +
          "\n",
      );
    }

    return out;
  },
};
