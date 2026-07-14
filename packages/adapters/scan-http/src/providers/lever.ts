import type { ScanFetchContext, ScanProvider, ScanTarget } from "@selfwright/core";

// Ported from santifer/career-ops's providers/lever.mjs — hits the public
// postings endpoint. Auto-detects from a careersUrl pattern
// `https://jobs.lever.co/<slug>`. The API host is always the fixed
// `api.lever.co` (never derived from user-controlled input), so there is no
// hostname-allowlist step here unlike Greenhouse's explicit `api` override.
//
// resolveApiUrl parses careersUrl as a real URL and checks .hostname exactly
// (not a substring/regex match against the raw string) -- found in review:
// the original regex-only version (`/jobs\.lever\.co\/.../ .exec(url)`) was
// an unanchored substring match, so a crafted careersUrl like
// "https://evil.example/jobs.lever.co/acme" would also match. Not currently
// exploitable (the derived request always targets the hardcoded
// api.lever.co host regardless of what matched), but fragile: a future edit
// that used the matched substring for anything host-related would silently
// reintroduce an SSRF path. Parsing the URL properly removes that footgun.

const LEVER_POSTING_HOST = "jobs.lever.co";

function resolveApiUrl(target: ScanTarget): string | null {
  const raw = target.careersUrl ?? "";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== LEVER_POSTING_HOST) return null;
  const slug = parsed.pathname.split("/").filter(Boolean)[0];
  if (!slug) return null;
  return `https://api.lever.co/v0/postings/${slug}`;
}

// Finding 3 (SSRF, defense in depth): `hostedUrl` comes verbatim from
// Lever's third-party JSON response — nothing about the fixed api.lever.co
// endpoint constrains what a posting's own hostedUrl can be. A posting whose
// hostedUrl fails this check is dropped rather than passed downstream (it
// would otherwise reach fetchRendered's real-browser navigation for an
// "uncertain" liveness re-check).
function isAllowedPostingUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === LEVER_POSTING_HOST;
  } catch {
    return false;
  }
}

interface LeverPosting {
  text?: string;
  hostedUrl?: string;
  categories?: { location?: string };
  descriptionPlain?: string;
  createdAt?: number;
}

export const leverProvider: ScanProvider = {
  id: "lever",

  detect(target: ScanTarget) {
    const apiUrl = resolveApiUrl(target);
    return apiUrl ? { url: apiUrl } : null;
  },

  async fetch(target: ScanTarget, ctx: ScanFetchContext) {
    const apiUrl = resolveApiUrl(target);
    if (!apiUrl) throw new Error(`lever: cannot derive API URL for ${target.company}`);
    const json = await ctx.fetchJson(apiUrl, { redirect: "error" });
    if (!Array.isArray(json)) return [];
    const fetchedAt = new Date().toISOString();
    const out = (json as LeverPosting[])
      .filter((j) => typeof j.hostedUrl !== "string" || isAllowedPostingUrl(j.hostedUrl))
      .map((j) => ({
        title: j.text ?? "",
        url: j.hostedUrl ?? "",
        company: target.company,
        location: j.categories?.location ?? "",
        // Lever's v0 postings list ships the full description for free (same
        // payload, no per-job request) — enables liveness/fit scoring without
        // a second fetch.
        ...(typeof j.descriptionPlain === "string" ? { description: j.descriptionPlain } : {}),
        source: "lever",
        sourceKind: "structured" as const,
        fetchedAt,
      }));
    if (out.length === 0) {
      process.stderr.write(`warn: lever: ${target.company}: 0 postings returned\n`);
    }
    return out;
  },
};
