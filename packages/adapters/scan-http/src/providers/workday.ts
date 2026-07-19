import type { RawPosting, ScanFetchContext, ScanProvider, ScanTarget } from "@selfwright/core";

// Ported from santifer/career-ops's providers/workday.mjs — hits the public
// CXS jobs endpoint (POST, paginated). Auto-detects from a careersUrl pattern
// `https://<tenant>.<instance>.myworkdayjobs.com[/<locale>]/<site>`,
// e.g. https://23andme.wd5.myworkdayjobs.com/23 ->
//      POST https://23andme.wd5.myworkdayjobs.com/wday/cxs/23andme/23/jobs
//
// Deferred: no inter-page delay (rate limiting handled at the http-context
// retry layer), and no date-based early-stopping.

const PAGE_SIZE = 20;
const MAX_PAGES = 20; // 400 postings — well above any single company's live board

function resolveEndpoint(target: ScanTarget): { api: string; jobBase: string } | null {
  const url = target.careersUrl ?? "";
  const match = /^https:\/\/([\w-]+)\.(wd[\w-]*)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+)/.exec(url);
  if (!match) return null;
  const [, tenant, instance, site] = match;
  const origin = `https://${tenant}.${instance}.myworkdayjobs.com`;
  return {
    api: `${origin}/wday/cxs/${tenant}/${site}/jobs`,
    // externalPath is relative to the site, not the host root — without the
    // site segment the URL 404s.
    jobBase: `${origin}/${site}`,
  };
}

interface WorkdayJobPosting {
  title?: string;
  externalPath?: string;
  locationsText?: string;
}

interface WorkdayResponse {
  jobPostings?: WorkdayJobPosting[];
}

export const workdayProvider: ScanProvider = {
  id: "workday",

  detect(target: ScanTarget) {
    const ep = resolveEndpoint(target);
    return ep ? { url: ep.api } : null;
  },

  async fetch(target: ScanTarget, ctx: ScanFetchContext) {
    const ep = resolveEndpoint(target);
    if (!ep) throw new Error(`workday: cannot derive CXS endpoint for ${target.company}`);
    const fetchedAt = new Date().toISOString();
    const all: RawPosting[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = JSON.stringify({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, searchText: "", appliedFacets: {} });
      const json = (await ctx.fetchJson(ep.api, { method: "POST", body, redirect: "error" })) as WorkdayResponse;
      const postings = Array.isArray(json.jobPostings) ? json.jobPostings : [];
      for (const j of postings.filter((j): j is WorkdayJobPosting & { externalPath: string } => typeof j.externalPath === "string")) {
        all.push({
          title: j.title ?? "",
          // j.externalPath is untrusted (third-party JSON), but it's a plain
          // string suffix appended to the trusted ep.jobBase, never
          // URL-resolved against it — so it cannot redirect the resulting
          // URL to a different host (checked during the Phase 3 SSRF review
          // alongside greenhouse/lever/ashby's verbatim-passthrough fix).
          url: ep.jobBase + j.externalPath,
          company: target.company,
          location: j.locationsText ?? "",
          source: "workday",
          sourceKind: "structured",
          fetchedAt,
        });
      }
      if (postings.length < PAGE_SIZE) break; // last page (short)
    }
    if (all.length === 0) {
      process.stderr.write(`warn: workday: ${target.company}: 0 postings returned\n`);
    }
    return all;
  },
};
