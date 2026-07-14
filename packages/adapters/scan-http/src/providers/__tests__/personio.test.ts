import { describe, expect, it, vi } from "vitest";
import type { ScanFetchContext, ScanTarget } from "@selfwright/core";
import { personioProvider } from "../personio.js";

function fakeCtxText(text: string): ScanFetchContext {
  return {
    fetchJson: vi.fn(),
    fetchText: vi.fn().mockResolvedValue(text),
    fetchRaw: vi.fn(),
  };
}

const baseTarget: ScanTarget = {
  company: "Personio",
  provider: "personio",
  careersUrl: "https://personio.jobs.personio.de/xml",
};

// Minimal XML matching the workzag-jobs format confirmed live (2026-07-13).
const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<workzag-jobs>
  <position>
    <id>1834171</id>
    <subcompany>Personio SE &amp; Co. KG</subcompany>
    <office>Munich</office>
    <department>Product and Tech</department>
    <recruitingCategory>Engineering</recruitingCategory>
    <name>Staff Software Engineer, Data Platform</name>
    <jobDescriptions>
      <jobDescription>
        <name>Job Description</name>
        <value><![CDATA[<p>Build the data platform.</p>]]></value>
      </jobDescription>
    </jobDescriptions>
    <employmentType>permanent</employmentType>
    <createdAt>2024-11-13T14:10:41+00:00</createdAt>
  </position>
  <position>
    <id>1999999</id>
    <subcompany>Personio GmbH</subcompany>
    <office>Berlin</office>
    <department>Engineering</department>
    <name>Senior Backend Engineer</name>
    <jobDescriptions></jobDescriptions>
    <employmentType>permanent</employmentType>
  </position>
</workzag-jobs>`;

// ── detect() ──────────────────────────────────────────────────────────────────

describe("personioProvider.detect", () => {
  it("returns XML feed URL from a .jobs.personio.de careersUrl", () => {
    const result = personioProvider.detect(baseTarget);
    expect(result).toEqual({ url: "https://personio.jobs.personio.de/xml" });
  });

  it("returns XML feed URL from a .jobs.personio.com careersUrl variant", () => {
    const target: ScanTarget = {
      ...baseTarget,
      careersUrl: "https://acme.jobs.personio.com/",
    };
    expect(personioProvider.detect(target)).toEqual({
      url: "https://acme.jobs.personio.com/xml",
    });
  });

  it("returns null when careersUrl is not a Personio jobs domain", () => {
    const target: ScanTarget = {
      ...baseTarget,
      careersUrl: "https://acme.example.com/jobs",
    };
    expect(personioProvider.detect(target)).toBeNull();
  });

  it("returns null when no careersUrl is provided", () => {
    const target: ScanTarget = { company: "Acme", provider: "personio" };
    expect(personioProvider.detect(target)).toBeNull();
  });

  it("returns null for a different provider", () => {
    const target: ScanTarget = { ...baseTarget, provider: "greenhouse" };
    expect(personioProvider.detect(target)).toBeNull();
  });

  it("rejects http:// careersUrl (must be https)", () => {
    const target: ScanTarget = {
      ...baseTarget,
      careersUrl: "http://personio.jobs.personio.de/xml",
    };
    expect(personioProvider.detect(target)).toBeNull();
  });

  it("rejects bare jobs.personio.de without a company subdomain (SSRF guard)", () => {
    const target: ScanTarget = {
      ...baseTarget,
      careersUrl: "https://jobs.personio.de/xml",
    };
    expect(personioProvider.detect(target)).toBeNull();
  });

  it("rejects a host that has personio.de only as a substring on another domain", () => {
    const target: ScanTarget = {
      ...baseTarget,
      careersUrl: "https://evil.jobs.personio.de.evil.com/xml",
    };
    expect(personioProvider.detect(target)).toBeNull();
  });
});

// ── fetch() ───────────────────────────────────────────────────────────────────

describe("personioProvider.fetch", () => {
  it("parses positions from workzag-jobs XML and maps to RawPosting", async () => {
    const ctx = fakeCtxText(SAMPLE_XML);
    const result = await personioProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      title: "Staff Software Engineer, Data Platform",
      company: "Personio SE & Co. KG",
      location: "Munich",
      source: "personio",
      sourceKind: "structured",
      description: "<p>Build the data platform.</p>",
    });
    expect(result[0]?.url).toBe("https://personio.jobs.personio.de/job/1834171");
  });

  it("uses subcompany as company name when present", async () => {
    const ctx = fakeCtxText(SAMPLE_XML);
    const result = await personioProvider.fetch(baseTarget, ctx);
    expect(result[0]?.company).toBe("Personio SE & Co. KG");
    expect(result[1]?.company).toBe("Personio GmbH");
  });

  it("falls back to target.company when subcompany is absent", async () => {
    const xml = `<workzag-jobs>
      <position>
        <id>1</id>
        <name>Engineer</name>
        <office>Amsterdam</office>
      </position>
    </workzag-jobs>`;
    const ctx = fakeCtxText(xml);
    const result = await personioProvider.fetch(baseTarget, ctx);
    expect(result[0]?.company).toBe("Personio");
  });

  it("omits description when jobDescriptions is empty", async () => {
    const ctx = fakeCtxText(SAMPLE_XML);
    const result = await personioProvider.fetch(baseTarget, ctx);
    // Second position has empty jobDescriptions
    expect(result[1]).not.toHaveProperty("description");
  });

  it("decodes XML entities in subcompany and name fields", async () => {
    const ctx = fakeCtxText(SAMPLE_XML);
    const result = await personioProvider.fetch(baseTarget, ctx);
    // "&amp;" in the XML should decode to "&"
    expect(result[0]?.company).toBe("Personio SE & Co. KG");
  });

  it("constructs posting URL from validated host and position id (SSRF guard)", async () => {
    const ctx = fakeCtxText(SAMPLE_XML);
    const result = await personioProvider.fetch(baseTarget, ctx);
    expect(result[0]?.url).toBe("https://personio.jobs.personio.de/job/1834171");
    expect(result[1]?.url).toBe("https://personio.jobs.personio.de/job/1999999");
  });

  it("constructs posting URL on .personio.com for .com variant feed", async () => {
    const target: ScanTarget = {
      ...baseTarget,
      careersUrl: "https://acme.jobs.personio.com/xml",
    };
    const xml = `<workzag-jobs>
      <position><id>42</id><name>Engineer</name></position>
    </workzag-jobs>`;
    const ctx = fakeCtxText(xml);
    const result = await personioProvider.fetch(target, ctx);
    expect(result[0]?.url).toBe("https://acme.jobs.personio.com/job/42");
  });

  it("skips positions without an id or name", async () => {
    const xml = `<workzag-jobs>
      <position><name>No ID</name></position>
      <position><id>2</id></position>
      <position><id>3</id><name>Valid Role</name></position>
    </workzag-jobs>`;
    const ctx = fakeCtxText(xml);
    const result = await personioProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Valid Role");
  });

  it("warns to stderr and returns [] when 0 positions are in the XML", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const ctx = fakeCtxText("<workzag-jobs></workzag-jobs>");
    const result = await personioProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(0);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("0 positions"));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Personio"));
    stderrSpy.mockRestore();
  });

  it("throws (rejects) for an untrusted host in careersUrl (SSRF guard)", async () => {
    // resolvePersonioConfig returns null for non-personio hosts, so fetch()
    // throws before making any network request. The SSRF is blocked.
    const target: ScanTarget = {
      ...baseTarget,
      careersUrl: "https://evil.example.com/xml",
    };
    await expect(personioProvider.fetch(target, fakeCtxText(""))).rejects.toThrow();
  });

  it("throws when no careersUrl is configured", async () => {
    const target: ScanTarget = { company: "Acme", provider: "personio" };
    await expect(personioProvider.fetch(target, fakeCtxText(""))).rejects.toThrow();
  });

  it("correctly parses a position whose description CDATA contains a literal </position> substring", async () => {
    // Regression: the old split(/<position[^>]*>/) + indexOf("</position>") approach
    // would prematurely end the block at the literal </position> inside the CDATA,
    // causing the id/name fields that follow it to be silently dropped.
    const xml = `<workzag-jobs>
      <position>
        <jobDescriptions>
          <jobDescription>
            <value><![CDATA[See our open roles at /jobs?tag=</position>anchor for more.]]></value>
          </jobDescription>
        </jobDescriptions>
        <id>999</id>
        <name>Engineer With Tricky Description</name>
        <office>London</office>
      </position>
    </workzag-jobs>`;
    const ctx = fakeCtxText(xml);
    const result = await personioProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Engineer With Tricky Description");
    expect(result[0]?.url).toBe("https://personio.jobs.personio.de/job/999");
    expect(result[0]?.location).toBe("London");
  });
});
