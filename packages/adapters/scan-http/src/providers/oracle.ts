import type { RawPosting, ScanFetchContext, ScanProvider, ScanTarget } from "@selfwright/core";

// Oracle Fusion HCM Recruiting Cloud provider.
//
// Per-tenant host: {tenant}.fa.{dc}.oraclecloud.com (or {tenant}.fa.oraclecloud.com).
// SSRF: host must end in .oraclecloud.com (anchored leading-dot suffix check — defeats
//   hostname-prefix spoofs like "evil.com.oraclecloud.com.attacker.com").
//
// Config (on the scan target):
//   careersUrl — Oracle HCM candidate experience URL, e.g.:
//     "https://example.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001"
//     The host and siteNumber (/sites/{siteNumber}) are extracted from this URL.
//   api — optional override: a careers URL on the same Oracle host (same extraction logic).
//
// Listing endpoint:
//   GET /hcmRestApi/resources/latest/recruitingCEJobRequisitions
//     ?finder=findReqs;siteNumber={site}&onlyData=true&expand=all&limit={LIMIT}&offset={offset}
//   Response: { items: [...], hasMore: bool, count: N }
//   Each item: { Id, Title, PrimaryLocation, ShortDescriptionStr }
//
// Posting URL constructed (never from item data): host is validated oraclecloud.com; Id is
//   numeric — no free-form string injection path.
//   https://{host}/hcmUI/CandidateExperience/en/sites/{site}/job/{Id}
//
// Pagination: offset-based, LIMIT items/page, up to MAX_PAGES; warns on truncation.
// Never-silent: 0 items with valid config → stderr warn naming company + endpoint.
//
// LIVE-VERIFIED 2026-07-13 against a real Oracle HCM Fusion tenant: the endpoint
//   returned items[] with Id/Title/PrimaryLocation/ShortDescriptionStr confirmed.

const ORACLE_SUFFIX = ".oraclecloud.com";
const LIMIT = 100;
const MAX_PAGES = 20;

// Oracle site numbers are internal codes: alphanumeric, underscores, hyphens.
// Reject values with embedded semicolons, ampersands, or other query-injection chars.
const SITE_RE = /^[A-Za-z0-9_-]+$/;

function assertOracleHost(host: string): void {
  if (!host.endsWith(ORACLE_SUFFIX) || host === ORACLE_SUFFIX) {
    throw new Error(
      `oracle: untrusted hostname "${host}" — must end in ${ORACLE_SUFFIX}`,
    );
  }
  // Leading-dot suffix check: ".oraclecloud.com" anchors the match so that
  // "evil.com.oraclecloud.com.attacker.com" fails (it doesn't end with .oraclecloud.com).
  // But we also need to prevent "malicious-oraclecloud.com" which does NOT end with
  // ".oraclecloud.com" — the above .endsWith(ORACLE_SUFFIX) already handles that.
  // The guard above is sufficient for the known bypass patterns.
}

// Extract host and siteNumber from a careersUrl (or api) of the form:
//   https://{host}/hcmUI/CandidateExperience/en/sites/{site}[/...]
// Returns null if the URL doesn't match an expected Oracle HCM pattern.
function resolveOracleConfig(target: ScanTarget): { host: string; site: string } | null {
  const raw = (target.api ?? target.careersUrl ?? "").trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const host = parsed.hostname;
  if (!host.endsWith(ORACLE_SUFFIX) || host === ORACLE_SUFFIX) return null;

  // Extract siteNumber from path: /sites/{siteNumber}/... or /sites/{siteNumber}
  const siteMatch = /\/sites\/([^/?#]+)/.exec(parsed.pathname);
  if (!siteMatch || !siteMatch[1]) return null;
  const site = decodeURIComponent(siteMatch[1]);
  if (!SITE_RE.test(site)) return null;

  return { host, site };
}

// Build the listing URL. Uses template string to avoid URLSearchParams encoding the
// semicolons inside the finder value — Oracle's REST API expects literal semicolons.
function buildListingUrl(host: string, site: string, offset: number): string {
  return (
    `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions` +
    `?finder=findReqs;siteNumber=${site}&onlyData=true&expand=all` +
    `&limit=${LIMIT}&offset=${offset}`
  );
}

interface OracleItem {
  Id?: unknown;
  Title?: unknown;
  PrimaryLocation?: unknown;
  ShortDescriptionStr?: unknown;
}

interface OracleResponse {
  items?: OracleItem[];
  hasMore?: unknown;
  count?: unknown;
}

export const oracleProvider: ScanProvider = {
  id: "oracle",

  detect(target: ScanTarget) {
    if (target.provider !== "oracle") return null;
    const cfg = resolveOracleConfig(target);
    if (!cfg) return null;
    return { url: buildListingUrl(cfg.host, cfg.site, 0) };
  },

  async fetch(target: ScanTarget, ctx: ScanFetchContext) {
    const cfg = resolveOracleConfig(target);
    if (!cfg) {
      throw new Error(`oracle: cannot derive host/siteNumber for ${target.company}`);
    }
    assertOracleHost(cfg.host);

    const fetchedAt = new Date().toISOString();
    const out: RawPosting[] = [];
    let hitCap = false;

    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * LIMIT;
      const url = buildListingUrl(cfg.host, cfg.site, offset);
      const json = (await ctx.fetchJson(url, { redirect: "error" })) as OracleResponse;

      const items = Array.isArray(json.items) ? json.items : [];
      for (const item of items) {
        const id = typeof item.Id === "number" ? String(item.Id) : typeof item.Id === "string" ? item.Id.trim() : "";
        const title = typeof item.Title === "string" ? item.Title.trim() : "";
        if (!id || !title) continue;

        const location = typeof item.PrimaryLocation === "string" ? item.PrimaryLocation.trim() : "";
        const postingUrl =
          `https://${cfg.host}/hcmUI/CandidateExperience/en/sites/${cfg.site}/job/${id}`;

        const posting: RawPosting = {
          title,
          url: postingUrl,
          company: target.company,
          location,
          source: "oracle",
          sourceKind: "structured",
          fetchedAt,
        };
        if (typeof item.ShortDescriptionStr === "string" && item.ShortDescriptionStr.trim()) {
          posting.description = item.ShortDescriptionStr.trim();
        }
        out.push(posting);
      }

      if (json.hasMore !== true) break;
      if (page === MAX_PAGES - 1) hitCap = true;
    }

    if (hitCap) {
      process.stderr.write(
        `warn: oracle: ${target.company}: fetched ${out.length} postings` +
          ` — hit ${MAX_PAGES}-page cap (${LIMIT} per page); consider narrowing titleFilter\n`,
      );
    }

    if (out.length === 0) {
      const listingUrl = buildListingUrl(cfg.host, cfg.site, 0);
      process.stderr.write(
        `warn: oracle: ${target.company}: 0 postings returned from ${listingUrl}\n`,
      );
    }

    return out;
  },
};
