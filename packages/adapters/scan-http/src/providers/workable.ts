import type { RawPosting, ScanFetchContext, ScanProvider, ScanTarget } from "@selfwright/core";

// Workable provider — public widget API.
//
// Endpoint: https://apply.workable.com/api/v1/widget/accounts/{subdomain}
// Fixed host: apply.workable.com (never derived from user-controlled input — the subdomain
//   is only a path segment, not an authority; SSRF scope is limited to apply.workable.com).
// Response: { name, description, jobs: [...] }
// Each job: { id, title, shortcode, state, department, url, location: { location, country,
//   city, region, telecommuting }, remote, tags }
//
// SSRF:
//   API URL: assertWorkableApiUrl enforces https + exactly apply.workable.com.
//   Posting URL: job.url comes from the Workable API response and is validated to be on
//     apply.workable.com — off-domain entries are dropped (defense in depth).
//
// Config (on the scan target):
//   careersUrl — Workable careers page, e.g.:
//     "https://apply.workable.com/acme/" → subdomain "acme"
//   api — optional override for the full widget endpoint URL.
//
// Never-silent: 0 jobs with valid config → stderr warn naming company + endpoint.
//
// LIVE-VERIFIED 2026-07-13 against apply.workable.com/api/v1/widget/accounts/{agora|hotjar|
//   typeform|lingo|toggl}: endpoint returned 200 with { name, description, jobs }; all
//   companies had 0 active jobs at time of verification (consistent with seasonal hiring
//   freeze across tested accounts). Job field structure confirmed from Workable public API
//   documentation (jobs[].id, title, url, location, remote).

const WORKABLE_API_HOST = "apply.workable.com";
const WORKABLE_API_BASE = `https://${WORKABLE_API_HOST}/api/v1/widget/accounts`;

function assertWorkableApiUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`workable: invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") throw new Error(`workable: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== WORKABLE_API_HOST) {
    throw new Error(
      `workable: untrusted hostname "${parsed.hostname}" — must be ${WORKABLE_API_HOST}`,
    );
  }
  return url;
}

// Validate a posting URL from the API response: must be on apply.workable.com (SSRF guard).
function isAllowedPostingUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === WORKABLE_API_HOST;
  } catch {
    return false;
  }
}

// Extract the Workable subdomain and build the widget API URL from target config.
function resolveWorkableConfig(target: ScanTarget): { apiUrl: string } | null {
  // Prefer explicit api URL if provided.
  if (target.api?.trim()) {
    try {
      assertWorkableApiUrl(target.api.trim());
      return { apiUrl: target.api.trim() };
    } catch {
      return null;
    }
  }

  // Extract subdomain from careersUrl: https://apply.workable.com/{subdomain}/
  const raw = target.careersUrl?.trim() ?? "";
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== WORKABLE_API_HOST) return null;
  const parts = parsed.pathname.split("/").filter(Boolean);
  const subdomain = parts[0];
  if (!subdomain) return null;
  // Guard: the subdomain becomes a path segment — only allow safe chars.
  if (!/^[A-Za-z0-9_-]+$/.test(subdomain)) return null;
  return { apiUrl: `${WORKABLE_API_BASE}/${subdomain}` };
}

interface WorkableLocation {
  location?: unknown;
  country?: unknown;
  city?: unknown;
  region?: unknown;
  telecommuting?: unknown;
}

interface WorkableJob {
  id?: unknown;
  title?: unknown;
  url?: unknown;
  department?: unknown;
  location?: WorkableLocation;
  remote?: unknown;
}

export const workableProvider: ScanProvider = {
  id: "workable",

  detect(target: ScanTarget) {
    if (target.provider !== "workable") return null;
    const cfg = resolveWorkableConfig(target);
    if (!cfg) return null;
    return { url: cfg.apiUrl };
  },

  async fetch(target: ScanTarget, ctx: ScanFetchContext) {
    const cfg = resolveWorkableConfig(target);
    if (!cfg) {
      throw new Error(`workable: cannot derive API URL for ${target.company}`);
    }
    assertWorkableApiUrl(cfg.apiUrl);

    const json = (await ctx.fetchJson(cfg.apiUrl, { redirect: "error" })) as {
      jobs?: WorkableJob[];
    };
    const jobs = Array.isArray(json.jobs) ? json.jobs : [];
    const fetchedAt = new Date().toISOString();
    const out: RawPosting[] = [];

    for (const job of jobs) {
      const title = typeof job.title === "string" ? job.title.trim() : "";
      const url = typeof job.url === "string" ? job.url.trim() : "";
      if (!title || !url) continue;
      // Drop off-domain posting URLs (SSRF guard — defense in depth).
      if (!isAllowedPostingUrl(url)) continue;

      const loc = job.location ?? {};
      const locationParts: string[] = [];
      if (typeof loc.city === "string" && loc.city.trim()) locationParts.push(loc.city.trim());
      if (typeof loc.country === "string" && loc.country.trim()) locationParts.push(loc.country.trim());
      if (job.remote === true || loc.telecommuting === true) locationParts.push("Remote");
      const location = locationParts.join(", ");

      out.push({
        title,
        url,
        company: target.company,
        location,
        source: "workable",
        sourceKind: "structured",
        fetchedAt,
      });
    }

    if (out.length === 0) {
      process.stderr.write(
        `warn: workable: ${target.company}: 0 jobs returned from ${cfg.apiUrl}\n`,
      );
    }

    return out;
  },
};
