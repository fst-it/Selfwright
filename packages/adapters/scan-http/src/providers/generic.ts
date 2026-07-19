import type { RawPosting, ScanFetchContext, ScanProvider, ScanTarget } from "@selfwright/core";
import { assertPubliclyRoutableUrl, assertDnsResolvesPublicly } from "../url-guard.js";
import type { ResolveFn } from "../url-guard.js";

// Generic company-page fetcher — for named company career pages that aren't
// on a known ATS platform. Unlike the ATS JSON-API providers, this fetches a
// single, specific posting page (or a career listing page containing one
// posting's worth of content) and treats HTTP status directly as a liveness
// signal via ctx.fetchRaw (never throws on non-2xx) rather than throwing —
// the caller's checkLiveness() classifies the result, including the 403/404
// cases a bot-gated portal returns.
//
// Known limitation, documented rather than silently hidden: some portals
// (e.g. portals fronted by iCIMS with WAF rules) return HTTP 403 to
// automated fetches at the bot-detection layer — this provider cannot bypass
// that; it surfaces the 403 as an "uncertain" liveness verdict via
// checkLiveness rather than crashing or silently returning nothing.

// A sane upper bound on how much of a fetched page is worth processing at
// all -- real career pages are well under this. Combined with the linear
// scan below (not a cap alone): a regex-based `<[^>]+>`-style tag strip is
// O(n^2) on a long run of `<` with no matching `>` (backtracking per
// position) -- found via a live repro during review, an unbounded ~1MB run
// of bare `<` characters stalled a regex-based stripHtml() for minutes.
// Capping input size alone doesn't fix an O(n^2) algorithm (a few hundred KB
// would still be far too slow); stripTags below is a single indexOf-driven
// pass, genuinely O(n) regardless of content, so the cap here is just a
// sane ceiling on work done, not a load-bearing safety mechanism.
const MAX_BODY_CHARS = 2_000_000;

// Strips <script>/<style> contents and all other tags in one linear pass
// (indexOf-driven, no backtracking regex) -- safe against any input shape,
// including pages that are mostly bare `<` with no closing `>`.
function stripTags(html: string): string {
  const lower = html.toLowerCase();
  let result = "";
  let i = 0;
  while (i < html.length) {
    const c = html[i] ?? "";
    if (c !== "<") {
      result += c;
      i++;
      continue;
    }
    if (lower.startsWith("<script", i) || lower.startsWith("<style", i)) {
      const closeTag = lower.startsWith("<script", i) ? "</script" : "</style";
      const closeTagIdx = lower.indexOf(closeTag, i);
      const afterClose = closeTagIdx === -1 ? html.length : html.indexOf(">", closeTagIdx);
      i = afterClose === -1 ? html.length : afterClose + 1;
      result += " ";
      continue;
    }
    const tagEnd = html.indexOf(">", i);
    i = tagEnd === -1 ? html.length : tagEnd + 1;
    result += " ";
  }
  return result;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function stripHtml(html: string): string {
  return normalizeWhitespace(stripTags(html.slice(0, MAX_BODY_CHARS)));
}

function extractTitle(html: string): string | null {
  const capped = html.slice(0, MAX_BODY_CHARS);
  const lower = capped.toLowerCase();
  const openIdx = lower.indexOf("<title");
  if (openIdx === -1) return null;
  const openTagEnd = capped.indexOf(">", openIdx);
  if (openTagEnd === -1) return null;
  const closeIdx = lower.indexOf("</title", openTagEnd);
  if (closeIdx === -1) return null;
  return normalizeWhitespace(stripTags(capped.slice(openTagEnd + 1, closeIdx)));
}

// ── schema.org JobPosting JSON-LD extraction ─────────────────────────────────
//
// Walks the first MAX_BODY_CHARS of a fetched HTML page looking for
// <script type="application/ld+json"> blocks, parses each as JSON, and collects
// JobPosting objects (directly or nested in @graph / ItemList).
//
// Integration decision: folded into generic (not a separate `jsonld` provider)
// because generic already owns the page fetch + SSRF guard, and this makes
// every generic target automatically benefit without requiring a new provider id,
// a new KNOWN_PROVIDERS entry, or additional wiring. The fetch method tries
// JSON-LD extraction first; if it yields postings, those are returned as
// `sourceKind: "structured"`. If no JobPosting JSON-LD is found, the method
// falls through to the existing scraped-page behaviour.
//
// Never-silent: if the page has application/ld+json blocks but none contain a
// JobPosting type, a stderr warn is emitted (surprising — structured data
// present but not job-typed). If the page has no ld+json at all, the fallback
// scrape runs silently (normal for most single-posting pages).

/** Extract raw text content from all <script type="application/ld+json"> blocks. */
function extractJsonLdBlocks(html: string): string[] {
  const capped = html.slice(0, MAX_BODY_CHARS);
  const lower = capped.toLowerCase();
  const results: string[] = [];
  let i = 0;
  while (i < capped.length) {
    const scriptStart = lower.indexOf("<script", i);
    if (scriptStart === -1) break;
    const tagEnd = capped.indexOf(">", scriptStart);
    if (tagEnd === -1) break;
    const openTag = lower.slice(scriptStart, tagEnd + 1);
    if (openTag.includes("application/ld+json")) {
      const closeIdx = lower.indexOf("</script", tagEnd + 1);
      const content = closeIdx === -1 ? capped.slice(tagEnd + 1) : capped.slice(tagEnd + 1, closeIdx);
      results.push(content);
      i = closeIdx === -1 ? capped.length : closeIdx;
    } else {
      i = tagEnd + 1;
    }
  }
  return results;
}

type JsonObj = Record<string, unknown>;

/** Collect all raw JSON-LD JobPosting objects from a parsed value. */
function collectJobPostings(parsed: unknown): JsonObj[] {
  if (typeof parsed !== "object" || parsed === null) return [];
  const obj = parsed as JsonObj;
  const type = obj["@type"];

  if (type === "JobPosting") return [obj];

  // @graph array: collect JobPosting nodes
  if (Array.isArray(obj["@graph"])) {
    const items: JsonObj[] = [];
    for (const node of obj["@graph"] as unknown[]) {
      items.push(...collectJobPostings(node));
    }
    return items;
  }

  // ItemList: each itemListElement may be a ListItem wrapping a JobPosting or a JobPosting directly
  if (type === "ItemList" && Array.isArray(obj["itemListElement"])) {
    const items: JsonObj[] = [];
    for (const elem of obj["itemListElement"] as unknown[]) {
      if (typeof elem !== "object" || elem === null) continue;
      const e = elem as JsonObj;
      // ListItem wrapping an item
      if (e["@type"] === "ListItem" && typeof e["item"] === "object" && e["item"] !== null) {
        items.push(...collectJobPostings(e["item"]));
      } else {
        items.push(...collectJobPostings(e));
      }
    }
    return items;
  }

  return [];
}

function extractLocation(jp: JsonObj): string {
  if (jp["jobLocationType"] === "TELECOMMUTE") return "Remote";
  const jl = jp["jobLocation"];
  if (jl === undefined) return "";
  const loc = Array.isArray(jl) ? (jl[0] as JsonObj | undefined) : (jl as JsonObj);
  if (!loc) return "";
  if (typeof loc["name"] === "string" && loc["name"].trim()) return loc["name"].trim();
  if (typeof loc["address"] === "object" && loc["address"] !== null) {
    const addr = loc["address"] as JsonObj;
    const parts = [addr["addressLocality"], addr["addressRegion"], addr["addressCountry"]]
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .map((v) => v.trim());
    return parts.join(", ");
  }
  return "";
}

/**
 * Parse all JSON-LD blocks in `html` and return any JobPosting objects as
 * RawPostings. Falls back to `pageUrl` when the JobPosting lacks its own url.
 * Returns { postings, hadLdJson } so the caller can distinguish "no ld+json at
 * all" from "ld+json found but no JobPosting" for the never-silent warn.
 */
export function extractJsonLdPostings(
  html: string,
  pageUrl: string,
  company: string,
  fetchedAt: string,
): { postings: RawPosting[]; hadLdJson: boolean } {
  const blocks = extractJsonLdBlocks(html);
  if (blocks.length === 0) return { postings: [], hadLdJson: false };

  const postings: RawPosting[] = [];
  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }
    for (const jp of collectJobPostings(parsed)) {
      const title = typeof jp["title"] === "string" ? jp["title"].trim() : "";
      if (!title) continue;

      let orgName = company;
      if (typeof jp["hiringOrganization"] === "object" && jp["hiringOrganization"] !== null) {
        const org = jp["hiringOrganization"] as JsonObj;
        if (typeof org["name"] === "string" && org["name"].trim()) {
          orgName = org["name"].trim();
        }
      } else if (typeof jp["hiringOrganization"] === "string" && jp["hiringOrganization"].trim()) {
        orgName = jp["hiringOrganization"].trim();
      }

      const postUrl =
        typeof jp["url"] === "string" && jp["url"].trim() ? jp["url"].trim() : pageUrl;
      const location = extractLocation(jp);

      postings.push({
        title,
        url: postUrl,
        company: orgName,
        location,
        source: "generic",
        sourceKind: "structured",
        fetchedAt,
      });
    }
  }

  return { postings, hadLdJson: true };
}

/**
 * Creates the generic provider with an injectable DNS resolver (for tests).
 * Production code uses the default export `genericProvider`, which uses the
 * real DNS resolver.
 */
export function createGenericProvider(resolveFn?: ResolveFn): ScanProvider {
  return {
    id: "generic",

    detect(target: ScanTarget) {
      const url = target.careersUrl ?? target.api;
      return url ? { url } : null;
    },

    async fetch(target: ScanTarget, ctx: ScanFetchContext) {
      const url = target.careersUrl ?? target.api;
      if (!url) throw new Error(`generic: no careersUrl/api configured for ${target.company}`);
      // SSRF guard: rejects private/loopback/link-local IPs and non-HTTPS.
      // Needed because scan-targets.yml is now writable via PUT /api/scan-targets.
      assertPubliclyRoutableUrl(url);
      await assertDnsResolvesPublicly(url, resolveFn);
      const raw = await ctx.fetchRaw(url, { redirect: "error" });
      const fetchedAt = new Date().toISOString();

      // JSON-LD first-pass: extract schema.org JobPosting blocks deterministically.
      const { postings, hadLdJson } = extractJsonLdPostings(raw.text, url, target.company, fetchedAt);
      if (postings.length > 0) return postings;

      // Warn if ld+json was present but contained no JobPosting types — that is
      // surprising and worth surfacing to the operator.
      if (hadLdJson) {
        process.stderr.write(
          `warn: generic: ${target.company}: page has application/ld+json but no JobPosting type found — falling back to scraped mode\n`,
        );
      }

      // Scrape fallback: return a single posting whose httpStatus + description
      // feed evaluatePosting()'s checkLiveness call.
      const description = stripHtml(raw.text);
      const title = extractTitle(raw.text) ?? target.titleFilter?.[0] ?? target.company;
      return [
        {
          url,
          title,
          company: target.company,
          location: target.locationFilter?.[0] ?? "",
          description,
          // Feeds evaluatePosting()'s checkLiveness call — this is what makes a
          // 403 (bot-gated) or 404/410 (genuinely gone) classify correctly
          // instead of falling back to text-pattern-only classification.
          httpStatus: raw.status,
          finalUrl: raw.finalUrl,
          source: "generic",
          sourceKind: "scraped",
          fetchedAt,
        },
      ];
    },
  };
}

export const genericProvider: ScanProvider = createGenericProvider();
