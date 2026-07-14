import type { ScanFetchContext, ScanProvider, ScanTarget } from "@selfwright/core";

// WeWorkRemotely (WWR) provider — fetches a category RSS feed and parses job listings.
// API: https://weworkremotely.com/categories/{category}.rss → RSS 2.0 XML
// No authentication required (public RSS feed).
//
// RSS URL resolved from:
//   api: https://weworkremotely.com/categories/{category}.rss — explicit full URL
//   (default) https://weworkremotely.com/categories/remote-programming-jobs.rss
//
// RSS shape (live-verified 2026-07-13 against remote-programming-jobs.rss → 25 items):
//   <item>
//     <title><![CDATA[CompanyName: Job Title]]></title>
//     <link>https://weworkremotely.com/remote-jobs/...</link>
//     <pubDate>Tue, 30 Jun 2026 20:31:08 +0000</pubDate>
//     <region><![CDATA[Anywhere in the World]]></region>
//     <description><![CDATA[<img ...><p>...HQ info...</p>...]]></description>
//     <guid>https://weworkremotely.com/remote-jobs/...</guid>
//   </item>
//
// Company name is parsed from the title prefix: "CompanyName: Job Title".
//
// SSRF: the API endpoint and all posting URLs must be on weworkremotely.com (HTTPS only).
//   Checked against the URL-parsed hostname, not bare string match.

const TRUSTED_HOSTS = new Set(["weworkremotely.com", "www.weworkremotely.com"]);
const DEFAULT_FEED_URL =
  "https://weworkremotely.com/categories/remote-programming-jobs.rss";

function assertWwrUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`weworkremotely: invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`weworkremotely: URL must use HTTPS: ${url}`);
  }
  if (!TRUSTED_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `weworkremotely: untrusted hostname "${parsed.hostname}" — must be weworkremotely.com`,
    );
  }
  return url;
}

function isAllowedPostingUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && TRUSTED_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

// Minimal RSS 2.0 parser — extracts text/CDATA from a named element within
// an item block. No external dependencies: the WWR feed is well-structured
// RSS 2.0 and does not require a full XML parser.
function extractTagContent(itemXml: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const m = re.exec(itemXml);
  if (!m) return "";
  const raw = (m[1] ?? "").trim();
  // Handle CDATA sections: <![CDATA[...]]>
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(raw);
  return cdata ? (cdata[1] ?? "").trim() : raw;
}

function extractItems(rss: string): string[] {
  const items: string[] = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rss)) !== null) {
    items.push(m[1] ?? "");
  }
  return items;
}

// Parse "CompanyName: Job Title" — split on the first ": " sequence.
// If no colon is present, the entire string is the title; company falls back to target.company.
function parseTitleCompany(raw: string): { title: string; parsedCompany: string | null } {
  const idx = raw.indexOf(": ");
  if (idx === -1) return { title: raw.trim(), parsedCompany: null };
  return {
    parsedCompany: raw.slice(0, idx).trim(),
    title: raw.slice(idx + 2).trim(),
  };
}

function resolveFeedUrl(target: ScanTarget): string {
  if (target.api) {
    assertWwrUrl(target.api);
    return target.api;
  }
  return DEFAULT_FEED_URL;
}

export const weworkremotelyProvider: ScanProvider = {
  id: "weworkremotely",

  detect(target: ScanTarget) {
    if (target.provider !== "weworkremotely") return null;
    const url = resolveFeedUrl(target);
    return { url };
  },

  async fetch(target: ScanTarget, ctx: ScanFetchContext) {
    const feedUrl = resolveFeedUrl(target);
    assertWwrUrl(feedUrl);

    const rssText = await ctx.fetchText(feedUrl, { redirect: "error" });
    const itemBlocks = extractItems(rssText);

    const fetchedAt = new Date().toISOString();
    const out = [];

    for (const block of itemBlocks) {
      const rawTitle = extractTagContent(block, "title");
      const link = extractTagContent(block, "link");
      const region = extractTagContent(block, "region");

      if (!rawTitle) continue;
      if (!link || !isAllowedPostingUrl(link)) continue;

      const { title, parsedCompany } = parseTitleCompany(rawTitle);
      if (!title) continue;

      const company = parsedCompany ?? target.company;
      out.push({
        title,
        url: link,
        company,
        location: region || "Remote",
        source: "weworkremotely",
        sourceKind: "structured" as const,
        fetchedAt,
      });
    }

    if (out.length === 0) {
      process.stderr.write(
        `warn: weworkremotely: ${target.company}: 0 postings returned from ${feedUrl}\n`,
      );
    }

    return out;
  },
};
