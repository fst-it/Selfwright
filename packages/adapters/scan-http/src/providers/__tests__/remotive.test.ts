import { describe, expect, it, vi } from "vitest";
import type { ScanFetchContext, ScanTarget } from "@selfwright/core";
import { remotiveProvider } from "../remotive.js";

function fakeCtx(json: unknown): ScanFetchContext {
  return {
    fetchJson: vi.fn().mockResolvedValue(json),
    fetchText: vi.fn(),
    fetchRaw: vi.fn(),
  };
}

const baseTarget: ScanTarget = { company: "Remote Board", provider: "remotive" };

const sampleJob = {
  id: 123,
  url: "https://remotive.com/remote-jobs/engineering/senior-engineer-123",
  title: "Senior Engineer",
  company_name: "Acme Corp",
  candidate_required_location: "USA",
  category: "Software Development",
  publication_date: "2026-07-01T00:00:00",
};

describe("remotiveProvider.detect", () => {
  it("returns the API base URL for remotive targets", () => {
    expect(remotiveProvider.detect(baseTarget)).toEqual({
      url: "https://remotive.com/api/remote-jobs",
    });
  });

  it("returns null for non-remotive targets", () => {
    expect(remotiveProvider.detect({ company: "X", provider: "greenhouse" })).toBeNull();
  });
});

describe("remotiveProvider.fetch", () => {
  it("maps Remotive jobs to RawPosting", async () => {
    const ctx = fakeCtx({ "job-count": 1, jobs: [sampleJob] });
    const result = await remotiveProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: "Senior Engineer",
      url: "https://remotive.com/remote-jobs/engineering/senior-engineer-123",
      company: "Acme Corp",
      location: "USA",
      source: "remotive",
      sourceKind: "structured",
    });
  });

  it("falls back to 'Remote' when candidate_required_location is absent", async () => {
    const ctx = fakeCtx({
      jobs: [{ ...sampleJob, candidate_required_location: undefined }],
    });
    const result = await remotiveProvider.fetch(baseTarget, ctx);
    expect(result[0]?.location).toBe("Remote");
  });

  it("falls back to target.company when company_name is absent", async () => {
    const ctx = fakeCtx({ jobs: [{ ...sampleJob, company_name: undefined }] });
    const result = await remotiveProvider.fetch(baseTarget, ctx);
    expect(result[0]?.company).toBe("Remote Board");
  });

  it("drops jobs with no url or an off-host url (SSRF guard)", async () => {
    const ctx = fakeCtx({
      jobs: [
        sampleJob,
        { ...sampleJob, url: "https://evil.example.com/jobs/steal" },
        { ...sampleJob, url: undefined },
      ],
    });
    const result = await remotiveProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Senior Engineer");
  });

  it("rejects http:// posting URLs (SSRF guard)", async () => {
    const ctx = fakeCtx({
      jobs: [{ ...sampleJob, url: "http://remotive.com/remote-jobs/engineering/http-123" }],
    });
    const result = await remotiveProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(0);
  });

  it("emits a stderr warn and returns [] when 0 postings match", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const ctx = fakeCtx({ jobs: [] });
    const result = await remotiveProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(0);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("warn: remotive"));
    stderrSpy.mockRestore();
  });

  it("throws when the API response lacks a jobs array", async () => {
    const ctx = fakeCtx({ items: [] });
    await expect(remotiveProvider.fetch(baseTarget, ctx)).rejects.toThrow(
      /unexpected API response/,
    );
  });

  it("appends ?search= from titleFilter[0]", async () => {
    const target = { ...baseTarget, titleFilter: ["software engineer"] };
    const ctx = fakeCtx({ jobs: [sampleJob] });
    await remotiveProvider.fetch(target, ctx);
    const calledUrl = (ctx.fetchJson as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("search=software+engineer");
  });
});
