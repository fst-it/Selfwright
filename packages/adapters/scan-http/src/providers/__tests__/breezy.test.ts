import { describe, expect, it, vi } from "vitest";
import type { ScanFetchContext, ScanTarget } from "@selfwright/core";
import { breezyProvider } from "../breezy.js";

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

const baseTarget: ScanTarget = {
  company: "Acme",
  provider: "breezy",
  api: "https://acme.breezy.hr/json",
};

describe("breezyProvider.detect", () => {
  it("returns the api URL when api is set", () => {
    expect(breezyProvider.detect(baseTarget)).toEqual({
      url: "https://acme.breezy.hr/json",
    });
  });

  it("auto-detects URL from careersUrl with breezy.hr subdomain", () => {
    const t: ScanTarget = { company: "Acme", provider: "breezy", careersUrl: "https://acme.breezy.hr" };
    expect(breezyProvider.detect(t)).toEqual({ url: "https://acme.breezy.hr/json" });
  });

  it("auto-detects URL from careersUrl with trailing path", () => {
    const t: ScanTarget = { company: "Acme", provider: "breezy", careersUrl: "https://acme.breezy.hr/jobs" };
    expect(breezyProvider.detect(t)).toEqual({ url: "https://acme.breezy.hr/json" });
  });

  it("returns null when neither api nor careersUrl is set", () => {
    const t: ScanTarget = { company: "Acme", provider: "breezy" };
    expect(breezyProvider.detect(t)).toBeNull();
  });

  it("returns null for a non-breezy provider target", () => {
    const t: ScanTarget = { company: "Acme", provider: "greenhouse" };
    expect(breezyProvider.detect(t)).toBeNull();
  });

  it("rejects non-breezy api URL", () => {
    const t: ScanTarget = { company: "Acme", provider: "breezy", api: "https://evil.example/json" };
    expect(() => breezyProvider.detect(t)).toThrow(/untrusted hostname/);
  });

  it("rejects HTTP api URL", () => {
    const t: ScanTarget = { company: "Acme", provider: "breezy", api: "http://acme.breezy.hr/json" };
    expect(() => breezyProvider.detect(t)).toThrow(/HTTPS/);
  });
});

describe("breezyProvider.fetch", () => {
  it("maps Breezy positions to RawPosting", async () => {
    const ctx = fakeJsonCtx([
      {
        name: "Senior Engineer",
        url: "https://acme.breezy.hr/p/abc123-senior-engineer",
        company: { name: "Acme Corp" },
        location: { name: "Austin, TX", is_remote: false },
      },
    ]);
    const result = await breezyProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: "Senior Engineer",
      url: "https://acme.breezy.hr/p/abc123-senior-engineer",
      company: "Acme Corp",
      location: "Austin, TX",
      source: "breezy",
      sourceKind: "structured",
    });
  });

  it("appends Remote to location when is_remote is true", async () => {
    const ctx = fakeJsonCtx([
      {
        name: "Remote SWE",
        url: "https://acme.breezy.hr/p/remote-swe",
        company: { name: "Acme" },
        location: { name: "New York, NY", is_remote: true },
      },
    ]);
    const result = await breezyProvider.fetch(baseTarget, ctx);
    expect(result[0]?.location).toBe("New York, NY, Remote");
  });

  it("uses target.company as fallback when company.name is absent", async () => {
    const ctx = fakeJsonCtx([
      { name: "Staff Eng", url: "https://acme.breezy.hr/p/staff-eng" },
    ]);
    const result = await breezyProvider.fetch(baseTarget, ctx);
    expect(result[0]?.company).toBe("Acme");
  });

  it("drops positions with no name (SSRF guard: untrusted URL also dropped)", async () => {
    const ctx = fakeJsonCtx([
      { name: "", url: "https://acme.breezy.hr/p/no-title" },
      { name: "Good Job", url: "https://evil.example/p/bad" },
      { name: "Real Job", url: "https://acme.breezy.hr/p/real" },
    ]);
    const result = await breezyProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Real Job");
  });

  it("drops postings with off-host URLs (SSRF guard)", async () => {
    const ctx = fakeJsonCtx([
      { name: "Safe Job", url: "https://acme.breezy.hr/p/safe" },
      { name: "Off-host", url: "https://evil.breezy.hr.attacker.com/p/x" },
    ]);
    const result = await breezyProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Safe Job");
  });

  it("drops HTTP posting URLs (SSRF guard)", async () => {
    const ctx = fakeJsonCtx([
      { name: "Downgrade", url: "http://acme.breezy.hr/p/downgrade" },
    ]);
    const result = await breezyProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(0);
  });

  it("warns to stderr on 0 results", async () => {
    const stderrMock = vi.spyOn(process.stderr, "write");
    const ctx = fakeJsonCtx([]);
    await breezyProvider.fetch(baseTarget, ctx);
    const warns = stderrLines();
    expect(warns.some((l) => l.includes("warn: breezy") && l.includes("0 postings"))).toBe(true);
    stderrMock.mockRestore();
  });

  it("throws when API response is not an array", async () => {
    const ctx = fakeJsonCtx({ positions: [] });
    await expect(breezyProvider.fetch(baseTarget, ctx)).rejects.toThrow(
      /unexpected API response/,
    );
  });

  it("warns to stderr when no API URL is available", async () => {
    const stderrMock = vi.spyOn(process.stderr, "write");
    const t: ScanTarget = { company: "NoUrl", provider: "breezy" };
    const ctx = fakeJsonCtx([]);
    const result = await breezyProvider.fetch(t, ctx);
    expect(result).toHaveLength(0);
    const warns = stderrLines();
    expect(warns.some((l) => l.includes("warn: breezy") && l.includes("no API URL"))).toBe(true);
    stderrMock.mockRestore();
  });
});
