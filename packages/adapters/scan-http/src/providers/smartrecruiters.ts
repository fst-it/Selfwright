import type { RawPosting, ScanFetchContext, ScanProvider, ScanTarget } from "@selfwright/core";

// Ported from santifer/career-ops's providers/smartrecruiters.mjs — hits the
// public postings API. Auto-detects from a careersUrl pattern
// `https://(careers|jobs).smartrecruiters.com/<slug>`.

const ALLOWED_SMARTRECRUITERS_HOSTS = new Set(["api.smartrecruiters.com"]);
const SR_CAREERS_HOSTS = new Set(["careers.smartrecruiters.com", "jobs.smartrecruiters.com"]);
const SR_PAGE_SIZE = 100;
// Rate-limit retry is handled at the http-context level. Page cap raised from
// v1's 3 pages to 10 (1000 postings) to cover large companies without
// hitting career-ops' full 50-page ceiling.
const SR_MAX_PAGES = 10;

function assertSmartRecruitersUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`smartrecruiters: invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") throw new Error(`smartrecruiters: URL must use HTTPS: ${url}`);
  if (!ALLOWED_SMARTRECRUITERS_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `smartrecruiters: untrusted hostname "${parsed.hostname}" — must be one of: ${[...ALLOWED_SMARTRECRUITERS_HOSTS].join(", ")}`,
    );
  }
  return url;
}

function resolveSlug(target: ScanTarget): string | null {
  const raw = target.careersUrl ?? "";
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (!SR_CAREERS_HOSTS.has(parsed.hostname)) return null;
  const slug = parsed.pathname.split("/").filter(Boolean)[0];
  return slug || null;
}

function buildPostingsUrl(slug: string, offset = 0): string {
  return `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=${SR_PAGE_SIZE}&offset=${offset}&status=PUBLIC`;
}

function resolveApiUrl(target: ScanTarget): string | null {
  const slug = resolveSlug(target);
  return slug ? buildPostingsUrl(slug, 0) : null;
}

interface SmartRecruitersLocation {
  fullLocation?: string;
  city?: string;
  region?: string;
  country?: string;
  remote?: boolean;
}

interface SmartRecruitersPosting {
  id?: string;
  name?: string;
  ref?: string;
  location?: SmartRecruitersLocation;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function resolvePostingUrl(j: SmartRecruitersPosting, companyName: string): string {
  if (typeof j.ref === "string") {
    let parsedRef: URL | null;
    try {
      parsedRef = new URL(j.ref);
    } catch {
      parsedRef = null;
    }
    if (
      parsedRef &&
      parsedRef.protocol === "https:" &&
      parsedRef.hostname === "api.smartrecruiters.com" &&
      parsedRef.pathname.startsWith("/v1/companies/")
    ) {
      const restOfPath = parsedRef.pathname.slice("/v1/companies/".length);
      return `https://jobs.smartrecruiters.com/${restOfPath}`;
    }
  }
  if (j.id) {
    const companySlug = slugify(companyName || "");
    if (companySlug) {
      const slugified = slugify(j.name || "");
      return `https://jobs.smartrecruiters.com/${companySlug}/${j.id}-${slugified}`;
    }
  }
  return "";
}

function resolveLocation(loc: SmartRecruitersLocation): string {
  const fullLocation = loc.fullLocation || [loc.city, loc.region, loc.country].filter(Boolean).join(", ");
  const remote = loc.remote ? "Remote" : "";
  return [fullLocation, remote].filter(Boolean).join(", ");
}

export const smartrecruitersProvider: ScanProvider = {
  id: "smartrecruiters",

  detect(target: ScanTarget) {
    const apiUrl = resolveApiUrl(target);
    return apiUrl ? { url: apiUrl } : null;
  },

  async fetch(target: ScanTarget, ctx: ScanFetchContext) {
    const slug = resolveSlug(target);
    if (!slug) throw new Error(`smartrecruiters: cannot derive API URL for ${target.company}`);

    const fetchedAt = new Date().toISOString();
    // Dedup is case-insensitive across pages (posting URL lowercased) — SmartRecruiters
    // can return the same posting on multiple offset pages (same pattern as adzuna).
    const seen = new Set<string>();
    const all: RawPosting[] = [];
    for (let page = 0; page < SR_MAX_PAGES; page++) {
      const apiUrl = buildPostingsUrl(slug, page * SR_PAGE_SIZE);
      assertSmartRecruitersUrl(apiUrl);
      // redirect:"error" prevents SSRF via server-side redirects; combined with
      // assertSmartRecruitersUrl above it guarantees the final hostname stays
      // in the allowlist.
      const json = (await ctx.fetchJson(apiUrl, { redirect: "error" })) as { content?: SmartRecruitersPosting[] };
      const items = Array.isArray(json.content) ? json.content : [];
      if (items.length === 0) break;
      for (const j of items) {
        const postUrl = resolvePostingUrl(j, target.company);
        if (postUrl) {
          const normUrl = postUrl.toLowerCase();
          if (seen.has(normUrl)) continue;
          seen.add(normUrl);
        }
        all.push({
          title: j.name ?? "",
          url: postUrl,
          company: target.company,
          location: resolveLocation(j.location ?? {}),
          source: "smartrecruiters",
          sourceKind: "structured",
          fetchedAt,
        });
      }
      if (items.length < SR_PAGE_SIZE) break; // last page (short)
    }
    if (all.length === 0) {
      process.stderr.write(`warn: smartrecruiters: ${target.company}: 0 postings returned\n`);
    }
    return all;
  },
};
