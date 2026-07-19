import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanFetchContext, ScanTarget } from "@selfwright/core";
import { adzunaProvider } from "../adzuna.js";

function fakeCtx(json: unknown): ScanFetchContext {
  return {
    fetchJson: vi.fn().mockResolvedValue(json),
    fetchText: vi.fn(),
    fetchRaw: vi.fn(),
  };
}

// Build a page of N unique Adzuna NL postings (unique by sequential id).
function makePage(pageNum: number, size: number, count = 5000) {
  return {
    count,
    results: Array.from({ length: size }, (_, i) => ({
      title: "Job",
      redirect_url: `https://www.adzuna.nl/details/${(pageNum - 1) * 50 + i}`,
      company: { display_name: "Co" },
      location: { display_name: "Amsterdam" },
    })),
  };
}

const baseTarget: ScanTarget = { company: "Acme", provider: "adzuna" };

describe("adzunaProvider.detect", () => {
  beforeEach(() => {
    process.env["SELFWRIGHT_ADZUNA_APP_ID"] = "test-id";
    process.env["SELFWRIGHT_ADZUNA_APP_KEY"] = "test-key";
  });

  afterEach(() => {
    delete process.env["SELFWRIGHT_ADZUNA_APP_ID"];
    delete process.env["SELFWRIGHT_ADZUNA_APP_KEY"];
  });

  it("returns first-page URL when env vars are set", () => {
    const result = adzunaProvider.detect(baseTarget);
    expect(result).toEqual({ url: "https://api.adzuna.com/v1/api/jobs/gb/search/1" });
  });

  it("uses a custom api base URL from the target", () => {
    const target: ScanTarget = {
      ...baseTarget,
      api: "https://api.adzuna.com/v1/api/jobs/us/search",
    };
    const result = adzunaProvider.detect(target);
    expect(result).toEqual({ url: "https://api.adzuna.com/v1/api/jobs/us/search/1" });
  });

  it("returns null when SELFWRIGHT_ADZUNA_APP_ID is missing", () => {
    delete process.env["SELFWRIGHT_ADZUNA_APP_ID"];
    expect(adzunaProvider.detect(baseTarget)).toBeNull();
  });

  it("returns null when SELFWRIGHT_ADZUNA_APP_KEY is missing", () => {
    delete process.env["SELFWRIGHT_ADZUNA_APP_KEY"];
    expect(adzunaProvider.detect(baseTarget)).toBeNull();
  });

  it("returns null for a target with a different provider", () => {
    const target: ScanTarget = { ...baseTarget, provider: "greenhouse" };
    expect(adzunaProvider.detect(target)).toBeNull();
  });

  it("returns null when api URL is on an untrusted host (SSRF guard)", () => {
    const target: ScanTarget = {
      ...baseTarget,
      api: "https://evil.example/v1/api/jobs/gb/search",
    };
    expect(adzunaProvider.detect(target)).toBeNull();
  });

  it("uses country field in URL path", () => {
    const target: ScanTarget = { ...baseTarget, country: "nl" };
    expect(adzunaProvider.detect(target)).toEqual({
      url: "https://api.adzuna.com/v1/api/jobs/nl/search/1",
    });
  });

  it("lowercases the country code in the URL path", () => {
    const target: ScanTarget = { ...baseTarget, country: "NL" };
    expect(adzunaProvider.detect(target)).toEqual({
      url: "https://api.adzuna.com/v1/api/jobs/nl/search/1",
    });
  });

  it("returns null for an invalid country code — 3 chars (gbr)", () => {
    expect(adzunaProvider.detect({ ...baseTarget, country: "gbr" })).toBeNull();
  });

  it("returns null for an invalid country code — 1 char (g)", () => {
    expect(adzunaProvider.detect({ ...baseTarget, country: "g" })).toBeNull();
  });

  it("accepts country with trailing whitespace after trim (nl )", () => {
    const result = adzunaProvider.detect({ ...baseTarget, country: "nl " });
    expect(result).toEqual({ url: "https://api.adzuna.com/v1/api/jobs/nl/search/1" });
  });
});

describe("adzunaProvider.fetch", () => {
  beforeEach(() => {
    process.env["SELFWRIGHT_ADZUNA_APP_ID"] = "test-id";
    process.env["SELFWRIGHT_ADZUNA_APP_KEY"] = "test-key";
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    delete process.env["SELFWRIGHT_ADZUNA_APP_ID"];
    delete process.env["SELFWRIGHT_ADZUNA_APP_KEY"];
    vi.restoreAllMocks();
  });

  it("maps Adzuna results to RawPosting", async () => {
    const ctx = fakeCtx({
      results: [
        {
          title: "Senior Architect",
          redirect_url: "https://www.adzuna.com/jobs/details/123",
          company: { display_name: "TechCorp" },
          location: { display_name: "Amsterdam, Netherlands" },
          description: "Lead the platform team.",
        },
      ],
    });
    const result = await adzunaProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: "Senior Architect",
      url: "https://www.adzuna.com/jobs/details/123",
      company: "TechCorp",
      location: "Amsterdam, Netherlands",
      source: "adzuna",
      sourceKind: "structured",
      description: "Lead the platform team.",
    });
  });

  it("sends app_id and app_key in the query string", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ results: [] });
    const ctx: ScanFetchContext = { fetchJson, fetchText: vi.fn(), fetchRaw: vi.fn() };
    await adzunaProvider.fetch(baseTarget, ctx);
    const calledUrl = fetchJson.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("app_id=test-id");
    expect(calledUrl).toContain("app_key=test-key");
  });

  // ── Query construction ────────────────────────────────────────────────────

  it("batches single-word titleFilter entries into one what_or query", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ results: [] });
    const ctx: ScanFetchContext = { fetchJson, fetchText: vi.fn(), fetchRaw: vi.fn() };
    const target: ScanTarget = {
      ...baseTarget,
      titleFilter: ["architect", "principal"],
    };
    await adzunaProvider.fetch(target, ctx);
    const calledUrl = fetchJson.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("what_or=architect+principal");
    expect(calledUrl).not.toContain("what=architect");
  });

  it("issues a separate what_phrase query for each multi-word titleFilter entry", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ results: [], count: 0 });
    const ctx: ScanFetchContext = { fetchJson, fetchText: vi.fn(), fetchRaw: vi.fn() };
    const target: ScanTarget = {
      ...baseTarget,
      titleFilter: ["architect", "head of"],
    };
    await adzunaProvider.fetch(target, ctx);
    const calledUrls = fetchJson.mock.calls.map((c) => c[0] as string);
    const whatOrCalls = calledUrls.filter((u) => u.includes("what_or=architect"));
    const whatPhraseCalls = calledUrls.filter((u) => u.includes("what_phrase=head+of"));
    expect(whatOrCalls.length).toBeGreaterThan(0);
    expect(whatPhraseCalls.length).toBeGreaterThan(0);
    // "head of" must NOT be batched into what_or
    expect(calledUrls.every((u) => !u.includes("what_or=architect+head"))).toBe(true);
  });

  it("issues only what_phrase queries when all titleFilter entries are multi-word", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ results: [], count: 0 });
    const ctx: ScanFetchContext = { fetchJson, fetchText: vi.fn(), fetchRaw: vi.fn() };
    const target: ScanTarget = {
      ...baseTarget,
      titleFilter: ["head of", "vice president"],
    };
    await adzunaProvider.fetch(target, ctx);
    const calledUrls = fetchJson.mock.calls.map((c) => c[0] as string);
    expect(calledUrls.some((u) => u.includes("what_phrase=head+of"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("what_phrase=vice+president"))).toBe(true);
    expect(calledUrls.every((u) => !u.includes("what_or="))).toBe(true);
  });

  it("uses first locationFilter entry as the `where` param", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ results: [] });
    const ctx: ScanFetchContext = { fetchJson, fetchText: vi.fn(), fetchRaw: vi.fn() };
    const target: ScanTarget = {
      ...baseTarget,
      locationFilter: ["Amsterdam", "Remote"],
    };
    await adzunaProvider.fetch(target, ctx);
    const calledUrl = fetchJson.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("where=Amsterdam");
  });

  // ── Country routing ───────────────────────────────────────────────────────

  it("uses country field in URL path when fetching", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ results: [] });
    const ctx: ScanFetchContext = { fetchJson, fetchText: vi.fn(), fetchRaw: vi.fn() };
    const target: ScanTarget = { ...baseTarget, country: "nl" };
    await adzunaProvider.fetch(target, ctx);
    const calledUrl = fetchJson.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("/nl/");
    expect(calledUrl).not.toContain("/gb/");
  });

  it("lowercases country code in fetch URL path", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ results: [] });
    const ctx: ScanFetchContext = { fetchJson, fetchText: vi.fn(), fetchRaw: vi.fn() };
    const target: ScanTarget = { ...baseTarget, country: "CH" };
    await adzunaProvider.fetch(target, ctx);
    const calledUrl = fetchJson.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("/ch/");
  });

  it("warns and returns [] for invalid country — 3 chars (gbr)", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const result = await adzunaProvider.fetch({ ...baseTarget, country: "gbr" }, fakeCtx({}));
    expect(result).toHaveLength(0);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("invalid country"));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("gbr"));
  });

  it("warns and returns [] for invalid country — 1 char (g)", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const result = await adzunaProvider.fetch({ ...baseTarget, country: "g" }, fakeCtx({}));
    expect(result).toHaveLength(0);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("invalid country"));
  });

  it("warns and returns [] for invalid country — 3 chars (zzz)", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const result = await adzunaProvider.fetch({ ...baseTarget, country: "zzz" }, fakeCtx({}));
    expect(result).toHaveLength(0);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("invalid country"));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("zzz"));
  });

  it("treats country with trailing whitespace as valid after trim (nl )", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ results: [] });
    const ctx: ScanFetchContext = { fetchJson, fetchText: vi.fn(), fetchRaw: vi.fn() };
    await adzunaProvider.fetch({ ...baseTarget, country: "nl " }, ctx);
    const calledUrl = fetchJson.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("/nl/");
  });

  it("emits a stderr note when default gb index is used with locationFilter", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fetchJson = vi.fn().mockResolvedValue({ results: [] });
    const ctx: ScanFetchContext = { fetchJson, fetchText: vi.fn(), fetchRaw: vi.fn() };
    const target: ScanTarget = { ...baseTarget, locationFilter: ["Netherlands"] };
    await adzunaProvider.fetch(target, ctx);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("no country set"));
  });

  it("does not emit the default-gb note when country is explicitly set", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fetchJson = vi.fn().mockResolvedValue({ results: [] });
    const ctx: ScanFetchContext = { fetchJson, fetchText: vi.fn(), fetchRaw: vi.fn() };
    const target: ScanTarget = {
      ...baseTarget,
      country: "nl",
      locationFilter: ["Amsterdam"],
    };
    await adzunaProvider.fetch(target, ctx);
    const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.every((msg) => !msg.includes("no country set"))).toBe(true);
  });

  // ── SSRF guards ───────────────────────────────────────────────────────────

  it("drops a posting whose redirect_url is off-domain (SSRF guard)", async () => {
    const ctx = fakeCtx({
      results: [
        {
          title: "Legitimate Job",
          redirect_url: "https://www.adzuna.com/jobs/details/1",
          company: { display_name: "Good Co" },
          location: { display_name: "London" },
        },
        {
          title: "Evil Job",
          redirect_url: "http://169.254.169.254/latest/meta-data",
          company: { display_name: "Bad Co" },
          location: { display_name: "Nowhere" },
        },
      ],
    });
    const result = await adzunaProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Legitimate Job");
  });

  it("throws when the api base URL is on an untrusted host (SSRF guard)", async () => {
    const target: ScanTarget = {
      ...baseTarget,
      api: "https://evil.example/v1/api/jobs/gb/search",
    };
    await expect(adzunaProvider.fetch(target, fakeCtx({}))).rejects.toThrow(/untrusted hostname/);
  });

  describe("redirect_url allowlist — enumerated Adzuna country domains (SSRF bypass matrix)", () => {
    // Drive fetch() with a single posting whose redirect_url is under test.
    async function fetchWithUrl(redirectUrl: string) {
      const ctx = fakeCtx({
        results: [
          {
            title: "Job",
            redirect_url: redirectUrl,
            company: { display_name: "Co" },
            location: { display_name: "L" },
          },
        ],
      });
      return adzunaProvider.fetch(baseTarget, ctx);
    }

    // ─── Domains that must be REJECTED ─────────────────────────────────────
    it("rejects adzuna.ai — not an operated country domain", async () => {
      expect(await fetchWithUrl("https://www.adzuna.ai/jobs/1")).toHaveLength(0);
    });
    it("rejects adzuna.co — not an operated country domain", async () => {
      expect(await fetchWithUrl("https://adzuna.co/jobs/1")).toHaveLength(0);
    });
    it("rejects adzuna.me — not an operated country domain", async () => {
      expect(await fetchWithUrl("https://www.adzuna.me/jobs/1")).toHaveLength(0);
    });
    it("rejects eviladzuna.nl — suffix spoof, not an Adzuna domain", async () => {
      expect(await fetchWithUrl("https://eviladzuna.nl/jobs/1")).toHaveLength(0);
    });
    it("rejects adzuna.nl.evil.com — subdomain injection bypass attempt", async () => {
      expect(await fetchWithUrl("https://adzuna.nl.evil.com/jobs/1")).toHaveLength(0);
    });

    // ─── Operated country domains that must be ACCEPTED ────────────────────
    it("accepts www.adzuna.com — US/generic domain", async () => {
      expect(await fetchWithUrl("https://www.adzuna.com/jobs/details/1")).toHaveLength(1);
    });
    it("accepts www.adzuna.co.uk — GB domain", async () => {
      expect(await fetchWithUrl("https://www.adzuna.co.uk/jobs/details/1")).toHaveLength(1);
    });
    it("accepts www.adzuna.nl — NL domain (verified live)", async () => {
      expect(await fetchWithUrl("https://www.adzuna.nl/details/42")).toHaveLength(1);
    });
    it("accepts www.adzuna.ch — CH domain (verified live)", async () => {
      expect(await fetchWithUrl("https://www.adzuna.ch/land/ad/123")).toHaveLength(1);
    });
    it("accepts www.adzuna.com.au — AU domain (verified live)", async () => {
      expect(await fetchWithUrl("https://www.adzuna.com.au/jobs/details/1")).toHaveLength(1);
    });
    it("accepts www.adzuna.co.za — ZA domain (verified live)", async () => {
      expect(await fetchWithUrl("https://www.adzuna.co.za/jobs/details/1")).toHaveLength(1);
    });
    it("accepts www.adzuna.de — DE domain", async () => {
      expect(await fetchWithUrl("https://www.adzuna.de/jobs/details/1")).toHaveLength(1);
    });
  });

  // ── Deduplication ─────────────────────────────────────────────────────────

  it("deduplicates results by redirect_url across pages (case-insensitive)", async () => {
    const fetchJson = vi
      .fn()
      .mockResolvedValueOnce({
        count: 51,
        results: new Array(50).fill({
          title: "Job",
          redirect_url: "https://www.adzuna.com/jobs/details/99",
          company: { display_name: "Co" },
          location: { display_name: "London" },
        }),
      })
      .mockResolvedValueOnce({
        count: 51,
        results: [
          {
            title: "Job Duplicate",
            // Mixed case — should still dedup
            redirect_url: "HTTPS://WWW.ADZUNA.COM/JOBS/DETAILS/99",
            company: { display_name: "Co" },
            location: { display_name: "London" },
          },
          {
            title: "Unique Job",
            redirect_url: "https://www.adzuna.com/jobs/details/100",
            company: { display_name: "Co" },
            location: { display_name: "London" },
          },
        ],
      });
    const ctx: ScanFetchContext = { fetchJson, fetchText: vi.fn(), fetchRaw: vi.fn() };
    const result = await adzunaProvider.fetch(baseTarget, ctx);
    const urls = result.map((r) => r.url);
    // The mixed-case duplicate must be deduped
    expect(urls.filter((u) => u.toLowerCase().includes("details/99"))).toHaveLength(1);
    expect(urls.some((u) => u.toLowerCase().includes("details/100"))).toBe(true);
  });

  it("deduplicates results across separate queries (what_or + what_phrase)", async () => {
    // Both queries return the same redirect_url — only one RawPosting should appear.
    const sharedUrl = "https://www.adzuna.nl/details/999";
    const fetchJson = vi.fn().mockResolvedValue({
      count: 1,
      results: [
        {
          title: "Director of Architecture",
          redirect_url: sharedUrl,
          company: { display_name: "Co" },
          location: { display_name: "Amsterdam" },
        },
      ],
    });
    const ctx: ScanFetchContext = { fetchJson, fetchText: vi.fn(), fetchRaw: vi.fn() };
    const target: ScanTarget = {
      ...baseTarget,
      titleFilter: ["director", "head of"], // one what_or + one what_phrase query
    };
    const result = await adzunaProvider.fetch(target, ctx);
    // Even with two queries both returning the same URL, only 1 posting in output
    expect(result.filter((r) => r.url === sharedUrl)).toHaveLength(1);
  });

  // ── Pagination ────────────────────────────────────────────────────────────

  it("stops pagination on a short page (fewer than 50 results)", async () => {
    const fetchJson = vi
      .fn()
      .mockResolvedValueOnce({
        count: 51,
        results: new Array(50).fill({ title: "Job", redirect_url: "https://www.adzuna.com/jobs/details/1", company: { display_name: "Co" }, location: { display_name: "London" } }),
      })
      .mockResolvedValueOnce({
        count: 51,
        results: [{ title: "Last", redirect_url: "https://www.adzuna.com/jobs/details/2", company: { display_name: "Co" }, location: { display_name: "London" } }],
      });
    const ctx: ScanFetchContext = { fetchJson, fetchText: vi.fn(), fetchRaw: vi.fn() };
    const result = await adzunaProvider.fetch(baseTarget, ctx);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
  });

  it("warns to stderr when MAX_PAGES cap is hit with more results available", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fetchJson = vi.fn().mockImplementation((url: string) => {
      const m = /\/search\/(\d+)/.exec(url);
      const page = m ? parseInt(m[1] ?? "1", 10) : 1;
      return Promise.resolve(makePage(page, 50, 5000));
    });
    const ctx: ScanFetchContext = { fetchJson, fetchText: vi.fn(), fetchRaw: vi.fn() };
    const target: ScanTarget = {
      ...baseTarget,
      country: "nl",
      titleFilter: ["engineer"],
    };
    const result = await adzunaProvider.fetch(target, ctx);
    expect(fetchJson).toHaveBeenCalledTimes(10); // MAX_PAGES pages
    expect(result).toHaveLength(500); // 10 × 50
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("500 of 5000"));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("cap"));
  });

  it("does not warn on truncation when all results fit within the page cap", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fetchJson = vi.fn().mockResolvedValueOnce(makePage(1, 3, 3));
    const ctx: ScanFetchContext = { fetchJson, fetchText: vi.fn(), fetchRaw: vi.fn() };
    const target: ScanTarget = { ...baseTarget, country: "nl", titleFilter: ["engineer"] };
    await adzunaProvider.fetch(target, ctx);
    const msgs = stderrSpy.mock.calls.map((c) => String(c[0]));
    expect(msgs.every((m) => !m.includes("cap"))).toBe(true);
  });

  // ── Never-silent rule ──────────────────────────────────────────────────────

  it("warns to stderr when 0 postings are returned with valid keys", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const target: ScanTarget = {
      ...baseTarget,
      country: "nl",
      titleFilter: ["architect"],
      locationFilter: ["Amsterdam"],
    };
    const result = await adzunaProvider.fetch(target, fakeCtx({ results: [] }));
    expect(result).toHaveLength(0);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("0 postings"));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Acme"));
  });

  it("warns to stderr and returns [] when app_id is missing", async () => {
    delete process.env["SELFWRIGHT_ADZUNA_APP_ID"];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const result = await adzunaProvider.fetch(baseTarget, fakeCtx({}));
    expect(result).toHaveLength(0);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("SELFWRIGHT_ADZUNA_APP_ID"));
  });

  it("warns to stderr and returns [] when app_key is missing", async () => {
    delete process.env["SELFWRIGHT_ADZUNA_APP_KEY"];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const result = await adzunaProvider.fetch(baseTarget, fakeCtx({}));
    expect(result).toHaveLength(0);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("SELFWRIGHT_ADZUNA_APP_KEY"));
  });
});
