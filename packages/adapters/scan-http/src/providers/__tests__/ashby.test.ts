import { describe, expect, it, vi } from "vitest";
import type { ScanFetchContext, ScanTarget } from "@selfwright/core";
import { ashbyProvider } from "../ashby.js";

function fakeCtx(json: unknown): ScanFetchContext {
  return {
    fetchJson: vi.fn().mockResolvedValue(json),
    fetchText: vi.fn(),
    fetchRaw: vi.fn(),
  };
}

describe("ashbyProvider.detect", () => {
  it("derives the API URL from a careers_url", () => {
    const target: ScanTarget = { company: "Acme", provider: "ashby", careersUrl: "https://jobs.ashbyhq.com/acme" };
    expect(ashbyProvider.detect(target)).toEqual({
      url: "https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=true",
    });
  });

  it("returns null when careers_url doesn't match the ashby pattern", () => {
    const target: ScanTarget = { company: "Acme", provider: "ashby", careersUrl: "https://acme.com/careers" };
    expect(ashbyProvider.detect(target)).toBeNull();
  });

  it("returns null when no careers_url is provided", () => {
    const target: ScanTarget = { company: "Acme", provider: "ashby" };
    expect(ashbyProvider.detect(target)).toBeNull();
  });

  it("rejects a crafted URL that only contains the ashby host/path as a substring on a different host (SSRF regression)", () => {
    const target: ScanTarget = { company: "Acme", provider: "ashby", careersUrl: "https://evil.example/jobs.ashbyhq.com/acme" };
    expect(ashbyProvider.detect(target)).toBeNull();
  });
});

describe("ashbyProvider.fetch", () => {
  it("maps Ashby jobs to RawPosting, folding secondary locations in", async () => {
    const target: ScanTarget = { company: "Acme", provider: "ashby", careersUrl: "https://jobs.ashbyhq.com/acme" };
    const ctx = fakeCtx({
      jobs: [
        {
          title: "Enterprise Architect",
          jobUrl: "https://jobs.ashbyhq.com/acme/123",
          location: "Canada",
          secondaryLocations: [
            {
              location: "Europe",
              address: { postalAddress: { addressLocality: "Berlin", addressCountry: "Germany" } },
            },
          ],
        },
      ],
    });
    const result = await ashbyProvider.fetch(target, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: "Enterprise Architect",
      url: "https://jobs.ashbyhq.com/acme/123",
      company: "Acme",
      location: "Canada · Europe · Berlin · Germany",
      source: "ashby",
    });
  });

  it("dedupes repeated location parts", async () => {
    const target: ScanTarget = { company: "Acme", provider: "ashby", careersUrl: "https://jobs.ashbyhq.com/acme" };
    const ctx = fakeCtx({
      jobs: [
        {
          title: "Role",
          jobUrl: "https://jobs.ashbyhq.com/acme/1",
          location: "Remote",
          secondaryLocations: [{ location: "Remote" }],
        },
      ],
    });
    const result = await ashbyProvider.fetch(target, ctx);
    expect(result[0]).toMatchObject({ location: "Remote" });
  });

  it("falls back to an empty location when none is present", async () => {
    const target: ScanTarget = { company: "Acme", provider: "ashby", careersUrl: "https://jobs.ashbyhq.com/acme" };
    const ctx = fakeCtx({ jobs: [{ title: "No Location", jobUrl: "https://jobs.ashbyhq.com/acme/2" }] });
    const result = await ashbyProvider.fetch(target, ctx);
    expect(result[0]).toMatchObject({ location: "" });
  });

  it("drops a posting whose jobUrl host isn't allowlisted (SSRF guard, Finding 3)", async () => {
    const target: ScanTarget = { company: "Acme", provider: "ashby", careersUrl: "https://jobs.ashbyhq.com/acme" };
    const ctx = fakeCtx({
      jobs: [
        { title: "Legit", jobUrl: "https://jobs.ashbyhq.com/acme/1" },
        { title: "Malicious", jobUrl: "file:///etc/passwd" },
      ],
    });
    const result = await ashbyProvider.fetch(target, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Legit");
  });

  it("returns an empty array when jobs is not an array", async () => {
    const target: ScanTarget = { company: "Acme", provider: "ashby", careersUrl: "https://jobs.ashbyhq.com/acme" };
    const result = await ashbyProvider.fetch(target, fakeCtx({}));
    expect(result).toEqual([]);
  });

  it("throws when no API URL can be derived", async () => {
    const target: ScanTarget = { company: "Acme", provider: "ashby" };
    await expect(ashbyProvider.fetch(target, fakeCtx({}))).rejects.toThrow(/cannot derive API URL/);
  });
});
