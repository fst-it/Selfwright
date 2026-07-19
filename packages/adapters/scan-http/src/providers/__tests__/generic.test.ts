import { describe, expect, it, vi } from "vitest";
import type { ScanFetchContext, ScanTarget } from "@selfwright/core";
import { createGenericProvider, extractJsonLdPostings } from "../generic.js";

// Fake DNS resolver that reports any hostname as publicly routable.
const fakePublicResolve = vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);

// Build a provider instance for tests — injectable resolver avoids real DNS calls.
const provider = createGenericProvider(fakePublicResolve);

function fakeCtx(raw: { status: number; text: string; finalUrl: string }): ScanFetchContext {
  return {
    fetchJson: vi.fn(),
    fetchText: vi.fn(),
    fetchRaw: vi.fn().mockResolvedValue(raw),
  };
}

describe("genericProvider.detect", () => {
  it("uses careersUrl when present", () => {
    const target: ScanTarget = { company: "Portal Corp", provider: "generic", careersUrl: "https://jobs.example-portal.example/jobs/12345" };
    expect(provider.detect(target)).toEqual({ url: "https://jobs.example-portal.example/jobs/12345" });
  });

  it("falls back to api when careersUrl is absent", () => {
    const target: ScanTarget = { company: "Acme", provider: "generic", api: "https://acme.com/careers/1" };
    expect(provider.detect(target)).toEqual({ url: "https://acme.com/careers/1" });
  });

  it("returns null when neither careersUrl nor api is set", () => {
    const target: ScanTarget = { company: "Acme", provider: "generic" };
    expect(provider.detect(target)).toBeNull();
  });
});

describe("genericProvider.fetch — SSRF guard", () => {
  const badCtx = fakeCtx({ status: 200, text: "should never reach", finalUrl: "" });

  it("rejects a loopback URL (127.0.0.1)", async () => {
    const target: ScanTarget = { company: "Attacker", provider: "generic", careersUrl: "http://127.0.0.1/admin" };
    await expect(provider.fetch(target, badCtx)).rejects.toThrow(/private\/reserved|HTTPS/i);
  });

  it("rejects a link-local metadata URL (169.254.169.254)", async () => {
    const target: ScanTarget = { company: "Attacker", provider: "generic", careersUrl: "https://169.254.169.254/latest/meta-data" };
    await expect(provider.fetch(target, badCtx)).rejects.toThrow(/private\/reserved/i);
  });

  it("rejects an RFC1918 URL (10.0.0.1)", async () => {
    const target: ScanTarget = { company: "Attacker", provider: "generic", careersUrl: "https://10.0.0.1/secret" };
    await expect(provider.fetch(target, badCtx)).rejects.toThrow(/private\/reserved/i);
  });

  it("rejects a non-HTTPS URL", async () => {
    const target: ScanTarget = { company: "Attacker", provider: "generic", careersUrl: "http://example.com/careers" };
    await expect(provider.fetch(target, badCtx)).rejects.toThrow(/HTTPS/i);
  });

  it("rejects when DNS resolves to a private address", async () => {
    const privateResolve = vi.fn().mockResolvedValue([{ address: "10.0.0.1", family: 4 }]);
    const providerWithPrivateDns = createGenericProvider(privateResolve);
    const target: ScanTarget = { company: "Attacker", provider: "generic", careersUrl: "https://internal.example.com/jobs" };
    await expect(providerWithPrivateDns.fetch(target, badCtx)).rejects.toThrow(/private\/reserved/i);
  });
});

describe("genericProvider.fetch", () => {
  it("extracts a title from the <title> tag and strips HTML from the description", async () => {
    const target: ScanTarget = { company: "Acme", provider: "generic", careersUrl: "https://acme.com/careers/1" };
    const html =
      "<html><head><title>Enterprise Architect at Acme</title></head><body>" +
      "<p>We are hiring an <b>Enterprise Architect</b>. Apply now.</p></body></html>";
    const ctx = fakeCtx({ status: 200, text: html, finalUrl: "https://acme.com/careers/1" });
    const result = await provider.fetch(target, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Enterprise Architect at Acme");
    expect(result[0]?.description).toContain("We are hiring an Enterprise Architect");
    expect(result[0]?.description).not.toContain("<b>");
    expect(result[0]?.company).toBe("Acme");
    expect(result[0]?.source).toBe("generic");
  });

  it("falls back to titleFilter[0] then company name when there is no <title> tag", async () => {
    const target: ScanTarget = { company: "Acme", provider: "generic", careersUrl: "https://acme.com/careers/1", titleFilter: ["Director of Architecture"] };
    const ctx = fakeCtx({ status: 200, text: "<body>No title tag here, just body text.</body>", finalUrl: "https://acme.com/careers/1" });
    const result = await provider.fetch(target, ctx);
    expect(result[0]?.title).toBe("Director of Architecture");
  });

  it("still returns a posting (for checkLiveness to classify) when the fetch is blocked (e.g. HTTP 403)", async () => {
    const target: ScanTarget = { company: "Portal Corp", provider: "generic", careersUrl: "https://jobs.example-portal.example/jobs/12345" };
    const ctx = fakeCtx({ status: 403, text: "Access Denied", finalUrl: "https://jobs.example-portal.example/jobs/12345" });
    const result = await provider.fetch(target, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]?.description).toBe("Access Denied");
  });

  it("carries the observed HTTP status and final URL through to the RawPosting", async () => {
    const target: ScanTarget = { company: "Portal Corp", provider: "generic", careersUrl: "https://jobs.example-portal.example/jobs/12345" };
    const ctx = fakeCtx({ status: 403, text: "Access Denied", finalUrl: "https://jobs.example-portal.example/jobs/12345" });
    const result = await provider.fetch(target, ctx);
    expect(result[0]?.httpStatus).toBe(403);
    expect(result[0]?.finalUrl).toBe("https://jobs.example-portal.example/jobs/12345");
  });

  it("throws when no URL can be derived", async () => {
    const target: ScanTarget = { company: "Acme", provider: "generic" };
    await expect(provider.fetch(target, fakeCtx({ status: 200, text: "", finalUrl: "" }))).rejects.toThrow(
      /no careersUrl\/api configured/,
    );
  });

  it("returns JSON-LD structured postings when the page embeds a JobPosting block", async () => {
    const target: ScanTarget = { company: "Acme", provider: "generic", careersUrl: "https://acme.com/careers" };
    const html = `<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "JobPosting",
  "title": "Staff Engineer",
  "hiringOrganization": { "@type": "Organization", "name": "Acme Ltd" },
  "jobLocation": { "@type": "Place", "address": { "@type": "PostalAddress", "addressLocality": "Amsterdam", "addressCountry": "NL" } },
  "url": "https://acme.com/careers/staff-engineer"
}
</script>
</head><body>Some page body</body></html>`;
    const ctx = fakeCtx({ status: 200, text: html, finalUrl: "https://acme.com/careers" });
    const result = await provider.fetch(target, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: "Staff Engineer",
      company: "Acme Ltd",
      location: "Amsterdam, NL",
      url: "https://acme.com/careers/staff-engineer",
      source: "generic",
      sourceKind: "structured",
    });
    // JSON-LD path must not expose httpStatus (no liveness-check confusion)
    expect(result[0]).not.toHaveProperty("httpStatus");
  });

  it("falls back to scrape mode when page has no JSON-LD blocks", async () => {
    const target: ScanTarget = { company: "Acme", provider: "generic", careersUrl: "https://acme.com/careers/1" };
    const html = "<html><head><title>Job at Acme</title></head><body>Some content</body></html>";
    const ctx = fakeCtx({ status: 200, text: html, finalUrl: "https://acme.com/careers/1" });
    const result = await provider.fetch(target, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]?.sourceKind).toBe("scraped");
    expect(result[0]?.httpStatus).toBe(200);
  });

  it("falls back to scrape mode and warns when page has ld+json but no JobPosting", async () => {
    const target: ScanTarget = { company: "Acme", provider: "generic", careersUrl: "https://acme.com/careers/1" };
    const html = `<html><head>
<script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>
</head><body><title>Acme</title></body></html>`;
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const ctx = fakeCtx({ status: 200, text: html, finalUrl: "https://acme.com/careers/1" });
    const result = await provider.fetch(target, ctx);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("no JobPosting type found"));
    expect(result[0]?.sourceKind).toBe("scraped");
    stderrSpy.mockRestore();
  });

  it("extracts multiple JobPostings from a page with an @graph block", async () => {
    const target: ScanTarget = { company: "Acme", provider: "generic", careersUrl: "https://acme.com/careers" };
    const html = `<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "name": "Acme" },
    {
      "@type": "JobPosting",
      "title": "Engineer",
      "hiringOrganization": { "@type": "Organization", "name": "Acme Corp" },
      "jobLocationType": "TELECOMMUTE",
      "url": "https://acme.com/jobs/engineer"
    },
    {
      "@type": "JobPosting",
      "title": "Designer",
      "hiringOrganization": { "@type": "Organization", "name": "Acme Corp" },
      "url": "https://acme.com/jobs/designer"
    }
  ]
}
</script>
</head><body></body></html>`;
    const ctx = fakeCtx({ status: 200, text: html, finalUrl: "https://acme.com/careers" });
    const result = await provider.fetch(target, ctx);
    expect(result).toHaveLength(2);
    expect(result[0]?.title).toBe("Engineer");
    expect(result[0]?.location).toBe("Remote");
    expect(result[1]?.title).toBe("Designer");
  });

  it("processes a large run of unmatched '<' characters in linear time (regression: was O(n^2) via a backtracking regex)", async () => {
    // Found via review: a regex-based tag strip (`/<[^>]+>/g`) backtracks
    // per-character on a long run of `<` with no matching `>`, making it
    // O(n^2) -- ~160,000 such characters took ~12s with the old
    // implementation, and a ~1MB payload didn't finish inside a 3-minute
    // timeout. The fix is a linear indexOf-driven scan; this asserts it
    // completes quickly even on a much larger pathological payload.
    const target: ScanTarget = { company: "Acme", provider: "generic", careersUrl: "https://acme.com/careers/1" };
    const pathological = "<".repeat(500_000);
    const ctx = fakeCtx({ status: 200, text: pathological, finalUrl: "https://acme.com/careers/1" });
    const start = performance.now();
    const result = await provider.fetch(target, ctx);
    const elapsedMs = performance.now() - start;
    expect(result).toHaveLength(1);
    expect(elapsedMs).toBeLessThan(2000);
  });
});

// ── extractJsonLdPostings (unit-level) ────────────────────────────────────────
describe("extractJsonLdPostings", () => {
  const PAGE_URL = "https://careers.example.com/jobs";
  const COMPANY = "Example Corp";
  const FETCHED_AT = "2026-07-13T00:00:00.000Z";

  it("parses a single top-level JobPosting block", () => {
    const html = `<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "JobPosting",
  "title": "Senior Engineer",
  "hiringOrganization": { "@type": "Organization", "name": "Tech Co" },
  "jobLocation": { "@type": "Place", "address": { "@type": "PostalAddress", "addressLocality": "Berlin", "addressCountry": "DE" } },
  "url": "https://careers.example.com/jobs/senior-engineer"
}
</script>
</head></html>`;
    const { postings, hadLdJson } = extractJsonLdPostings(html, PAGE_URL, COMPANY, FETCHED_AT);
    expect(hadLdJson).toBe(true);
    expect(postings).toHaveLength(1);
    expect(postings[0]).toMatchObject({
      title: "Senior Engineer",
      company: "Tech Co",
      location: "Berlin, DE",
      url: "https://careers.example.com/jobs/senior-engineer",
      source: "generic",
      sourceKind: "structured",
      fetchedAt: FETCHED_AT,
    });
  });

  it("parses an ItemList of JobPostings", () => {
    const html = `<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "itemListElement": [
    {
      "@type": "ListItem",
      "position": 1,
      "item": {
        "@type": "JobPosting",
        "title": "Designer",
        "url": "https://careers.example.com/jobs/designer"
      }
    },
    {
      "@type": "ListItem",
      "position": 2,
      "item": {
        "@type": "JobPosting",
        "title": "Engineer",
        "url": "https://careers.example.com/jobs/engineer"
      }
    }
  ]
}
</script>
</head></html>`;
    const { postings } = extractJsonLdPostings(html, PAGE_URL, COMPANY, FETCHED_AT);
    expect(postings).toHaveLength(2);
    expect(postings.map((p) => p.title)).toEqual(["Designer", "Engineer"]);
  });

  it("sets location to 'Remote' for TELECOMMUTE jobLocationType", () => {
    const html = `<html><head>
<script type="application/ld+json">
{
  "@type": "JobPosting",
  "title": "Remote Dev",
  "jobLocationType": "TELECOMMUTE",
  "url": "https://careers.example.com/jobs/remote-dev"
}
</script>
</head></html>`;
    const { postings } = extractJsonLdPostings(html, PAGE_URL, COMPANY, FETCHED_AT);
    expect(postings[0]?.location).toBe("Remote");
  });

  it("falls back to pageUrl when JobPosting has no url field", () => {
    const html = `<html><head>
<script type="application/ld+json">
{"@type":"JobPosting","title":"Dev"}
</script>
</head></html>`;
    const { postings } = extractJsonLdPostings(html, PAGE_URL, COMPANY, FETCHED_AT);
    expect(postings[0]?.url).toBe(PAGE_URL);
  });

  it("falls back to company param when hiringOrganization is absent", () => {
    const html = `<html><head>
<script type="application/ld+json">
{"@type":"JobPosting","title":"Dev","url":"https://careers.example.com/jobs/dev"}
</script>
</head></html>`;
    const { postings } = extractJsonLdPostings(html, PAGE_URL, COMPANY, FETCHED_AT);
    expect(postings[0]?.company).toBe(COMPANY);
  });

  it("returns hadLdJson false when page has no script ld+json blocks", () => {
    const { postings, hadLdJson } = extractJsonLdPostings("<html><body>No scripts</body></html>", PAGE_URL, COMPANY, FETCHED_AT);
    expect(hadLdJson).toBe(false);
    expect(postings).toHaveLength(0);
  });

  it("returns hadLdJson true but empty postings when ld+json has no JobPosting type", () => {
    const html = `<html><head>
<script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>
</head></html>`;
    const { postings, hadLdJson } = extractJsonLdPostings(html, PAGE_URL, COMPANY, FETCHED_AT);
    expect(hadLdJson).toBe(true);
    expect(postings).toHaveLength(0);
  });

  it("skips malformed JSON without throwing", () => {
    const html = `<html><head>
<script type="application/ld+json">this is not json</script>
<script type="application/ld+json">{"@type":"JobPosting","title":"Valid Job","url":"https://careers.example.com/jobs/valid"}</script>
</head></html>`;
    const { postings } = extractJsonLdPostings(html, PAGE_URL, COMPANY, FETCHED_AT);
    expect(postings).toHaveLength(1);
    expect(postings[0]?.title).toBe("Valid Job");
  });
});
