import type { ScanFetchContext, ScanProvider, ScanTarget } from "@selfwright/core";

// Ported from santifer/career-ops's providers/greenhouse.mjs — hits the
// public boards-api JSON endpoint. Handles both explicit `api` URLs and
// auto-detection from `careersUrl`.

const ALLOWED_GREENHOUSE_HOSTS = new Set([
  "boards-api.greenhouse.io",
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "job-boards.eu.greenhouse.io",
]);

function assertGreenhouseUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`greenhouse: invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") throw new Error(`greenhouse: URL must use HTTPS: ${url}`);
  if (!ALLOWED_GREENHOUSE_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `greenhouse: untrusted hostname "${parsed.hostname}" — must be one of: ${[...ALLOWED_GREENHOUSE_HOSTS].join(", ")}`,
    );
  }
  return url;
}

// Finding 3 (SSRF, defense in depth): `absolute_url` comes verbatim from
// Greenhouse's third-party JSON response, not from our own construction —
// unlike the API URL above, nothing here guarantees it stays on a
// Greenhouse-owned host. A posting whose absolute_url fails this check is
// dropped rather than passed downstream (it would otherwise reach
// fetchRendered's real-browser navigation for an "uncertain" liveness
// re-check — see packages/adapters/scan-browser).
function isAllowedPostingUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && ALLOWED_GREENHOUSE_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function resolveApiUrl(target: ScanTarget): string | null {
  if (target.api) {
    assertGreenhouseUrl(target.api);
    return target.api;
  }
  const url = target.careersUrl ?? "";
  const match = /job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/.exec(url);
  if (match) return `https://boards-api.greenhouse.io/v1/boards/${match[1]}/jobs`;
  return null;
}

interface GreenhouseJob {
  title?: string;
  absolute_url?: string;
  location?: { name?: string };
}

export const greenhouseProvider: ScanProvider = {
  id: "greenhouse",

  detect(target: ScanTarget) {
    try {
      const apiUrl = resolveApiUrl(target);
      return apiUrl ? { url: apiUrl } : null;
    } catch {
      return null;
    }
  },

  async fetch(target: ScanTarget, ctx: ScanFetchContext) {
    const apiUrl = resolveApiUrl(target);
    if (!apiUrl) throw new Error(`greenhouse: cannot derive API URL for ${target.company}`);
    assertGreenhouseUrl(apiUrl);
    // redirect:"error" prevents SSRF via server-side redirects; combined with
    // assertGreenhouseUrl above it guarantees the final hostname stays in the allowlist.
    const json = (await ctx.fetchJson(apiUrl, { redirect: "error" })) as { jobs?: GreenhouseJob[] };
    const jobs = Array.isArray(json.jobs) ? json.jobs : [];
    const fetchedAt = new Date().toISOString();
    const out = jobs
      .filter((j): j is GreenhouseJob & { absolute_url: string } => typeof j.absolute_url === "string")
      .filter((j) => isAllowedPostingUrl(j.absolute_url))
      .map((j) => ({
        title: j.title ?? "",
        url: j.absolute_url,
        company: target.company,
        location: j.location?.name ?? "",
        source: "greenhouse",
        sourceKind: "structured" as const,
        fetchedAt,
      }));
    if (out.length === 0) {
      process.stderr.write(`warn: greenhouse: ${target.company}: 0 postings returned\n`);
    }
    return out;
  },
};
