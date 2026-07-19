import { describe, expect, it, vi } from "vitest";
import type { ScanFetchContext, ScanTarget } from "@selfwright/core";
import { oracleProvider } from "../oracle.js";

function fakeCtx(json: unknown): ScanFetchContext {
  return {
    fetchJson: vi.fn().mockResolvedValue(json),
    fetchText: vi.fn(),
    fetchRaw: vi.fn(),
  };
}

const baseTarget: ScanTarget = {
  company: "AcmeBank",
  provider: "oracle",
  careersUrl: "https://acmebank.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001",
};

const oneItemResponse = {
  items: [
    {
      Id: 210582049,
      Title: "Senior Software Engineer",
      PrimaryLocation: "New York, NY, United States",
      ShortDescriptionStr: "Lead platform engineering.",
    },
  ],
  hasMore: false,
  count: 1,
};

// ── detect() ──────────────────────────────────────────────────────────────────

describe("oracleProvider.detect", () => {
  it("returns listing URL from a careersUrl with /sites/{site}/ in path", () => {
    const result = oracleProvider.detect(baseTarget);
    expect(result?.url).toContain("recruitingCEJobRequisitions");
    expect(result?.url).toContain("siteNumber=CX_1001");
    expect(result?.url).toContain("acmebank.fa.oraclecloud.com");
  });

  it("uses api field over careersUrl when api is set", () => {
    const target: ScanTarget = {
      ...baseTarget,
      api: "https://eofe.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001",
    };
    const result = oracleProvider.detect(target);
    expect(result?.url).toContain("eofe.fa.us2.oraclecloud.com");
    expect(result?.url).toContain("siteNumber=CX_1001");
  });

  it("returns null when neither careersUrl nor api is set", () => {
    const target: ScanTarget = { company: "AcmeBank", provider: "oracle" };
    expect(oracleProvider.detect(target)).toBeNull();
  });

  it("returns null for a non-oracle provider target", () => {
    const target: ScanTarget = { ...baseTarget, provider: "greenhouse" };
    expect(oracleProvider.detect(target)).toBeNull();
  });

  it("returns null when careersUrl has no /sites/ path segment", () => {
    const target: ScanTarget = {
      ...baseTarget,
      careersUrl: "https://acmebank.fa.oraclecloud.com/hcmUI/CandidateExperience/en",
    };
    expect(oracleProvider.detect(target)).toBeNull();
  });

  it("returns null for an http:// careersUrl (must be https)", () => {
    const target: ScanTarget = {
      ...baseTarget,
      careersUrl: "http://acmebank.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001",
    };
    expect(oracleProvider.detect(target)).toBeNull();
  });

  it("returns null for an untrusted host in careersUrl (SSRF guard)", () => {
    const target: ScanTarget = {
      ...baseTarget,
      careersUrl: "https://evil.example.com/hcmUI/CandidateExperience/en/sites/CX_1001",
    };
    expect(oracleProvider.detect(target)).toBeNull();
  });

  it("rejects site number with injection chars (semicolon)", () => {
    const target: ScanTarget = {
      ...baseTarget,
      careersUrl:
        "https://acmebank.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001%3BevildParam%3Dx",
    };
    expect(oracleProvider.detect(target)).toBeNull();
  });
});

// ── fetch() ───────────────────────────────────────────────────────────────────

describe("oracleProvider.fetch", () => {
  it("maps Oracle items to RawPosting", async () => {
    const ctx = fakeCtx(oneItemResponse);
    const result = await oracleProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: "Senior Software Engineer",
      company: "AcmeBank",
      location: "New York, NY, United States",
      source: "oracle",
      sourceKind: "structured",
      description: "Lead platform engineering.",
    });
    expect(result[0]?.url).toMatch(/\/job\/210582049$/);
    expect(result[0]?.url).toContain("CX_1001");
    expect(result[0]?.url).toContain("acmebank.fa.oraclecloud.com");
  });

  it("constructs posting URL with host and siteNumber from careersUrl", async () => {
    const ctx = fakeCtx(oneItemResponse);
    const result = await oracleProvider.fetch(baseTarget, ctx);
    const url = result[0]?.url ?? "";
    expect(url).toBe(
      "https://acmebank.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210582049",
    );
  });

  it("omits description when ShortDescriptionStr is absent", async () => {
    const ctx = fakeCtx({
      items: [{ Id: 1, Title: "Analyst", PrimaryLocation: "London" }],
      hasMore: false,
    });
    const result = await oracleProvider.fetch(baseTarget, ctx);
    expect(result[0]).not.toHaveProperty("description");
  });

  it("skips items without Id or Title", async () => {
    const ctx = fakeCtx({
      items: [
        { Title: "No ID" },
        { Id: 2 },
        { Id: 3, Title: "Valid" },
      ],
      hasMore: false,
    });
    const result = await oracleProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Valid");
  });

  it("paginates using offset until hasMore is false", async () => {
    const fetchJson = vi
      .fn()
      .mockResolvedValueOnce({
        items: [{ Id: 1, Title: "Job A", PrimaryLocation: "NYC" }],
        hasMore: true,
        count: 1,
      })
      .mockResolvedValueOnce({
        items: [{ Id: 2, Title: "Job B", PrimaryLocation: "LON" }],
        hasMore: false,
        count: 1,
      });
    const ctx: ScanFetchContext = { fetchJson, fetchText: vi.fn(), fetchRaw: vi.fn() };
    const result = await oracleProvider.fetch(baseTarget, ctx);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
    // Second call must have offset=100
    const secondUrl = String(fetchJson.mock.calls[1]?.[0]);
    expect(secondUrl).toContain("offset=100");
  });

  it("warns to stderr and returns [] when 0 items are returned", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const ctx = fakeCtx({ items: [], hasMore: false });
    const result = await oracleProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(0);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("0 postings"));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("AcmeBank"));
    stderrSpy.mockRestore();
  });

  it("warns on truncation when MAX_PAGES cap is hit", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    // Always return hasMore: true so we hit the cap (MAX_PAGES = 20)
    const fetchJson = vi.fn().mockResolvedValue({
      items: [{ Id: 1, Title: "Job", PrimaryLocation: "NYC" }],
      hasMore: true,
      count: 1,
    });
    const ctx: ScanFetchContext = { fetchJson, fetchText: vi.fn(), fetchRaw: vi.fn() };
    await oracleProvider.fetch(baseTarget, ctx);
    expect(fetchJson).toHaveBeenCalledTimes(20); // MAX_PAGES
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("cap"));
    stderrSpy.mockRestore();
  });

  it("throws (rejects) when careersUrl is on an untrusted host (SSRF guard)", async () => {
    // resolveOracleConfig returns null for non-.oraclecloud.com hosts, so fetch()
    // throws before making any network request. The SSRF is blocked.
    const target: ScanTarget = {
      ...baseTarget,
      careersUrl: "https://evil.example.com/hcmUI/CandidateExperience/en/sites/CX_1001",
    };
    await expect(oracleProvider.fetch(target, fakeCtx({}))).rejects.toThrow();
  });

  it("throws when no careersUrl is configured", async () => {
    const target: ScanTarget = { company: "AcmeBank", provider: "oracle" };
    await expect(oracleProvider.fetch(target, fakeCtx({}))).rejects.toThrow();
  });

  it("handles string Id values as well as numeric", async () => {
    const ctx = fakeCtx({
      items: [{ Id: "76052", Title: "Risk Manager", PrimaryLocation: "London" }],
      hasMore: false,
    });
    const result = await oracleProvider.fetch(baseTarget, ctx);
    expect(result[0]?.url).toContain("/job/76052");
  });
});
