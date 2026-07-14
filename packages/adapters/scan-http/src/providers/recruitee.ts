import type { RawPosting, ScanFetchContext, ScanProvider, ScanTarget } from "@selfwright/core";

// Recruitee provider — per-company public offers API.
//
// Endpoint: https://{company}.recruitee.com/api/offers/
// Response: { offers: [...] }  (top-level key is "offers", not "jobs" or "results")
// Each offer: { id, title, slug, location, description (HTML), company_name, careers_url, ... }
//
// SSRF:
//   API host: assertRecruiteeHost enforces https + anchored .recruitee.com suffix.
//   Posting URL: constructed as https://{company}.recruitee.com/o/{slug} — never from
//     offer.careers_url (which may point to the company's custom domain), so the posting URL
//     stays on the validated .recruitee.com host.
//
// Config (on the scan target):
//   careersUrl — company's Recruitee careers URL, e.g.:
//     "https://channable.recruitee.com/" or "https://channable.recruitee.com/api/offers/"
//     Company slug is the subdomain of the .recruitee.com host.
//   api — optional override for the full offers endpoint URL.
//
// Never-silent: 0 offers with valid config → stderr warn naming company + endpoint.
//
// LIVE-VERIFIED 2026-07-13 against channable.recruitee.com (Channable BV): 3 offers;
//   fields title, location, company_name, description (HTML), slug, id confirmed.

const RECRUITEE_SUFFIX = ".recruitee.com";

function assertRecruiteeHost(host: string): void {
  if (!host.endsWith(RECRUITEE_SUFFIX) || host === RECRUITEE_SUFFIX) {
    throw new Error(
      `recruitee: untrusted hostname "${host}" — must end in ${RECRUITEE_SUFFIX}`,
    );
  }
}

// Resolve the Recruitee API URL and company slug from the target config.
// Returns { apiUrl, companySlug } or null if not configured for this provider.
function resolveRecruiteeConfig(target: ScanTarget): { apiUrl: string; companySlug: string } | null {
  const raw = (target.api ?? target.careersUrl ?? "").trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (!parsed.hostname.endsWith(RECRUITEE_SUFFIX) || parsed.hostname === RECRUITEE_SUFFIX) {
    return null;
  }
  const companySlug = parsed.hostname.slice(0, -RECRUITEE_SUFFIX.length);
  if (!companySlug) return null;
  return {
    apiUrl: `https://${parsed.hostname}/api/offers/`,
    companySlug,
  };
}

interface RecruiteeOffer {
  id?: unknown;
  title?: unknown;
  slug?: unknown;
  location?: unknown;
  description?: unknown;
  company_name?: unknown;
}

export const recruiteeProvider: ScanProvider = {
  id: "recruitee",

  detect(target: ScanTarget) {
    if (target.provider !== "recruitee") return null;
    const cfg = resolveRecruiteeConfig(target);
    if (!cfg) return null;
    return { url: cfg.apiUrl };
  },

  async fetch(target: ScanTarget, ctx: ScanFetchContext) {
    const cfg = resolveRecruiteeConfig(target);
    if (!cfg) {
      throw new Error(`recruitee: cannot derive API URL for ${target.company}`);
    }
    assertRecruiteeHost(new URL(cfg.apiUrl).hostname);

    const json = (await ctx.fetchJson(cfg.apiUrl, { redirect: "error" })) as {
      offers?: RecruiteeOffer[];
    };
    const offers = Array.isArray(json.offers) ? json.offers : [];
    const fetchedAt = new Date().toISOString();
    const out: RawPosting[] = [];

    for (const offer of offers) {
      const title = typeof offer.title === "string" ? offer.title.trim() : "";
      const slug = typeof offer.slug === "string" ? offer.slug.trim() : "";
      if (!title || !slug) continue;

      // Construct posting URL on the validated recruitee.com host (never use careers_url
      // which may be on the company's custom domain — SSRF guard).
      const postingUrl = `https://${cfg.companySlug}${RECRUITEE_SUFFIX}/o/${slug}`;
      const location = typeof offer.location === "string" ? offer.location.trim() : "";
      const company =
        typeof offer.company_name === "string" && offer.company_name.trim()
          ? offer.company_name.trim()
          : target.company;

      const posting: RawPosting = {
        title,
        url: postingUrl,
        company,
        location,
        source: "recruitee",
        sourceKind: "structured",
        fetchedAt,
      };
      if (typeof offer.description === "string" && offer.description.trim()) {
        posting.description = offer.description.trim();
      }
      out.push(posting);
    }

    if (out.length === 0) {
      process.stderr.write(
        `warn: recruitee: ${target.company}: 0 offers returned from ${cfg.apiUrl}\n`,
      );
    }

    return out;
  },
};
