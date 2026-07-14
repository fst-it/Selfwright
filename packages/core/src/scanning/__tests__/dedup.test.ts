import { describe, expect, it } from "vitest";
import { isSeen, dedupeByCompanyRole, dedupeByCompanyRoleFuzzy, areSimilarTitles } from "../dedup.js";
import type { RawPosting, SeenEntry } from "../types.js";

function posting(overrides: Partial<RawPosting> = {}): RawPosting {
  return {
    url: "https://boards-api.greenhouse.io/v1/boards/acme/jobs/123",
    title: "Enterprise Architect",
    company: "Acme",
    location: "Amsterdam, NL",
    source: "greenhouse",
    fetchedAt: "2026-07-03T00:00:00.000Z",
    ...overrides,
  };
}

describe("isSeen", () => {
  it("returns true when the exact URL is already in the seen list", () => {
    const seen: SeenEntry[] = [
      { url: "https://x.example/jobs/1", firstSeen: "2026-01-01", source: "greenhouse", status: "live" },
    ];
    expect(isSeen("https://x.example/jobs/1", seen)).toBe(true);
  });

  it("returns false for a URL not in the seen list", () => {
    const seen: SeenEntry[] = [
      { url: "https://x.example/jobs/1", firstSeen: "2026-01-01", source: "greenhouse", status: "live" },
    ];
    expect(isSeen("https://x.example/jobs/2", seen)).toBe(false);
  });

  it("returns false for an empty seen list", () => {
    expect(isSeen("https://x.example/jobs/1", [])).toBe(false);
  });
});

describe("dedupeByCompanyRole", () => {
  it("keeps only the first posting for an exact-normalized company+title match", () => {
    const postings = [
      posting({ url: "https://a.example/1" }),
      posting({ url: "https://a.example/2", company: "  ACME  ", title: "enterprise   architect" }),
    ];
    const result = dedupeByCompanyRole(postings);
    expect(result).toHaveLength(1);
    expect(result[0]?.url).toBe("https://a.example/1");
  });

  it("keeps postings with different titles at the same company", () => {
    const postings = [
      posting({ url: "https://a.example/1", title: "Enterprise Architect" }),
      posting({ url: "https://a.example/2", title: "Director of Architecture" }),
    ];
    expect(dedupeByCompanyRole(postings)).toHaveLength(2);
  });

  it("keeps postings with the same title at different companies", () => {
    const postings = [
      posting({ url: "https://a.example/1", company: "Acme" }),
      posting({ url: "https://b.example/1", company: "Beta" }),
    ];
    expect(dedupeByCompanyRole(postings)).toHaveLength(2);
  });

  it("returns an empty array for an empty input", () => {
    expect(dedupeByCompanyRole([])).toEqual([]);
  });
});

describe("areSimilarTitles", () => {
  it("treats seniority-only difference as similar ('Senior Engineer' ≈ 'Sr. Engineer')", () => {
    expect(areSimilarTitles("Senior Engineer", "Sr. Engineer")).toBe(true);
  });

  it("treats abbreviated seniority as similar ('Principal Architect' ≈ 'Architect')", () => {
    expect(areSimilarTitles("Principal Architect", "Architect")).toBe(true);
  });

  it("treats substantively different titles as not similar", () => {
    expect(areSimilarTitles("Software Engineer", "Product Manager")).toBe(false);
  });

  it("treats same title as similar", () => {
    expect(areSimilarTitles("Data Engineer", "Data Engineer")).toBe(true);
  });
});

describe("dedupeByCompanyRoleFuzzy", () => {
  it("collapses 'Senior Engineer' and 'Sr. Engineer' at the same company", () => {
    const postings = [
      posting({ url: "https://a.example/1", title: "Senior Engineer" }),
      posting({ url: "https://a.example/2", title: "Sr. Engineer" }),
    ];
    const result = dedupeByCompanyRoleFuzzy(postings);
    expect(result).toHaveLength(1);
    expect(result[0]?.url).toBe("https://a.example/1");
  });

  it("collapses seniority variant 'Principal Architect' and 'Architect' at the same company", () => {
    const postings = [
      posting({ url: "https://a.example/1", title: "Principal Architect" }),
      posting({ url: "https://a.example/2", title: "Architect" }),
    ];
    const result = dedupeByCompanyRoleFuzzy(postings);
    expect(result).toHaveLength(1);
  });

  it("keeps substantively different titles at the same company", () => {
    const postings = [
      posting({ url: "https://a.example/1", title: "Software Engineer" }),
      posting({ url: "https://a.example/2", title: "Product Manager" }),
    ];
    expect(dedupeByCompanyRoleFuzzy(postings)).toHaveLength(2);
  });

  it("keeps similar titles at different companies", () => {
    const postings = [
      posting({ url: "https://a.example/1", company: "Acme", title: "Senior Engineer" }),
      posting({ url: "https://b.example/1", company: "Beta", title: "Sr. Engineer" }),
    ];
    expect(dedupeByCompanyRoleFuzzy(postings)).toHaveLength(2);
  });

  it("returns an empty array for an empty input", () => {
    expect(dedupeByCompanyRoleFuzzy([])).toEqual([]);
  });
});
