import type { RawPosting, ScanFetchContext, ScanProvider, ScanTarget } from "@selfwright/core";

// Adzuna aggregator provider — keyword+location search across Adzuna's
// multi-country jobs index.
//
// API confirmed from https://developer.adzuna.com/docs/search:
//   GET https://api.adzuna.com/v1/api/jobs/{country}/search/{page}
//     ?app_id=...&app_key=...&what_or=...&what_phrase=...&where=...&results_per_page=50
//   Response: { count: N, results: [...] }
//   Each result: { title, redirect_url, company.display_name,
//                  location.display_name, description }
//
// Env vars (required, from environment only — never from files):
//   SELFWRIGHT_ADZUNA_APP_ID   — Adzuna application id
//   SELFWRIGHT_ADZUNA_APP_KEY  — Adzuna application key
// A target is skipped with a clear one-line warn when either is absent.
//
// Config (on the scan target):
//   provider: adzuna
//   country       — 2-letter country code (e.g. "nl", "ch"). Sets the index URL
//                   path: https://api.adzuna.com/v1/api/jobs/<country>/search.
//                   Defaults to "gb" when absent, BUT emits a stderr note when
//                   the default is used together with a locationFilter — that
//                   combination is the silent-failure trap (the GB index does not
//                   contain NL/CH jobs; where=Netherlands on the GB index → 0).
//   titleFilter   — query strategy per entry:
//                     single-word terms → batched into ONE what_or query (any-of).
//                     multi-word terms  → each gets its OWN paginated what_phrase
//                       query (phrase match, paginated up to MAX_PAGES).
//                   Verified 2026-07-12 with live NL API:
//                     what_or=architect+director: 5496 total (OR semantics confirmed)
//                     what_phrase=head+of: 1220 total (phrase scoped)
//                     combining what_phrase+what_or → AND semantics (215) — separate queries needed
//   locationFilter — first entry → `where` query param (free-text city/region
//                   filter WITHIN the selected country index)
//   api           — optional base URL override (overrides `country`), e.g.
//                   "https://api.adzuna.com/v1/api/jobs/us/search"
//                   (must still be on api.adzuna.com)
//
// country (URL path) vs where (query param):
//   `country` selects the national job index (e.g. nl → Netherlands index).
//   `where` adds a free-text city/region filter WITHIN that index.
//   For a Netherlands search: country: "nl", locationFilter: ["Amsterdam"].
//   Using locationFilter: ["Netherlands"] with the default "gb" index returns 0
//   results — the GB index does not contain NL postings.
//
// Pagination: each query runs up to MAX_PAGES pages of RESULTS_PER_PAGE. When
// the cap is hit and more results are available (count > fetched), a stderr warn
// is emitted naming company, fetched/available counts, and the query params.
// Results from all queries are merged and deduped by redirect_url (case-insensitive).
//
// SSRF:
//   - API request: assertAdzunaApiUrl enforces https + api.adzuna.com only.
//   - Posting URLs: redirect_url comes verbatim from Adzuna's response.
//     isAllowedPostingUrl accepts ONLY the 19 country domains Adzuna actually
//     operates, verified 2026-07-12 by sampling redirect_url from every live
//     country API endpoint. Off-domain entries are dropped.

const ADZUNA_API_HOST = "api.adzuna.com";
const DEFAULT_BASE = "https://api.adzuna.com/v1/api/jobs/gb/search";
const RESULTS_PER_PAGE = 50;
const MAX_PAGES = 10;

// Adzuna-operated country domains — verified 2026-07-12 by sampling redirect_url
// from each live country index (gb, us, ca, au, de, fr, nl, ch, be, at, nz, sg,
// in, br, mx, it, es, za, pl). Any other domain in an API response is suspicious.
const ADZUNA_POSTING_DOMAINS = new Set([
  "adzuna.com", // US (also generic)
  "adzuna.co.uk", // GB
  "adzuna.com.au", // AU
  "adzuna.co.nz", // NZ
  "adzuna.com.br", // BR
  "adzuna.com.mx", // MX
  "adzuna.co.za", // ZA
  "adzuna.ca", // CA
  "adzuna.de", // DE
  "adzuna.fr", // FR
  "adzuna.nl", // NL
  "adzuna.ch", // CH
  "adzuna.be", // BE
  "adzuna.at", // AT
  "adzuna.sg", // SG
  "adzuna.in", // IN
  "adzuna.it", // IT
  "adzuna.es", // ES
  "adzuna.pl", // PL
]);

// Pre-computed suffix list for subdomain check (e.g. ".adzuna.nl" accepts "www.adzuna.nl").
const ADZUNA_DOMAIN_SUFFIXES = [...ADZUNA_POSTING_DOMAINS].map((d) => `.${d}`);

function assertAdzunaApiUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`adzuna: invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") throw new Error(`adzuna: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== ADZUNA_API_HOST) {
    throw new Error(
      `adzuna: untrusted hostname "${parsed.hostname}" — must be ${ADZUNA_API_HOST}`,
    );
  }
  return url;
}

// Validate and normalize a 2-letter country code. Returns lowercase code or null.
// Shared by detect() and fetch() to avoid duplicating the regex.
function resolveCountry(raw: string): string | null {
  const c = raw.trim().toLowerCase();
  return /^[a-z]{2}$/.test(c) ? c : null;
}

function resolveBaseUrl(target: ScanTarget): string {
  const raw = target.api?.trim() ?? "";
  if (raw) {
    assertAdzunaApiUrl(raw);
    return raw;
  }
  const country = resolveCountry(target.country?.trim() ?? "");
  if (country) {
    return `https://api.adzuna.com/v1/api/jobs/${country}/search`;
  }
  return DEFAULT_BASE;
}

// Accept only Adzuna-operated country domains (enumerated set + www./subdomain prefix).
// The leading-dot suffix check defeats injection bypasses like adzuna.nl.evil.com
// (ends with "adzuna.nl" but NOT ".adzuna.nl") while accepting www.adzuna.nl.
function isAllowedPostingUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const h = parsed.hostname;
    return (
      ADZUNA_POSTING_DOMAINS.has(h) || ADZUNA_DOMAIN_SUFFIXES.some((s) => h.endsWith(s))
    );
  } catch {
    return false;
  }
}

// Split titleFilter into Adzuna queries:
//   single-word terms → one what_or batch (space-joined, any-of OR semantics)
//   multi-word terms  → one what_phrase per entry (phrase match)
// An empty filter produces a single unfiltered what_or query.
interface AdzunaQuery {
  paramName: "what_or" | "what_phrase";
  paramValue: string;
}

function buildQueries(titleFilter: string[] | undefined): AdzunaQuery[] {
  const terms = (titleFilter ?? []).map((t) => t.trim()).filter(Boolean);
  if (terms.length === 0) return [{ paramName: "what_or", paramValue: "" }];

  const singleWord = terms.filter((t) => !t.includes(" "));
  const multiWord = terms.filter((t) => t.includes(" "));

  const queries: AdzunaQuery[] = [];
  if (singleWord.length > 0) {
    queries.push({ paramName: "what_or", paramValue: singleWord.join(" ") });
  }
  for (const phrase of multiWord) {
    queries.push({ paramName: "what_phrase", paramValue: phrase });
  }
  return queries;
}

interface AdzunaJob {
  title?: string;
  redirect_url?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  description?: string;
}

export const adzunaProvider: ScanProvider = {
  id: "adzuna",

  detect(target: ScanTarget) {
    if (target.provider !== "adzuna") return null;
    const appId = process.env["SELFWRIGHT_ADZUNA_APP_ID"]?.trim();
    const appKey = process.env["SELFWRIGHT_ADZUNA_APP_KEY"]?.trim();
    if (!appId || !appKey) return null;
    // Validate country if present (shares resolveCountry with fetch()).
    const rawCountry = target.country?.trim() ?? "";
    if (rawCountry && resolveCountry(rawCountry) === null) return null;
    try {
      const base = resolveBaseUrl(target);
      return { url: `${base}/1` };
    } catch {
      return null;
    }
  },

  async fetch(target: ScanTarget, ctx: ScanFetchContext) {
    const appId = process.env["SELFWRIGHT_ADZUNA_APP_ID"]?.trim() ?? "";
    const appKey = process.env["SELFWRIGHT_ADZUNA_APP_KEY"]?.trim() ?? "";
    if (!appId || !appKey) {
      process.stderr.write(
        `warn: adzuna: SELFWRIGHT_ADZUNA_APP_ID or SELFWRIGHT_ADZUNA_APP_KEY is not set — skipping ${target.company}\n`,
      );
      return [];
    }

    const rawCountry = target.country?.trim() ?? "";
    if (rawCountry && resolveCountry(rawCountry) === null) {
      process.stderr.write(
        `warn: adzuna: invalid country "${rawCountry}" for ${target.company} — must be a 2-letter code (e.g. nl, ch, gb); skipping\n`,
      );
      return [];
    }

    const resolvedCountry = rawCountry ? (resolveCountry(rawCountry) ?? "gb") : "gb";
    const base = resolveBaseUrl(target);
    assertAdzunaApiUrl(base);

    // Note when the default GB index is used with a locationFilter — this is
    // the silent-failure trap: where=Netherlands on the GB index returns 0.
    if (!target.api && !rawCountry && (target.locationFilter ?? []).length > 0) {
      process.stderr.write(
        `note: adzuna: ${target.company}: no country set — using default "gb" index with locationFilter set; set country: to search the correct national index\n`,
      );
    }

    const queries = buildQueries(target.titleFilter);
    const where = (target.locationFilter ?? [])[0]?.trim() ?? "";
    const fetchedAt = new Date().toISOString();
    // Dedup is case-insensitive across all queries (redirect_url lowercased).
    const seen = new Set<string>();
    const out: RawPosting[] = [];

    for (const query of queries) {
      let totalAvailable = 0;
      let addedThisQuery = 0;
      let hitCap = false;

      for (let page = 1; page <= MAX_PAGES; page++) {
        const url = new URL(`${base}/${page}`);
        url.searchParams.set("app_id", appId);
        url.searchParams.set("app_key", appKey);
        url.searchParams.set("results_per_page", String(RESULTS_PER_PAGE));
        if (query.paramValue) url.searchParams.set(query.paramName, query.paramValue);
        if (where) url.searchParams.set("where", where);

        // assertAdzunaApiUrl ensures the URL stays on api.adzuna.com even after
        // URLSearchParams appended the credentials.
        assertAdzunaApiUrl(url.origin + url.pathname);
        const json = (await ctx.fetchJson(url.toString(), { redirect: "error" })) as {
          results?: AdzunaJob[];
          count?: number;
        };

        if (page === 1 && typeof json.count === "number") {
          totalAvailable = json.count;
        }

        const results = Array.isArray(json.results) ? json.results : [];
        for (const j of results) {
          if (typeof j.redirect_url !== "string") continue;
          if (!isAllowedPostingUrl(j.redirect_url)) continue;
          // Case-insensitive dedup: Adzuna occasionally returns the same URL
          // with different casing across pages or queries.
          const normUrl = j.redirect_url.toLowerCase();
          if (seen.has(normUrl)) continue;
          seen.add(normUrl);
          addedThisQuery++;
          out.push({
            title: j.title ?? "",
            url: j.redirect_url,
            company: j.company?.display_name ?? target.company,
            location: j.location?.display_name ?? "",
            ...(typeof j.description === "string" && j.description.trim()
              ? { description: j.description.trim() }
              : {}),
            source: "adzuna",
            sourceKind: "structured",
            fetchedAt,
          });
        }
        if (results.length < RESULTS_PER_PAGE) break;
        if (page === MAX_PAGES) hitCap = true;
      }

      // Truncation warn: hit the page cap with a full last page and the API
      // reports more results than were fetched.
      if (hitCap) {
        process.stderr.write(
          `warn: adzuna: ${target.company}: fetched ${addedThisQuery} of ${totalAvailable} available` +
            ` (${query.paramName}=${query.paramValue || "(none)"}, country=${resolvedCountry}` +
            `${where ? `, where=${where}` : ""}) — hit ${MAX_PAGES}-page cap; consider narrowing titleFilter\n`,
        );
      }
    }

    // Never-silent rule: warn on zero results with valid keys.
    if (out.length === 0) {
      const queryDesc = queries
        .map((q) => `${q.paramName}=${q.paramValue || "(none)"}`)
        .join(", ");
      process.stderr.write(
        `warn: adzuna: ${target.company}: 0 postings returned (country=${resolvedCountry}, ${queryDesc}, where=${where || "(none)"})\n`,
      );
    }

    return out;
  },
};
