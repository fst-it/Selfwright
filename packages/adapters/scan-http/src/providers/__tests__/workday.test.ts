import { describe, expect, it, vi } from "vitest";
import type { ScanFetchContext, ScanTarget } from "@selfwright/core";
import { workdayProvider } from "../workday.js";

function fakeCtx(json: unknown): ScanFetchContext {
  return {
    fetchJson: vi.fn().mockResolvedValue(json),
    fetchText: vi.fn(),
    fetchRaw: vi.fn(),
  };
}

// A standalone mock reference (not a `ctx.fetchJson` property access) so
// assertions on call args don't trip @typescript-eslint/unbound-method.
function fakeCtxWithMock(json: unknown): { ctx: ScanFetchContext; fetchJsonMock: ReturnType<typeof vi.fn> } {
  const fetchJsonMock = vi.fn().mockResolvedValue(json);
  return { ctx: { fetchJson: fetchJsonMock, fetchText: vi.fn(), fetchRaw: vi.fn() }, fetchJsonMock };
}

describe("workdayProvider.detect", () => {
  it("derives the CXS URL from a careers_url", () => {
    const target: ScanTarget = { company: "23andMe", provider: "workday", careersUrl: "https://23andme.wd5.myworkdayjobs.com/23" };
    expect(workdayProvider.detect(target)).toEqual({
      url: "https://23andme.wd5.myworkdayjobs.com/wday/cxs/23andme/23/jobs",
    });
  });

  it("derives the CXS URL from a careers_url with a locale segment", () => {
    const target: ScanTarget = {
      company: "Acme",
      provider: "workday",
      careersUrl: "https://acme.wd1.myworkdayjobs.com/en-US/Acme_Careers",
    };
    expect(workdayProvider.detect(target)).toEqual({
      url: "https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/Acme_Careers/jobs",
    });
  });

  it("returns null for a non-matching careers_url", () => {
    const target: ScanTarget = { company: "Acme", provider: "workday", careersUrl: "https://acme.com/careers" };
    expect(workdayProvider.detect(target)).toBeNull();
  });

  it("returns null when careers_url is absent", () => {
    const target: ScanTarget = { company: "Acme", provider: "workday" };
    expect(workdayProvider.detect(target)).toBeNull();
  });
});

describe("workdayProvider.fetch", () => {
  it("sends a POST with the expected body shape", async () => {
    const target: ScanTarget = { company: "23andMe", provider: "workday", careersUrl: "https://23andme.wd5.myworkdayjobs.com/23" };
    const { ctx, fetchJsonMock } = fakeCtxWithMock({ jobPostings: [] });
    await workdayProvider.fetch(target, ctx);
    expect(fetchJsonMock).toHaveBeenCalledWith(
      "https://23andme.wd5.myworkdayjobs.com/wday/cxs/23andme/23/jobs",
      { method: "POST", body: JSON.stringify({ limit: 20, offset: 0, searchText: "", appliedFacets: {} }), redirect: "error" },
    );
  });

  it("maps a realistic sample response to RawPosting[]", async () => {
    const target: ScanTarget = { company: "23andMe", provider: "workday", careersUrl: "https://23andme.wd5.myworkdayjobs.com/23" };
    const ctx = fakeCtx({
      total: 1,
      jobPostings: [
        {
          title: "Senior Software Engineer",
          externalPath: "/job/Remote/Senior-Software-Engineer_JR12345",
          locationsText: "Remote, USA",
        },
      ],
    });
    const result = await workdayProvider.fetch(target, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: "Senior Software Engineer",
      url: "https://23andme.wd5.myworkdayjobs.com/23/job/Remote/Senior-Software-Engineer_JR12345",
      company: "23andMe",
      location: "Remote, USA",
      source: "workday",
    });
  });

  it("filters out postings with no externalPath", async () => {
    const target: ScanTarget = { company: "Acme", provider: "workday", careersUrl: "https://acme.wd1.myworkdayjobs.com/Acme" };
    const ctx = fakeCtx({ jobPostings: [{ title: "No path" }] });
    const result = await workdayProvider.fetch(target, ctx);
    expect(result).toHaveLength(0);
  });

  it("fetches multiple pages until a short page signals end", async () => {
    const target: ScanTarget = { company: "23andMe", provider: "workday", careersUrl: "https://23andme.wd5.myworkdayjobs.com/23" };
    const { ctx, fetchJsonMock } = fakeCtxWithMock({});
    const fullPage = {
      jobPostings: Array.from({ length: 20 }, (_, i) => ({
        title: `Role ${i}`,
        externalPath: `/job/${i}`,
        locationsText: "Remote",
      })),
    };
    const shortPage = {
      jobPostings: Array.from({ length: 5 }, (_, i) => ({
        title: `Role ${20 + i}`,
        externalPath: `/job/${20 + i}`,
        locationsText: "Remote",
      })),
    };
    fetchJsonMock.mockResolvedValueOnce(fullPage).mockResolvedValueOnce(shortPage);
    const result = await workdayProvider.fetch(target, ctx);
    expect(result).toHaveLength(25);
    expect(fetchJsonMock).toHaveBeenCalledTimes(2);
    expect(fetchJsonMock).toHaveBeenNthCalledWith(
      2,
      "https://23andme.wd5.myworkdayjobs.com/wday/cxs/23andme/23/jobs",
      { method: "POST", body: JSON.stringify({ limit: 20, offset: 20, searchText: "", appliedFacets: {} }), redirect: "error" },
    );
  });

  it("throws when no CXS endpoint can be derived", async () => {
    const target: ScanTarget = { company: "Acme", provider: "workday" };
    await expect(workdayProvider.fetch(target, fakeCtx({}))).rejects.toThrow(/cannot derive CXS endpoint/);
  });
});
