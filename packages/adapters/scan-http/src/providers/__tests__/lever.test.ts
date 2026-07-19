import { describe, expect, it, vi } from "vitest";
import type { ScanFetchContext, ScanTarget } from "@selfwright/core";
import { leverProvider } from "../lever.js";

function fakeCtx(json: unknown): ScanFetchContext {
  return {
    fetchJson: vi.fn().mockResolvedValue(json),
    fetchText: vi.fn(),
    fetchRaw: vi.fn(),
  };
}

describe("leverProvider.detect", () => {
  it("derives the API URL from a careers_url", () => {
    const target: ScanTarget = { company: "Acme", provider: "lever", careersUrl: "https://jobs.lever.co/acme" };
    expect(leverProvider.detect(target)).toEqual({ url: "https://api.lever.co/v0/postings/acme" });
  });

  it("returns null when careers_url doesn't match the lever pattern", () => {
    const target: ScanTarget = { company: "Acme", provider: "lever", careersUrl: "https://acme.com/careers" };
    expect(leverProvider.detect(target)).toBeNull();
  });

  it("rejects a crafted URL that only contains the lever host/path as a substring on a different host (SSRF regression)", () => {
    const target: ScanTarget = { company: "Acme", provider: "lever", careersUrl: "https://evil.example/jobs.lever.co/acme" };
    expect(leverProvider.detect(target)).toBeNull();
  });
});

describe("leverProvider.fetch", () => {
  it("maps Lever postings to RawPosting, including the free description", async () => {
    const target: ScanTarget = { company: "Acme", provider: "lever", careersUrl: "https://jobs.lever.co/acme" };
    const ctx = fakeCtx([
      {
        text: "Enterprise Architect",
        hostedUrl: "https://jobs.lever.co/acme/123",
        categories: { location: "Amsterdam, NL" },
        descriptionPlain: "We are looking for an architect. Apply now.",
        createdAt: 1700000000000,
      },
    ]);
    const result = await leverProvider.fetch(target, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: "Enterprise Architect",
      url: "https://jobs.lever.co/acme/123",
      company: "Acme",
      location: "Amsterdam, NL",
      description: "We are looking for an architect. Apply now.",
      source: "lever",
    });
  });

  it("omits the description field when descriptionPlain is absent", async () => {
    const target: ScanTarget = { company: "Acme", provider: "lever", careersUrl: "https://jobs.lever.co/acme" };
    const ctx = fakeCtx([{ text: "Role", hostedUrl: "https://jobs.lever.co/acme/1" }]);
    const result = await leverProvider.fetch(target, ctx);
    expect(result[0]).not.toHaveProperty("description");
  });

  it("drops a posting whose hostedUrl host isn't allowlisted (SSRF guard, Finding 3)", async () => {
    const target: ScanTarget = { company: "Acme", provider: "lever", careersUrl: "https://jobs.lever.co/acme" };
    const ctx = fakeCtx([
      { text: "Legit", hostedUrl: "https://jobs.lever.co/acme/1" },
      { text: "Malicious", hostedUrl: "http://192.168.1.10/" },
    ]);
    const result = await leverProvider.fetch(target, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Legit");
  });

  it("returns an empty array when the response isn't an array", async () => {
    const target: ScanTarget = { company: "Acme", provider: "lever", careersUrl: "https://jobs.lever.co/acme" };
    const result = await leverProvider.fetch(target, fakeCtx({ error: "not found" }));
    expect(result).toEqual([]);
  });

  it("throws when no API URL can be derived", async () => {
    const target: ScanTarget = { company: "Acme", provider: "lever" };
    await expect(leverProvider.fetch(target, fakeCtx([]))).rejects.toThrow(/cannot derive API URL/);
  });
});
