import type { ScanFetchContext, ScanProvider, ScanTarget } from "@selfwright/core";

// Arbeitnow aggregator provider — board-wide job feed (EU/DACH-heavy, with
// international coverage). Public API, no authentication required.
//
// Ported from santifer/career-ops providers/arbeitnow.mjs (MIT).
// API docs: https://www.arbeitnow.com/api/job-board-api
// Response shape: { data: [ { slug, company_name, title, url, location,
//   remote, tags, job_types, created_at } ], links, meta }
//
// The full board is fetched (no ?search= filter) to preserve consistent
// coverage; titleFilter/locationFilter on the target are available to the
// downstream scoring/fit-scoring step, not applied here. Pages are fetched
// until one returns fewer than PER_PAGE items or MAX_PAGES is reached.
//
// SSRF: posting URLs must stay on www.arbeitnow.com — off-host URLs in the
// API response are dropped.

const FEED_BASE = "https://www.arbeitnow.com/api/job-board-api";
const TRUSTED_HOST = "www.arbeitnow.com";
const PER_PAGE = 100;
const MAX_PAGES = 3;

function assertArbeitnowUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`arbeitnow: invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") throw new Error(`arbeitnow: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(
      `arbeitnow: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`,
    );
  }
  return url;
}

// Posting URLs must stay on www.arbeitnow.com; off-host URLs in the
// third-party response are dropped rather than passed downstream (SSRF guard).
function isAllowedPostingUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === TRUSTED_HOST;
  } catch {
    return false;
  }
}

interface ArbeitnowJob {
  title?: string;
  url?: string;
  company_name?: string;
  location?: string;
  remote?: unknown;
  created_at?: unknown;
}

export const arbeitnowProvider: ScanProvider = {
  id: "arbeitnow",

  detect() {
    return { url: `${FEED_BASE}?page=1` };
  },

  async fetch(target: ScanTarget, ctx: ScanFetchContext) {
    assertArbeitnowUrl(FEED_BASE);
    const fetchedAt = new Date().toISOString();
    const out = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `${FEED_BASE}?page=${page}`;
      const json = (await ctx.fetchJson(url, { redirect: "error" })) as {
        data?: ArbeitnowJob[];
      };
      if (!Array.isArray(json.data)) {
        throw new Error(
          `arbeitnow: unexpected API response on page ${page} — expected { data: [...] }`,
        );
      }
      for (const j of json.data) {
        if (typeof j.title !== "string" || !j.title.trim()) continue;
        if (typeof j.url !== "string") continue;
        if (!isAllowedPostingUrl(j.url)) continue;
        const baseLocation = typeof j.location === "string" ? j.location.trim() : "";
        const remote = j.remote === true ? "Remote" : "";
        const location = [baseLocation, remote].filter(Boolean).join(", ");
        out.push({
          title: j.title.trim(),
          url: j.url,
          company: typeof j.company_name === "string" && j.company_name.trim()
            ? j.company_name.trim()
            : "Arbeitnow",
          location,
          source: "arbeitnow",
          sourceKind: "structured" as const,
          fetchedAt,
        });
      }
      if (json.data.length < PER_PAGE) break;
    }

    if (out.length === 0) {
      process.stderr.write(`warn: arbeitnow: ${target.company}: 0 postings returned\n`);
    }
    return out;
  },
};
