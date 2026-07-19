import { describe, expect, it, vi } from "vitest";
import type { ScanFetchContext, ScanTarget } from "@selfwright/core";
import { smartrecruitersProvider } from "../smartrecruiters.js";

function fakeCtx(json: unknown): ScanFetchContext {
  return {
    fetchJson: vi.fn().mockResolvedValue(json),
    fetchText: vi.fn(),
    fetchRaw: vi.fn(),
  };
}

// A standalone mock reference (not a `ctx.fetchJson` property access) so
// assertions on call count/args don't trip @typescript-eslint/unbound-method.
function fakeCtxWithMock(): { ctx: ScanFetchContext; fetchJsonMock: ReturnType<typeof vi.fn> } {
  const fetchJsonMock = vi.fn();
  return { ctx: { fetchJson: fetchJsonMock, fetchText: vi.fn(), fetchRaw: vi.fn() }, fetchJsonMock };
}

function page(count: number, startId = 0) {
  return {
    content: Array.from({ length: count }, (_, i) => ({
      id: String(startId + i),
      name: `Role ${startId + i}`,
      ref: `https://api.smartrecruiters.com/v1/companies/acme/postings/${startId + i}`,
      location: { city: "Amsterdam", country: "NL" },
    })),
  };
}

describe("smartrecruitersProvider.detect", () => {
  it("derives the API URL from a careers.smartrecruiters.com careersUrl", () => {
    const target: ScanTarget = { company: "Acme", provider: "smartrecruiters", careersUrl: "https://careers.smartrecruiters.com/acme" };
    expect(smartrecruitersProvider.detect(target)).toEqual({
      url: "https://api.smartrecruiters.com/v1/companies/acme/postings?limit=100&offset=0&status=PUBLIC",
    });
  });

  it("derives the API URL from a jobs.smartrecruiters.com careersUrl", () => {
    const target: ScanTarget = { company: "Acme", provider: "smartrecruiters", careersUrl: "https://jobs.smartrecruiters.com/acme" };
    expect(smartrecruitersProvider.detect(target)).toEqual({
      url: "https://api.smartrecruiters.com/v1/companies/acme/postings?limit=100&offset=0&status=PUBLIC",
    });
  });

  it("returns null when careersUrl doesn't match the smartrecruiters pattern", () => {
    const target: ScanTarget = { company: "Acme", provider: "smartrecruiters", careersUrl: "https://acme.com/careers" };
    expect(smartrecruitersProvider.detect(target)).toBeNull();
  });

  it("returns null when no careersUrl is provided", () => {
    const target: ScanTarget = { company: "Acme", provider: "smartrecruiters" };
    expect(smartrecruitersProvider.detect(target)).toBeNull();
  });
});

describe("smartrecruitersProvider.fetch", () => {
  it("maps SmartRecruiters postings to RawPosting", async () => {
    const target: ScanTarget = { company: "Acme", provider: "smartrecruiters", careersUrl: "https://careers.smartrecruiters.com/acme" };
    const ctx = fakeCtx(page(1));
    const result = await smartrecruitersProvider.fetch(target, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: "Role 0",
      url: "https://jobs.smartrecruiters.com/acme/postings/0",
      company: "Acme",
      location: "Amsterdam, NL",
      source: "smartrecruiters",
    });
  });

  it("throws when no API URL can be derived", async () => {
    const target: ScanTarget = { company: "Acme", provider: "smartrecruiters" };
    await expect(smartrecruitersProvider.fetch(target, fakeCtx({}))).rejects.toThrow(/cannot derive API URL/);
  });

  it("rejects an untrusted hostname surfaced via a malformed ref (SSRF guard)", () => {
    // assertSmartRecruitersUrl only guards the outgoing request URL (always
    // built from the fixed api.smartrecruiters.com host), so exercise it via
    // the allowlist directly by using a target whose careersUrl resolves to a
    // non-allowed host — detect() must reject it rather than following through.
    const target: ScanTarget = { company: "Acme", provider: "smartrecruiters", careersUrl: "https://evil.example/acme" };
    expect(smartrecruitersProvider.detect(target)).toBeNull();
  });

  it("stops pagination when a page returns fewer than SR_PAGE_SIZE results", async () => {
    const target: ScanTarget = { company: "Acme", provider: "smartrecruiters", careersUrl: "https://careers.smartrecruiters.com/acme" };
    const { ctx, fetchJsonMock } = fakeCtxWithMock();
    fetchJsonMock.mockResolvedValueOnce(page(100, 0)).mockResolvedValueOnce(page(30, 100));
    const result = await smartrecruitersProvider.fetch(target, ctx);
    expect(result).toHaveLength(130);
    expect(fetchJsonMock).toHaveBeenCalledTimes(2);
  });

  it("respects the 10-page cap even when more full pages are available", async () => {
    const target: ScanTarget = { company: "Acme", provider: "smartrecruiters", careersUrl: "https://careers.smartrecruiters.com/acme" };
    const { ctx, fetchJsonMock } = fakeCtxWithMock();
    // 11 full pages mocked; cap should stop at 10
    for (let i = 0; i < 11; i++) fetchJsonMock.mockResolvedValueOnce(page(100, i * 100));
    const result = await smartrecruitersProvider.fetch(target, ctx);
    expect(result).toHaveLength(1000);
    expect(fetchJsonMock).toHaveBeenCalledTimes(10);
  });

  it("stops pagination when a page returns an empty array", async () => {
    const target: ScanTarget = { company: "Acme", provider: "smartrecruiters", careersUrl: "https://careers.smartrecruiters.com/acme" };
    const { ctx, fetchJsonMock } = fakeCtxWithMock();
    fetchJsonMock.mockResolvedValueOnce(page(100, 0)).mockResolvedValueOnce({ content: [] });
    const result = await smartrecruitersProvider.fetch(target, ctx);
    expect(result).toHaveLength(100);
    expect(fetchJsonMock).toHaveBeenCalledTimes(2);
  });
});
