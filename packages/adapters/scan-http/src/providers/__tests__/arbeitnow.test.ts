import { describe, expect, it, vi } from "vitest";
import type { ScanFetchContext, ScanTarget } from "@selfwright/core";
import { arbeitnowProvider } from "../arbeitnow.js";

function fakeCtx(json: unknown): ScanFetchContext {
  return {
    fetchJson: vi.fn().mockResolvedValue(json),
    fetchText: vi.fn(),
    fetchRaw: vi.fn(),
  };
}

const baseTarget: ScanTarget = { company: "Arbeitnow Board", provider: "arbeitnow" };

describe("arbeitnowProvider.detect", () => {
  it("always returns the first-page URL", () => {
    expect(arbeitnowProvider.detect(baseTarget)).toEqual({
      url: "https://www.arbeitnow.com/api/job-board-api?page=1",
    });
  });
});

describe("arbeitnowProvider.fetch", () => {
  it("maps Arbeitnow jobs to RawPosting", async () => {
    const ctx = fakeCtx({
      data: [
        {
          title: "Senior Data Engineer",
          url: "https://www.arbeitnow.com/jobs/acme/senior-data-engineer-123",
          company_name: "Acme GmbH",
          location: "Berlin, Germany",
          remote: false,
        },
      ],
    });
    const result = await arbeitnowProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: "Senior Data Engineer",
      url: "https://www.arbeitnow.com/jobs/acme/senior-data-engineer-123",
      company: "Acme GmbH",
      location: "Berlin, Germany",
      source: "arbeitnow",
      sourceKind: "structured",
    });
  });

  it("appends 'Remote' to the location when remote is true", async () => {
    const ctx = fakeCtx({
      data: [
        {
          title: "Remote SRE",
          url: "https://www.arbeitnow.com/jobs/acme/remote-sre-456",
          company_name: "Acme",
          location: "Europe",
          remote: true,
        },
      ],
    });
    const result = await arbeitnowProvider.fetch(baseTarget, ctx);
    expect(result[0]?.location).toBe("Europe, Remote");
  });

  it("falls back to 'Arbeitnow' as company when company_name is absent", async () => {
    const ctx = fakeCtx({
      data: [
        {
          title: "Staff Engineer",
          url: "https://www.arbeitnow.com/jobs/staff-engineer-789",
        },
      ],
    });
    const result = await arbeitnowProvider.fetch(baseTarget, ctx);
    expect(result[0]?.company).toBe("Arbeitnow");
  });

  it("drops jobs with no url or untrusted url (SSRF guard)", async () => {
    const ctx = fakeCtx({
      data: [
        {
          title: "Legit Job",
          url: "https://www.arbeitnow.com/jobs/legit-123",
          company_name: "Good Co",
        },
        {
          title: "Off-host Job",
          url: "https://evil.example/jobs/evil",
          company_name: "Bad Co",
        },
        {
          title: "No URL Job",
          company_name: "Anon Co",
        },
      ],
    });
    const result = await arbeitnowProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Legit Job");
  });

  it("drops jobs with empty title", async () => {
    const ctx = fakeCtx({
      data: [
        { title: "", url: "https://www.arbeitnow.com/jobs/untitled-123" },
        { url: "https://www.arbeitnow.com/jobs/no-title-456" },
      ],
    });
    const result = await arbeitnowProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(0);
  });

  it("stops pagination when a page is shorter than PER_PAGE (100)", async () => {
    const fullPage = new Array(100).fill({
      title: "Job",
      url: "https://www.arbeitnow.com/jobs/job-1",
      company_name: "Co",
    });
    const fetchJson = vi
      .fn()
      .mockResolvedValueOnce({ data: fullPage })
      .mockResolvedValueOnce({ data: [{ title: "Last Job", url: "https://www.arbeitnow.com/jobs/job-2", company_name: "Co" }] });
    const ctx: ScanFetchContext = { fetchJson, fetchText: vi.fn(), fetchRaw: vi.fn() };
    const result = await arbeitnowProvider.fetch(baseTarget, ctx);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(101);
  });

  it("throws when the API response has no data array", async () => {
    const ctx = fakeCtx({ jobs: [] });
    await expect(arbeitnowProvider.fetch(baseTarget, ctx)).rejects.toThrow(
      /unexpected API response/,
    );
  });
});
