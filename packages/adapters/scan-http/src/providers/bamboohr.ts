import type { ScanFetchContext, ScanProvider, ScanTarget } from "@selfwright/core";

// Ported from santifer/career-ops's providers/bamboohr.mjs — hits the public
// per-tenant careers list API. Auto-detects from a careersUrl pattern
// `https://<tenant>.bamboohr.com[/...]`. Per-tenant subdomains are the
// variable part, so SSRF defence uses a regex match on
// `<safe-tenant>.bamboohr.com` rather than a static host allowlist (unlike
// Greenhouse's fixed set of hosts).
//
// The list endpoint (`/careers/list`) returns lightweight metadata — enough
// for the RawPosting contract (title, url, location) at zero token cost. The
// full JD lives behind a second `/careers/<id>/detail` request, which is
// deliberately skipped to stay zero-token (so `description` is omitted).

const BAMBOOHR_HOST_RE = /^[a-z0-9][a-z0-9-]*\.bamboohr\.com$/;

function assertBambooHRUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`bamboohr: invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") throw new Error(`bamboohr: URL must use HTTPS: ${url}`);
  if (!BAMBOOHR_HOST_RE.test(parsed.hostname)) {
    throw new Error(`bamboohr: untrusted hostname "${parsed.hostname}" — must match <tenant>.bamboohr.com`);
  }
  return url;
}

// Resolves the tenant origin (`https://<tenant>.bamboohr.com`) from a target.
// Honours an explicit `api` URL, else parses `careersUrl`.
function resolveOrigin(target: ScanTarget): string | null {
  const raw = (target.api || target.careersUrl || "").trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (!BAMBOOHR_HOST_RE.test(parsed.hostname)) return null;
  return `https://${parsed.hostname}`;
}

interface BambooHRJob {
  id?: unknown;
  jobOpeningName?: string;
  location?: { city?: string; state?: string };
  isRemote?: unknown;
}

export const bambooHrProvider: ScanProvider = {
  id: "bamboohr",

  detect(target: ScanTarget) {
    const origin = resolveOrigin(target);
    return origin ? { url: `${origin}/careers/list` } : null;
  },

  async fetch(target: ScanTarget, ctx: ScanFetchContext) {
    const origin = resolveOrigin(target);
    if (!origin) throw new Error(`bamboohr: cannot derive API URL for ${target.company}`);
    const apiUrl = `${origin}/careers/list`;
    assertBambooHRUrl(apiUrl);
    // redirect:"error" + the host check above keep the final hostname pinned to
    // the tenant — a server-side redirect can't bounce us off-domain (SSRF).
    const json = (await ctx.fetchJson(apiUrl, { redirect: "error" })) as { result?: BambooHRJob[] };
    const rows = Array.isArray(json.result) ? json.result : [];
    const fetchedAt = new Date().toISOString();
    const out = rows
      .filter(
        (j): j is BambooHRJob & { jobOpeningName: string; id: string | number } =>
          typeof j.jobOpeningName === "string" &&
          j.jobOpeningName.length > 0 &&
          (typeof j.id === "string" || typeof j.id === "number") &&
          String(j.id).trim().length > 0,
      )
      .map((j) => {
        const loc = j.location ?? {};
        const remote = j.isRemote ? "Remote" : "";
        const location = [loc.city, loc.state, remote].filter(Boolean).join(", ");
        const id = String(j.id).trim();
        return {
          title: j.jobOpeningName,
          url: `${origin}/careers/${encodeURIComponent(id)}`,
          company: target.company,
          location,
          source: "bamboohr",
          sourceKind: "structured" as const,
          fetchedAt,
        };
      });
    if (out.length === 0) {
      process.stderr.write(`warn: bamboohr: ${target.company}: 0 postings returned\n`);
    }
    return out;
  },
};
