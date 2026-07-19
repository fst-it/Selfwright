import { describe, expect, it, vi } from "vitest";
import type { ScanFetchContext, ScanTarget } from "@selfwright/core";
import { greenhouseProvider } from "../greenhouse.js";

function fakeCtx(json: unknown): ScanFetchContext {
  return {
    fetchJson: vi.fn().mockResolvedValue(json),
    fetchText: vi.fn(),
    fetchRaw: vi.fn(),
  };
}

describe("greenhouseProvider.detect", () => {
  it("derives the API URL from a careers_url", () => {
    const target: ScanTarget = { company: "Acme", provider: "greenhouse", careersUrl: "https://job-boards.greenhouse.io/acme" };
    expect(greenhouseProvider.detect(target)).toEqual({ url: "https://boards-api.greenhouse.io/v1/boards/acme/jobs" });
  });

  it("uses an explicit api URL when provided", () => {
    const target: ScanTarget = { company: "Acme", provider: "greenhouse", api: "https://boards-api.greenhouse.io/v1/boards/acme/jobs" };
    expect(greenhouseProvider.detect(target)).toEqual({ url: "https://boards-api.greenhouse.io/v1/boards/acme/jobs" });
  });

  it("returns null when no URL can be derived", () => {
    const target: ScanTarget = { company: "Acme", provider: "greenhouse" };
    expect(greenhouseProvider.detect(target)).toBeNull();
  });

  it("returns null for an untrusted api hostname (SSRF guard)", () => {
    const target: ScanTarget = { company: "Acme", provider: "greenhouse", api: "https://evil.example/v1/boards/acme/jobs" };
    expect(greenhouseProvider.detect(target)).toBeNull();
  });
});

describe("greenhouseProvider.fetch", () => {
  it("maps Greenhouse jobs to RawPosting", async () => {
    const target: ScanTarget = { company: "Acme", provider: "greenhouse", careersUrl: "https://job-boards.greenhouse.io/acme" };
    const ctx = fakeCtx({
      jobs: [
        { title: "Enterprise Architect", absolute_url: "https://job-boards.greenhouse.io/acme/jobs/1", location: { name: "Amsterdam, NL" } },
      ],
    });
    const result = await greenhouseProvider.fetch(target, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: "Enterprise Architect",
      url: "https://job-boards.greenhouse.io/acme/jobs/1",
      company: "Acme",
      location: "Amsterdam, NL",
      source: "greenhouse",
    });
  });

  it("filters out jobs with no absolute_url", async () => {
    const target: ScanTarget = { company: "Acme", provider: "greenhouse", careersUrl: "https://job-boards.greenhouse.io/acme" };
    const ctx = fakeCtx({ jobs: [{ title: "No URL" }] });
    const result = await greenhouseProvider.fetch(target, ctx);
    expect(result).toHaveLength(0);
  });

  it("drops a posting whose absolute_url host isn't allowlisted (SSRF guard, Finding 3)", async () => {
    const target: ScanTarget = { company: "Acme", provider: "greenhouse", careersUrl: "https://job-boards.greenhouse.io/acme" };
    const ctx = fakeCtx({
      jobs: [
        { title: "Legit", absolute_url: "https://job-boards.greenhouse.io/acme/jobs/1" },
        { title: "Malicious", absolute_url: "http://169.254.169.254/latest/meta-data" },
      ],
    });
    const result = await greenhouseProvider.fetch(target, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Legit");
  });

  it("throws when no API URL can be derived", async () => {
    const target: ScanTarget = { company: "Acme", provider: "greenhouse" };
    await expect(greenhouseProvider.fetch(target, fakeCtx({}))).rejects.toThrow(/cannot derive API URL/);
  });

  it("rejects an untrusted explicit api hostname even at fetch time", async () => {
    const target: ScanTarget = { company: "Acme", provider: "greenhouse", api: "https://evil.example/jobs" };
    await expect(greenhouseProvider.fetch(target, fakeCtx({}))).rejects.toThrow(/untrusted hostname/);
  });
});
