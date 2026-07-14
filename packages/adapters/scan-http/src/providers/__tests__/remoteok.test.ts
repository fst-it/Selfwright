import { describe, expect, it, vi } from "vitest";
import type { ScanFetchContext, ScanTarget } from "@selfwright/core";
import { remoteokProvider } from "../remoteok.js";

function fakeJsonCtx(json: unknown): ScanFetchContext {
  return {
    fetchJson: vi.fn().mockResolvedValue(json),
    fetchText: vi.fn(),
    fetchRaw: vi.fn(),
  };
}

function stderrLines(): string[] {
  return (process.stderr.write as ReturnType<typeof vi.fn>).mock.calls.map(
    (c: unknown[]) => String(c[0]),
  );
}

// Representative API response: first element is the legal/attribution notice,
// subsequent elements are job objects.
const NOTICE = {
  last_updated: "2026-07-13T00:00:00.000Z",
  legal:
    "API Terms of Service: Please link back (with follow, and without nofollow!) to the URL on Remote OK",
};

const JOB_1 = {
  id: 1001,
  slug: "senior-backend-engineer-acme-1001",
  position: "Senior Backend Engineer",
  company: "Acme Inc",
  url: "https://remoteok.com/remote-jobs/senior-backend-engineer-acme-1001",
  apply_url: "https://acme.example/apply/1001",
  location: "Worldwide",
  description: "<strong>We are hiring</strong>",
  date: "07/13/2026 10:00:00",
  tags: ["javascript", "node"],
};

const JOB_2 = {
  id: 1002,
  slug: "staff-sre-globex-1002",
  position: "Staff SRE",
  company: "Globex",
  url: "https://remoteOK.com/remote-jobs/staff-sre-globex-1002",
  location: "USA Only",
  description: "<p>SRE role</p>",
  date: "07/12/2026 08:00:00",
  tags: ["devops"],
};

const baseTarget: ScanTarget = { company: "RemoteOK", provider: "remoteok" };

describe("remoteokProvider.detect", () => {
  it("returns the fixed API URL", () => {
    expect(remoteokProvider.detect(baseTarget)).toEqual({
      url: "https://remoteok.com/api",
    });
  });

  it("returns null for a non-remoteok provider", () => {
    const t: ScanTarget = { company: "Acme", provider: "greenhouse" };
    expect(remoteokProvider.detect(t)).toBeNull();
  });
});

describe("remoteokProvider.fetch", () => {
  it("skips the first-element notice and maps jobs to RawPosting", async () => {
    const ctx = fakeJsonCtx([NOTICE, JOB_1, JOB_2]);
    const result = await remoteokProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      title: "Senior Backend Engineer",
      company: "Acme Inc",
      url: "https://remoteok.com/remote-jobs/senior-backend-engineer-acme-1001",
      location: "Worldwide",
      source: "remoteok",
      sourceKind: "structured",
    });
    expect(result[1]).toMatchObject({
      title: "Staff SRE",
      company: "Globex",
      // URL with capital OK normalises to lowercase hostname
      url: "https://remoteOK.com/remote-jobs/staff-sre-globex-1002",
    });
  });

  it("does NOT include apply_url in the output (SSRF guard: external ATS URLs)", async () => {
    const ctx = fakeJsonCtx([NOTICE, JOB_1]);
    const result = await remoteokProvider.fetch(baseTarget, ctx);
    expect(result[0]).not.toHaveProperty("apply_url");
    // url is on remoteok.com, not the external apply_url
    expect(result[0]?.url).toContain("remoteok.com");
  });

  it("accepts remoteok.com URLs with capital letters in path (hostname normalised)", async () => {
    const ctx = fakeJsonCtx([NOTICE, JOB_2]);
    const result = await remoteokProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(1);
  });

  it("drops jobs with off-host posting URLs (SSRF guard)", async () => {
    const ctx = fakeJsonCtx([
      NOTICE,
      { ...JOB_1, url: "https://evil.example/jobs/1001" },
      JOB_2,
    ]);
    const result = await remoteokProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Staff SRE");
  });

  it("drops jobs with HTTP posting URLs (SSRF guard)", async () => {
    const ctx = fakeJsonCtx([
      NOTICE,
      { ...JOB_1, url: "http://remoteok.com/remote-jobs/downgrade" },
    ]);
    const result = await remoteokProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(0);
  });

  it("falls back to target.company when job company is absent", async () => {
    const jobNoCompany = { ...JOB_1, company: "" };
    const ctx = fakeJsonCtx([NOTICE, jobNoCompany]);
    const result = await remoteokProvider.fetch(baseTarget, ctx);
    expect(result[0]?.company).toBe("RemoteOK");
  });

  it("works even if the notice element is absent (no notice in response)", async () => {
    // If RemoteOK ever drops the notice, we should not skip a real job.
    const ctx = fakeJsonCtx([JOB_1, JOB_2]);
    const result = await remoteokProvider.fetch(baseTarget, ctx);
    // JOB_1 has no `legal` field — should be treated as a job and kept.
    expect(result).toHaveLength(2);
  });

  it("warns to stderr on 0 results", async () => {
    const stderrMock = vi.spyOn(process.stderr, "write");
    const ctx = fakeJsonCtx([NOTICE]);
    await remoteokProvider.fetch(baseTarget, ctx);
    const warns = stderrLines();
    expect(warns.some((l) => l.includes("warn: remoteok") && l.includes("0 postings"))).toBe(true);
    stderrMock.mockRestore();
  });

  it("throws when API response is not an array", async () => {
    const ctx = fakeJsonCtx({ error: "rate limited" });
    await expect(remoteokProvider.fetch(baseTarget, ctx)).rejects.toThrow(
      /unexpected API response/,
    );
  });
});
