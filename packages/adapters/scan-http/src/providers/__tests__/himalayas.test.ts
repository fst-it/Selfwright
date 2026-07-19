import { describe, expect, it, vi } from "vitest";
import type { ScanFetchContext, ScanTarget } from "@selfwright/core";
import { himalayasProvider } from "../himalayas.js";

function fakeCtx(json: unknown): ScanFetchContext {
  return {
    fetchJson: vi.fn().mockResolvedValue(json),
    fetchText: vi.fn(),
    fetchRaw: vi.fn(),
  };
}

const baseTarget: ScanTarget = { company: "Remote Board", provider: "himalayas" };

const sampleJob = {
  title: "Senior Backend Engineer",
  companyName: "Acme Inc",
  applicationLink: "https://himalayas.app/companies/acme/jobs/senior-backend-engineer",
  guid: "https://himalayas.app/companies/acme/jobs/senior-backend-engineer",
  locationRestrictions: ["United States"],
  employmentType: "Full Time",
  pubDate: 1783958284,
};

describe("himalayasProvider.detect", () => {
  it("returns the API base URL for himalayas targets", () => {
    expect(himalayasProvider.detect(baseTarget)).toEqual({
      url: "https://himalayas.app/jobs/api",
    });
  });

  it("returns null for non-himalayas targets", () => {
    expect(himalayasProvider.detect({ company: "X", provider: "greenhouse" })).toBeNull();
  });
});

describe("himalayasProvider.fetch", () => {
  it("maps Himalayas jobs to RawPosting", async () => {
    const ctx = fakeCtx({ totalCount: 1, jobs: [sampleJob] });
    const result = await himalayasProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: "Senior Backend Engineer",
      url: "https://himalayas.app/companies/acme/jobs/senior-backend-engineer",
      company: "Acme Inc",
      location: "United States",
      source: "himalayas",
      sourceKind: "structured",
    });
  });

  it("falls back to guid when applicationLink is absent", async () => {
    const ctx = fakeCtx({
      totalCount: 1,
      jobs: [{ ...sampleJob, applicationLink: undefined }],
    });
    const result = await himalayasProvider.fetch(baseTarget, ctx);
    expect(result[0]?.url).toBe(
      "https://himalayas.app/companies/acme/jobs/senior-backend-engineer",
    );
  });

  it("falls back to 'Remote' when locationRestrictions is absent", async () => {
    const ctx = fakeCtx({ totalCount: 1, jobs: [{ ...sampleJob, locationRestrictions: [] }] });
    const result = await himalayasProvider.fetch(baseTarget, ctx);
    expect(result[0]?.location).toBe("Remote");
  });

  it("falls back to target.company when companyName is absent", async () => {
    const ctx = fakeCtx({ jobs: [{ ...sampleJob, companyName: undefined }] });
    const result = await himalayasProvider.fetch(baseTarget, ctx);
    expect(result[0]?.company).toBe("Remote Board");
  });

  it("drops jobs with off-host applicationLink (SSRF guard)", async () => {
    const ctx = fakeCtx({
      jobs: [
        sampleJob,
        { ...sampleJob, applicationLink: "https://evil.example.com/steal" },
        { ...sampleJob, applicationLink: "http://himalayas.app/jobs/http-only" },
      ],
    });
    const result = await himalayasProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Senior Backend Engineer");
  });

  it("applies titleFilter as client-side case-insensitive any-of match", async () => {
    const target: ScanTarget = {
      ...baseTarget,
      titleFilter: ["backend", "platform"],
    };
    const ctx = fakeCtx({
      jobs: [
        sampleJob,
        { ...sampleJob, title: "Platform Engineer", applicationLink: "https://himalayas.app/companies/acme/jobs/platform" },
        { ...sampleJob, title: "Designer", applicationLink: "https://himalayas.app/companies/acme/jobs/designer" },
      ],
    });
    const result = await himalayasProvider.fetch(target, ctx);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.title)).toEqual(
      expect.arrayContaining(["Senior Backend Engineer", "Platform Engineer"]),
    );
  });

  it("emits a stderr warn and returns [] when 0 postings match", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const ctx = fakeCtx({ jobs: [] });
    const result = await himalayasProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(0);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("warn: himalayas"));
    stderrSpy.mockRestore();
  });

  it("throws when the API response lacks a jobs array", async () => {
    const ctx = fakeCtx({ items: [] });
    await expect(himalayasProvider.fetch(baseTarget, ctx)).rejects.toThrow(
      /unexpected API response/,
    );
  });
});
