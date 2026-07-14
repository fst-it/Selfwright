import type { ScanFetchContext, ScanProvider, ScanTarget } from "@selfwright/core";

// RemoteOK provider — fetches the public jobs API.
// API: https://remoteok.com/api → JSON array
// No authentication required.
//
// Attribution requirement (per API ToS): applications using this API must link
// back to the RemoteOK job posting URL (the `url` field in each job object)
// without nofollow. See https://remoteok.com/api
//
// Response shape (live-verified 2026-07-13 → 101 elements total):
//   Element [0]: { last_updated: "...", legal: "API Terms of Service: ..." }
//     — legal/attribution notice; MUST be skipped.
//   Elements [1..N]: {
//     id, slug, position (title), company, location, description (HTML),
//     url, apply_url, date, tags, salary_min, salary_max, logo, company_logo
//   }
//
// Job URL field: `url` (e.g. https://remoteOK.com/remote-jobs/...) — the hostname
// is normalised to lowercase by the URL constructor (remoteok.com).
// We use `url` (the remoteok.com page) as the posting URL for SSRF safety; `apply_url`
// may point to an arbitrary external ATS and is not passed downstream.
//
// User-Agent: RemoteOK rate-limits requests that lack a descriptive UA header.
// We send a transparent, project-identifying string. Do NOT impersonate browsers.
//
// titleFilter on the target is applied by the downstream scanner (runScan) and
// does not need to be handled here. The API does not expose a reliable server-side
// keyword filter for aggregate feeds.

const API_URL = "https://remoteok.com/api";
const TRUSTED_HOST = "remoteok.com";
const USER_AGENT = "SelfwrightScanner/0.6.0 (job-aggregation-tool; https://github.com/selfwright)";

function isAllowedPostingUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // URL constructor lowercases the hostname, so "remoteOK.com" → "remoteok.com".
    return parsed.protocol === "https:" && parsed.hostname === TRUSTED_HOST;
  } catch {
    return false;
  }
}

interface RemoteOkJob {
  position?: unknown;
  company?: unknown;
  url?: unknown;
  location?: unknown;
  description?: unknown;
}

// The first element of the RemoteOK API response is the legal/attribution notice,
// not a job. It has `legal` and `last_updated` keys but no `position` key.
function isNoticeElement(el: unknown): boolean {
  if (typeof el !== "object" || el === null) return true;
  const obj = el as Record<string, unknown>;
  return typeof obj["legal"] === "string";
}

export const remoteokProvider: ScanProvider = {
  id: "remoteok",

  detect(target: ScanTarget) {
    if (target.provider !== "remoteok") return null;
    return { url: API_URL };
  },

  async fetch(target: ScanTarget, ctx: ScanFetchContext) {
    const fetchedAt = new Date().toISOString();
    const json = (await ctx.fetchJson(API_URL, {
      redirect: "error",
      headers: { "User-Agent": USER_AGENT },
    })) as unknown[];

    if (!Array.isArray(json)) {
      throw new Error(`remoteok: ${target.company}: unexpected API response — expected a JSON array`);
    }

    const out = [];
    let skippedNotice = false;

    for (const el of json) {
      // Skip the first-element attribution notice (has a `legal` field, no `position`).
      if (!skippedNotice && isNoticeElement(el)) {
        skippedNotice = true;
        continue;
      }

      const job = el as RemoteOkJob;
      if (typeof job.position !== "string" || !job.position.trim()) continue;
      if (typeof job.url !== "string") continue;
      if (!isAllowedPostingUrl(job.url)) continue;

      const company =
        typeof job.company === "string" && job.company.trim()
          ? job.company.trim()
          : target.company;
      const location =
        typeof job.location === "string" ? job.location.trim() : "";
      const description =
        typeof job.description === "string" && job.description.trim()
          ? job.description.trim()
          : undefined;

      out.push({
        title: job.position.trim(),
        url: job.url,
        company,
        location,
        ...(description !== undefined ? { description } : {}),
        source: "remoteok",
        sourceKind: "structured" as const,
        fetchedAt,
      });
    }

    if (out.length === 0) {
      process.stderr.write(
        `warn: remoteok: ${target.company}: 0 postings returned from ${API_URL}\n`,
      );
    }

    return out;
  },
};
