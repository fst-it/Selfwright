import { describe, expect, it, vi } from "vitest";
import type { ScanFetchContext, ScanTarget } from "@selfwright/core";
import { bambooHrProvider } from "../bamboohr.js";

function fakeCtx(json: unknown): ScanFetchContext {
  return {
    fetchJson: vi.fn().mockResolvedValue(json),
    fetchText: vi.fn(),
    fetchRaw: vi.fn(),
  };
}

describe("bambooHrProvider.detect", () => {
  it("derives the API URL from a careers_url", () => {
    const target: ScanTarget = { company: "Acme", provider: "bamboohr", careersUrl: "https://acme.bamboohr.com/careers" };
    expect(bambooHrProvider.detect(target)).toEqual({ url: "https://acme.bamboohr.com/careers/list" });
  });

  it("uses an explicit api URL when provided", () => {
    const target: ScanTarget = { company: "Acme", provider: "bamboohr", api: "https://acme.bamboohr.com/careers" };
    expect(bambooHrProvider.detect(target)).toEqual({ url: "https://acme.bamboohr.com/careers/list" });
  });

  it("returns null when no URL can be derived", () => {
    const target: ScanTarget = { company: "Acme", provider: "bamboohr" };
    expect(bambooHrProvider.detect(target)).toBeNull();
  });

  it("returns null for a non-matching host", () => {
    const target: ScanTarget = { company: "Acme", provider: "bamboohr", careersUrl: "https://acme.com/careers" };
    expect(bambooHrProvider.detect(target)).toBeNull();
  });
});

describe("bambooHrProvider SSRF guard", () => {
  it("rejects a hostname that doesn't match <tenant>.bamboohr.com", () => {
    const target: ScanTarget = { company: "Acme", provider: "bamboohr", api: "https://evil.example/careers" };
    expect(bambooHrProvider.detect(target)).toBeNull();
  });

  it("rejects a hostname suffix-spoofing bamboohr.com (bamboohr.com.evil.example)", () => {
    // The host regex is fully anchored (^...$) against parsed.hostname, so a
    // domain that merely *contains* "bamboohr.com" as a prefix segment does
    // not match — it must END in the literal ".bamboohr.com".
    const target: ScanTarget = { company: "Acme", provider: "bamboohr", api: "https://bamboohr.com.evil.example/careers" };
    expect(bambooHrProvider.detect(target)).toBeNull();
  });

  it("throws at fetch time for an untrusted explicit api hostname", async () => {
    const target: ScanTarget = { company: "Acme", provider: "bamboohr" };
    await expect(bambooHrProvider.fetch(target, fakeCtx({}))).rejects.toThrow(/cannot derive API URL/);
  });
});

describe("bambooHrProvider.fetch", () => {
  it("maps a /careers/list response to RawPosting[] with no description field", async () => {
    const target: ScanTarget = { company: "Acme", provider: "bamboohr", careersUrl: "https://acme.bamboohr.com/careers" };
    const ctx = fakeCtx({
      result: [
        {
          id: 42,
          jobOpeningName: "Enterprise Architect",
          location: { city: "Amsterdam", state: "NH" },
          isRemote: 1,
        },
      ],
    });
    const result = await bambooHrProvider.fetch(target, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: "Enterprise Architect",
      url: "https://acme.bamboohr.com/careers/42",
      company: "Acme",
      location: "Amsterdam, NH, Remote",
      source: "bamboohr",
    });
    expect(result[0]).not.toHaveProperty("description");
  });

  it("filters out rows with no id", async () => {
    const target: ScanTarget = { company: "Acme", provider: "bamboohr", careersUrl: "https://acme.bamboohr.com/careers" };
    const ctx = fakeCtx({ result: [{ jobOpeningName: "No ID" }] });
    const result = await bambooHrProvider.fetch(target, ctx);
    expect(result).toHaveLength(0);
  });

  it("filters out rows with no jobOpeningName", async () => {
    const target: ScanTarget = { company: "Acme", provider: "bamboohr", careersUrl: "https://acme.bamboohr.com/careers" };
    const ctx = fakeCtx({ result: [{ id: 1 }] });
    const result = await bambooHrProvider.fetch(target, ctx);
    expect(result).toHaveLength(0);
  });

  it("returns an empty array when result is not an array", async () => {
    const target: ScanTarget = { company: "Acme", provider: "bamboohr", careersUrl: "https://acme.bamboohr.com/careers" };
    const result = await bambooHrProvider.fetch(target, fakeCtx({ error: "not found" }));
    expect(result).toEqual([]);
  });

  it("throws when no API URL can be derived", async () => {
    const target: ScanTarget = { company: "Acme", provider: "bamboohr" };
    await expect(bambooHrProvider.fetch(target, fakeCtx({}))).rejects.toThrow(/cannot derive API URL/);
  });

  it("rejects an untrusted explicit api hostname even at fetch time", async () => {
    const target: ScanTarget = { company: "Acme", provider: "bamboohr", api: "https://evil.example/careers" };
    await expect(bambooHrProvider.fetch(target, fakeCtx({}))).rejects.toThrow(/cannot derive API URL/);
  });
});
