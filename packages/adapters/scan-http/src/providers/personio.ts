import type { RawPosting, ScanFetchContext, ScanProvider, ScanTarget } from "@selfwright/core";

// Personio provider — public XML job feed (workzag-jobs format).
//
// Endpoint: https://{company}.jobs.personio.de/xml
//   (or https://{company}.jobs.personio.com/xml for the .com variant)
// Response: XML with <workzag-jobs><position>...</position></workzag-jobs>
// Each <position>: <id>, <name> (title), <office> (location), <subcompany>, <department>,
//   <jobDescriptions>/<jobDescription>/<value> (optional HTML description).
//
// The XML feed does not include a posting URL; posting URL is constructed as:
//   https://{company}.jobs.personio.de/job/{id}
//   (or .personio.com variant to match the feed host)
//
// SSRF:
//   assertPersonioHost enforces https + anchored host suffix check:
//     hostname must end in .jobs.personio.de or .jobs.personio.com.
//   Posting URLs are always constructed from the same validated host — no external domain.
//
// Config (on the scan target):
//   careersUrl — company's Personio job feed URL, e.g.:
//     "https://acme.jobs.personio.de/xml" or "https://acme.jobs.personio.de/"
//     Company slug is the subdomain; host determines .de vs .com variant.
//   api — optional override for the full XML feed URL.
//
// XML parsing: minimal regex-based extractor (no external XML dep); handles common
//   XML entity escapes (&amp; &lt; &gt; &quot; &apos;).
//
// Never-silent: 0 positions with valid config → stderr warn naming company + endpoint.
//
// LIVE-VERIFIED 2026-07-13 against personio.jobs.personio.de/xml (Personio SE & Co. KG):
//   1 position returned; fields id, name, office, department, subcompany confirmed.
//   Root element: <workzag-jobs>; position child: <position>.

const PERSONIO_SUFFIXES = [".jobs.personio.de", ".jobs.personio.com"] as const;

function assertPersonioHost(host: string): void {
  if (!PERSONIO_SUFFIXES.some((s) => host.endsWith(s) && host !== s)) {
    throw new Error(
      `personio: untrusted hostname "${host}" — must end in ${PERSONIO_SUFFIXES.join(" or ")}`,
    );
  }
}

function resolvePersonioConfig(target: ScanTarget): { xmlUrl: string; host: string } | null {
  const raw = (target.api ?? target.careersUrl ?? "").trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const host = parsed.hostname;
  if (!PERSONIO_SUFFIXES.some((s) => host.endsWith(s) && host !== s)) return null;
  return { xmlUrl: `https://${host}/xml`, host };
}

// Decode common XML character entity references.
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 10)));
}

// Extract the text content of the first occurrence of <tag>...</tag> in `block`.
// Handles both self-closing absence and content with simple text (no nested same-tag).
function xmlTextOf(tag: string, block: string): string {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`).exec(block);
  if (!m || m[1] === undefined) return "";
  return decodeXmlEntities(m[1].trim());
}

// Extract text from a CDATA section or plain text within <value>...</value>.
function xmlCdataOrText(block: string): string {
  // CDATA section: <![CDATA[...]]>
  const cdata = /<!\[CDATA\[([\s\S]*?)]]>/.exec(block);
  if (cdata && cdata[1] !== undefined) return cdata[1].trim();
  return decodeXmlEntities(block.trim());
}

interface ParsedPosition {
  id: string;
  name: string;
  office: string;
  subcompany: string;
  department: string;
  descriptionHtml: string;
}

// Extract all <position>...</position> content blocks from the XML, CDATA-aware.
// A CDATA section (<![CDATA[...]]>) may contain literal </position> text that
// must not be treated as the closing tag — e.g. a job description whose HTML
// mentions "</position>" would otherwise prematurely truncate the block, causing
// the id/name fields that follow it to be dropped.
//
// This replaces the previous split(/<position[^>]*>/) + indexOf("</position>")
// approach which was fragile to that case.
function extractPositionBlocks(xml: string): string[] {
  const OPEN = "<position";
  const CLOSE = "</position>";
  const CDATA_OPEN = "<![CDATA[";
  const CDATA_CLOSE = "]]>";
  const blocks: string[] = [];
  let pos = 0;

  while (pos < xml.length) {
    const openStart = xml.indexOf(OPEN, pos);
    if (openStart === -1) break;
    // Skip to end of the opening tag (past its ">")
    const tagEnd = xml.indexOf(">", openStart);
    if (tagEnd === -1) break;
    const contentStart = tagEnd + 1;

    // Scan for the real </position>, skipping CDATA sections that may contain
    // literal </position> text.
    let scan = contentStart;
    let closeFound = -1;
    while (scan < xml.length) {
      const cdataStart = xml.indexOf(CDATA_OPEN, scan);
      const closeTag = xml.indexOf(CLOSE, scan);
      if (closeTag === -1) break; // malformed XML — no closing tag found
      if (cdataStart !== -1 && cdataStart < closeTag) {
        // A CDATA section opens before the close tag — skip past the CDATA.
        const cdataEnd = xml.indexOf(CDATA_CLOSE, cdataStart + CDATA_OPEN.length);
        if (cdataEnd === -1) break; // malformed CDATA — give up on this position
        scan = cdataEnd + CDATA_CLOSE.length;
      } else {
        closeFound = closeTag;
        break;
      }
    }

    if (closeFound === -1) break; // no valid closing tag found
    blocks.push(xml.slice(contentStart, closeFound));
    pos = closeFound + CLOSE.length;
  }

  return blocks;
}

// Parse the Personio workzag-jobs XML feed into an array of positions.
// Uses a regex approach because no XML parser is in the repo's direct deps.
function parsePersonioXml(xml: string): ParsedPosition[] {
  const positions: ParsedPosition[] = [];

  const blocks = extractPositionBlocks(xml);

  for (const block of blocks) {

    const id = xmlTextOf("id", block);
    const name = xmlTextOf("name", block);
    if (!id || !name) continue;

    // Description: nested in <jobDescriptions><jobDescription><value>...</value>
    let descriptionHtml = "";
    const jdBlock = /<jobDescriptions[^>]*>([\s\S]*?)<\/jobDescriptions>/.exec(block);
    if (jdBlock && jdBlock[1]) {
      const valueBlock = /<value[^>]*>([\s\S]*?)<\/value>/.exec(jdBlock[1]);
      if (valueBlock && valueBlock[1] !== undefined) {
        descriptionHtml = xmlCdataOrText(valueBlock[1]);
      }
    }

    positions.push({
      id,
      name,
      office: xmlTextOf("office", block),
      subcompany: xmlTextOf("subcompany", block),
      department: xmlTextOf("department", block),
      descriptionHtml,
    });
  }

  return positions;
}

export const personioProvider: ScanProvider = {
  id: "personio",

  detect(target: ScanTarget) {
    if (target.provider !== "personio") return null;
    const cfg = resolvePersonioConfig(target);
    if (!cfg) return null;
    return { url: cfg.xmlUrl };
  },

  async fetch(target: ScanTarget, ctx: ScanFetchContext) {
    const cfg = resolvePersonioConfig(target);
    if (!cfg) {
      throw new Error(`personio: cannot derive XML feed URL for ${target.company}`);
    }
    assertPersonioHost(cfg.host);

    const xml = await ctx.fetchText(cfg.xmlUrl, { redirect: "error" });
    const positions = parsePersonioXml(xml);
    const fetchedAt = new Date().toISOString();
    const out: RawPosting[] = [];

    for (const pos of positions) {
      // Posting URL: constructed from validated host — never from XML content.
      const postingUrl = `https://${cfg.host}/job/${pos.id}`;

      const posting: RawPosting = {
        title: pos.name,
        url: postingUrl,
        company: pos.subcompany || target.company,
        location: pos.office,
        source: "personio",
        sourceKind: "structured",
        fetchedAt,
      };
      if (pos.descriptionHtml) {
        posting.description = pos.descriptionHtml;
      }
      out.push(posting);
    }

    if (out.length === 0) {
      process.stderr.write(
        `warn: personio: ${target.company}: 0 positions returned from ${cfg.xmlUrl}\n`,
      );
    }

    return out;
  },
};
