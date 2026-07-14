import type { ScanFetchContext, ScanProvider, ScanTarget } from "@selfwright/core";

// Breezy HR provider — fetches the public job board JSON for a single company.
// API: https://{company}.breezy.hr/json → JSON array of position objects.
// No authentication required (public board).
//
// API URL is resolved from either:
//   api: https://{company}.breezy.hr/json  — explicit full URL (preferred)
//   careersUrl: https://{company}.breezy.hr — auto-detected from the breezy.hr careers page URL
//
// Response shape (live-verified 2026-07-13 against https://adobe.breezy.hr/json → 1 position):
//   [ { id, friendly_id, name, url, published_date,
//       type: { id, name },
//       location: { name, city, is_remote, country: { name, id }, state: { id, name } },
//       department, company: { name, logo_url, friendly_id } } ]
//
// SSRF: the API endpoint and all posting URLs must be on *.breezy.hr (HTTPS only).
//   Bare endsWith is bypassed by e.g. "evil.breezy.hr.attacker.com" — so we check
//   that a URL-parsed hostname either equals "breezy.hr" or ends with ".breezy.hr".

const TRUSTED_HOST_SUFFIX = ".breezy.hr";
const TRUSTED_APEX = "breezy.hr";

function assertBreezyUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`breezy: invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`breezy: URL must use HTTPS: ${url}`);
  }
  if (parsed.hostname !== TRUSTED_APEX && !parsed.hostname.endsWith(TRUSTED_HOST_SUFFIX)) {
    throw new Error(
      `breezy: untrusted hostname "${parsed.hostname}" — must be on ${TRUSTED_APEX} or *.breezy.hr`,
    );
  }
  return url;
}

// Posting URLs in the API response must also stay on breezy.hr (defense-in-depth).
function isAllowedPostingUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      (parsed.hostname === TRUSTED_APEX || parsed.hostname.endsWith(TRUSTED_HOST_SUFFIX))
    );
  } catch {
    return false;
  }
}

// Resolve the JSON API URL from target config:
//   api field → used directly (must be a *.breezy.hr URL).
//   careersUrl → extract subdomain from {slug}.breezy.hr and build the /json path.
//   Neither set → return null (no slug available, target cannot be fetched).
function resolveApiUrl(target: ScanTarget): string | null {
  if (target.api) {
    assertBreezyUrl(target.api);
    return target.api;
  }
  const careersUrl = target.careersUrl ?? "";
  // Match https://{slug}.breezy.hr or https://{slug}.breezy.hr/...
  const match = /^https:\/\/([a-z0-9-]+)\.breezy\.hr(\/|$)/i.exec(careersUrl);
  if (match) {
    return `https://${(match[1] ?? "").toLowerCase()}.breezy.hr/json`;
  }
  return null;
}

interface BreezyPosition {
  name?: unknown;
  url?: unknown;
  location?: { name?: unknown; is_remote?: unknown };
  company?: { name?: unknown };
}

export const breezyProvider: ScanProvider = {
  id: "breezy",

  detect(target: ScanTarget) {
    if (target.provider !== "breezy") return null;
    const url = resolveApiUrl(target);
    return url !== null ? { url } : null;
  },

  async fetch(target: ScanTarget, ctx: ScanFetchContext) {
    const apiUrl = resolveApiUrl(target);
    if (apiUrl === null) {
      process.stderr.write(
        `warn: breezy: ${target.company}: no API URL — set api: https://{slug}.breezy.hr/json or careersUrl: https://{slug}.breezy.hr\n`,
      );
      return [];
    }

    assertBreezyUrl(apiUrl);
    const fetchedAt = new Date().toISOString();
    const json = (await ctx.fetchJson(apiUrl, { redirect: "error" })) as BreezyPosition[];

    if (!Array.isArray(json)) {
      throw new Error(
        `breezy: ${target.company}: unexpected API response — expected a JSON array`,
      );
    }

    const out = [];
    for (const p of json) {
      if (typeof p.name !== "string" || !p.name.trim()) continue;
      if (typeof p.url !== "string") continue;
      if (!isAllowedPostingUrl(p.url)) continue;
      const locName = typeof p.location?.name === "string" ? p.location.name.trim() : "";
      const remote = p.location?.is_remote === true ? "Remote" : "";
      const location = [locName, remote].filter(Boolean).join(", ");
      const companyName =
        typeof p.company?.name === "string" && p.company.name.trim()
          ? p.company.name.trim()
          : target.company;
      out.push({
        title: p.name.trim(),
        url: p.url,
        company: companyName,
        location,
        source: "breezy",
        sourceKind: "structured" as const,
        fetchedAt,
      });
    }

    if (out.length === 0) {
      process.stderr.write(
        `warn: breezy: ${target.company}: 0 postings returned from ${apiUrl}\n`,
      );
    }

    return out;
  },
};
