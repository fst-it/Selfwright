import { describe, expect, it, vi } from "vitest";
import type { ScanFetchContext, ScanTarget } from "@selfwright/core";
import { recruiteeProvider } from "../recruitee.js";

function fakeCtx(json: unknown): ScanFetchContext {
  return {
    fetchJson: vi.fn().mockResolvedValue(json),
    fetchText: vi.fn(),
    fetchRaw: vi.fn(),
  };
}

const baseTarget: ScanTarget = {
  company: "Channable",
  provider: "recruitee",
  careersUrl: "https://channable.recruitee.com/",
};

// Representative response matching the live structure confirmed against
// channable.recruitee.com/api/offers/ (2026-07-13, 3 offers).
function makeOffer(overrides: Record<string, unknown> = {}) {
  return {
    id: 2670944,
    title: "Frontend Software Engineer",
    slug: "frontend-software-engineer-product-team",
    location: "Utrecht, Netherlands",
    description: "<p>Join our team.</p>",
    company_name: "Channable",
    careers_url: "https://jobs.channable.com/o/frontend-software-engineer-product-team",
    ...overrides,
  };
}

// ── detect() ──────────────────────────────────────────────────────────────────

describe("recruiteeProvider.detect", () => {
  it("returns API URL from a .recruitee.com careersUrl", () => {
    const result = recruiteeProvider.detect(baseTarget);
    expect(result).toEqual({ url: "https://channable.recruitee.com/api/offers/" });
  });

  it("returns API URL from a careersUrl pointing directly to /api/offers/", () => {
    const target: ScanTarget = {
      ...baseTarget,
      careersUrl: "https://acme.recruitee.com/api/offers/",
    };
    expect(recruiteeProvider.detect(target)).toEqual({
      url: "https://acme.recruitee.com/api/offers/",
    });
  });

  it("returns null when careersUrl is not on .recruitee.com", () => {
    const target: ScanTarget = {
      ...baseTarget,
      careersUrl: "https://acme.example.com/jobs",
    };
    expect(recruiteeProvider.detect(target)).toBeNull();
  });

  it("returns null when no careersUrl is provided", () => {
    const target: ScanTarget = { company: "Acme", provider: "recruitee" };
    expect(recruiteeProvider.detect(target)).toBeNull();
  });

  it("returns null for a different provider", () => {
    const target: ScanTarget = { ...baseTarget, provider: "greenhouse" };
    expect(recruiteeProvider.detect(target)).toBeNull();
  });

  it("rejects http:// careersUrl (must be https)", () => {
    const target: ScanTarget = {
      ...baseTarget,
      careersUrl: "http://channable.recruitee.com/",
    };
    expect(recruiteeProvider.detect(target)).toBeNull();
  });

  it("rejects bare recruitee.com without a company subdomain (SSRF guard)", () => {
    const target: ScanTarget = {
      ...baseTarget,
      careersUrl: "https://recruitee.com/api/offers/",
    };
    expect(recruiteeProvider.detect(target)).toBeNull();
  });

  it("rejects a host that only contains recruitee.com as a substring (SSRF bypass)", () => {
    const target: ScanTarget = {
      ...baseTarget,
      careersUrl: "https://evil.example.com/recruitee.com/api/offers/",
    };
    expect(recruiteeProvider.detect(target)).toBeNull();
  });
});

// ── fetch() ───────────────────────────────────────────────────────────────────

describe("recruiteeProvider.fetch", () => {
  it("maps Recruitee offers to RawPosting", async () => {
    const ctx = fakeCtx({ offers: [makeOffer()] });
    const result = await recruiteeProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: "Frontend Software Engineer",
      company: "Channable",
      location: "Utrecht, Netherlands",
      source: "recruitee",
      sourceKind: "structured",
      description: "<p>Join our team.</p>",
    });
  });

  it("constructs posting URL from company slug + offer slug on recruitee.com (SSRF guard)", async () => {
    const ctx = fakeCtx({ offers: [makeOffer()] });
    const result = await recruiteeProvider.fetch(baseTarget, ctx);
    // Must be on channable.recruitee.com — NOT the careers_url custom domain
    expect(result[0]?.url).toBe(
      "https://channable.recruitee.com/o/frontend-software-engineer-product-team",
    );
    expect(result[0]?.url).not.toContain("jobs.channable.com");
  });

  it("uses offer.company_name when present", async () => {
    const ctx = fakeCtx({ offers: [makeOffer({ company_name: "Channable BV" })] });
    const result = await recruiteeProvider.fetch(baseTarget, ctx);
    expect(result[0]?.company).toBe("Channable BV");
  });

  it("falls back to target.company when company_name is absent", async () => {
    const ctx = fakeCtx({ offers: [makeOffer({ company_name: "" })] });
    const result = await recruiteeProvider.fetch(baseTarget, ctx);
    expect(result[0]?.company).toBe("Channable");
  });

  it("skips offers without a title", async () => {
    const ctx = fakeCtx({ offers: [makeOffer({ title: "" }), makeOffer()] });
    const result = await recruiteeProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(1);
  });

  it("skips offers without a slug", async () => {
    const ctx = fakeCtx({ offers: [makeOffer({ slug: "" }), makeOffer()] });
    const result = await recruiteeProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(1);
  });

  it("omits description when offer.description is blank", async () => {
    const ctx = fakeCtx({ offers: [makeOffer({ description: "" })] });
    const result = await recruiteeProvider.fetch(baseTarget, ctx);
    expect(result[0]).not.toHaveProperty("description");
  });

  it("warns to stderr and returns [] when 0 offers are returned", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const result = await recruiteeProvider.fetch(baseTarget, fakeCtx({ offers: [] }));
    expect(result).toHaveLength(0);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("0 offers"));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Channable"));
    stderrSpy.mockRestore();
  });

  it("warns to stderr when offers key is missing from response", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const result = await recruiteeProvider.fetch(baseTarget, fakeCtx({}));
    expect(result).toHaveLength(0);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("0 offers"));
    stderrSpy.mockRestore();
  });

  it("throws for an untrusted host in careersUrl (SSRF guard)", async () => {
    const target: ScanTarget = {
      ...baseTarget,
      careersUrl: "https://evil.example.com/api/offers/",
    };
    await expect(recruiteeProvider.fetch(target, fakeCtx({}))).rejects.toThrow();
  });

  it("throws when no careersUrl is configured", async () => {
    const target: ScanTarget = { company: "Acme", provider: "recruitee" };
    await expect(recruiteeProvider.fetch(target, fakeCtx({}))).rejects.toThrow();
  });
});
