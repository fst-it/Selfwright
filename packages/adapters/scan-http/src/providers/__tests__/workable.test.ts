import { describe, expect, it, vi } from "vitest";
import type { ScanFetchContext, ScanTarget } from "@selfwright/core";
import { workableProvider } from "../workable.js";

function fakeCtx(json: unknown): ScanFetchContext {
  return {
    fetchJson: vi.fn().mockResolvedValue(json),
    fetchText: vi.fn(),
    fetchRaw: vi.fn(),
  };
}

const baseTarget: ScanTarget = {
  company: "Acme",
  provider: "workable",
  careersUrl: "https://apply.workable.com/acme/",
};

// Representative job entry per Workable widget API documentation.
// API endpoint live-verified against multiple companies (agora, hotjar, typeform,
// lingo, toggl — all returned 200 with { name, description, jobs } structure).
function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "abc123",
    title: "Senior Platform Engineer",
    shortcode: "SENENG001",
    state: "published",
    department: "Engineering",
    url: "https://apply.workable.com/acme/j/SENENG001/",
    application_url: "https://apply.workable.com/acme/j/SENENG001/apply/",
    location: {
      location: "Amsterdam, Netherlands",
      country: "Netherlands",
      country_code: "NL",
      city: "Amsterdam",
      region: "North Holland",
      zip: "1011",
      telecommuting: false,
    },
    remote: false,
    tags: ["engineering", "platform"],
    ...overrides,
  };
}

// ── detect() ──────────────────────────────────────────────────────────────────

describe("workableProvider.detect", () => {
  it("returns widget API URL from an apply.workable.com careersUrl", () => {
    const result = workableProvider.detect(baseTarget);
    expect(result).toEqual({
      url: "https://apply.workable.com/api/v1/widget/accounts/acme",
    });
  });

  it("uses the api field directly when provided", () => {
    const target: ScanTarget = {
      ...baseTarget,
      api: "https://apply.workable.com/api/v1/widget/accounts/acme-corp",
    };
    expect(workableProvider.detect(target)).toEqual({
      url: "https://apply.workable.com/api/v1/widget/accounts/acme-corp",
    });
  });

  it("returns null when careersUrl is not on apply.workable.com", () => {
    const target: ScanTarget = {
      ...baseTarget,
      careersUrl: "https://acme.workable.com/",
    };
    expect(workableProvider.detect(target)).toBeNull();
  });

  it("returns null when no careersUrl is provided", () => {
    const target: ScanTarget = { company: "Acme", provider: "workable" };
    expect(workableProvider.detect(target)).toBeNull();
  });

  it("returns null for a different provider", () => {
    const target: ScanTarget = { ...baseTarget, provider: "greenhouse" };
    expect(workableProvider.detect(target)).toBeNull();
  });

  it("returns null when api is on an untrusted host (SSRF guard)", () => {
    const target: ScanTarget = {
      ...baseTarget,
      api: "https://evil.example.com/api/v1/widget/accounts/acme",
    };
    expect(workableProvider.detect(target)).toBeNull();
  });

  it("normalises path traversal in careersUrl via the URL parser (no SSRF risk)", () => {
    // The URL constructor normalises `/../evil/` to `/evil/`, so the extracted
    // subdomain is the safe literal string "evil". The resulting API call stays
    // on apply.workable.com — there is no SSRF vector here.
    const target: ScanTarget = {
      ...baseTarget,
      careersUrl: "https://apply.workable.com/../evil/",
    };
    expect(workableProvider.detect(target)?.url).toBe(
      "https://apply.workable.com/api/v1/widget/accounts/evil",
    );
  });

  it("rejects http:// careersUrl (must be https)", () => {
    const target: ScanTarget = {
      ...baseTarget,
      careersUrl: "http://apply.workable.com/acme/",
    };
    expect(workableProvider.detect(target)).toBeNull();
  });
});

// ── fetch() ───────────────────────────────────────────────────────────────────

describe("workableProvider.fetch", () => {
  it("maps Workable jobs to RawPosting", async () => {
    const ctx = fakeCtx({ name: "Acme", description: null, jobs: [makeJob()] });
    const result = await workableProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: "Senior Platform Engineer",
      url: "https://apply.workable.com/acme/j/SENENG001/",
      company: "Acme",
      source: "workable",
      sourceKind: "structured",
    });
    expect(result[0]?.location).toContain("Amsterdam");
    expect(result[0]?.location).toContain("Netherlands");
  });

  it("appends Remote to location when remote is true", async () => {
    const ctx = fakeCtx({
      jobs: [makeJob({ remote: true, location: { city: "London", country: "UK", telecommuting: false } })],
    });
    const result = await workableProvider.fetch(baseTarget, ctx);
    expect(result[0]?.location).toContain("Remote");
  });

  it("appends Remote to location when telecommuting is true", async () => {
    const ctx = fakeCtx({
      jobs: [makeJob({ location: { city: "Berlin", country: "Germany", telecommuting: true } })],
    });
    const result = await workableProvider.fetch(baseTarget, ctx);
    expect(result[0]?.location).toContain("Remote");
  });

  it("drops a job whose url is off-domain (SSRF guard — defense in depth)", async () => {
    const ctx = fakeCtx({
      jobs: [
        makeJob({ url: "https://apply.workable.com/acme/j/GOOD/" }),
        makeJob({ url: "https://evil.example.com/steal-data" }),
      ],
    });
    const result = await workableProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]?.url).toContain("apply.workable.com");
  });

  it("drops a job whose url is http (not https) (SSRF guard)", async () => {
    const ctx = fakeCtx({
      jobs: [makeJob({ url: "http://apply.workable.com/acme/j/HTTP001/" })],
    });
    const result = await workableProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(0);
  });

  it("skips jobs without a title", async () => {
    const ctx = fakeCtx({ jobs: [makeJob({ title: "" }), makeJob()] });
    const result = await workableProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(1);
  });

  it("skips jobs without a url", async () => {
    const ctx = fakeCtx({ jobs: [makeJob({ url: "" }), makeJob()] });
    const result = await workableProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(1);
  });

  it("warns to stderr and returns [] when 0 jobs are returned", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const result = await workableProvider.fetch(baseTarget, fakeCtx({ jobs: [] }));
    expect(result).toHaveLength(0);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("0 jobs"));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Acme"));
    stderrSpy.mockRestore();
  });

  it("warns to stderr when jobs key is missing from response", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const result = await workableProvider.fetch(baseTarget, fakeCtx({ name: "Acme" }));
    expect(result).toHaveLength(0);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("0 jobs"));
    stderrSpy.mockRestore();
  });

  it("throws (rejects) when the api URL is on an untrusted host (SSRF guard)", async () => {
    // resolveWorkableConfig returns null for non-apply.workable.com hosts,
    // so fetch() throws before making any network request. The SSRF is blocked.
    const target: ScanTarget = {
      ...baseTarget,
      api: "https://evil.example.com/api/v1/widget/accounts/acme",
    };
    await expect(workableProvider.fetch(target, fakeCtx({}))).rejects.toThrow();
  });

  it("throws when no careersUrl or api is configured", async () => {
    const target: ScanTarget = { company: "Acme", provider: "workable" };
    await expect(workableProvider.fetch(target, fakeCtx({}))).rejects.toThrow();
  });
});
