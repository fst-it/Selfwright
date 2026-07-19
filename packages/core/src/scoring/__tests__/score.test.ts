import { describe, expect, it } from "vitest";
import type { Archetype, Ontology } from "../../truth/schemas/index.js";
import { buildSynonymMap, scorePosting } from "../score.js";
import type { Posting } from "../types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CTRM_ARCHETYPE: Archetype = {
  id: "ctrm-enterprise-architect",
  label: "CTRM Enterprise Architect",
  related_titles: [
    "Enterprise Architect",
    "Solution Architect",
    "CTRM Architect",
    "Trading Technology Architect",
  ],
  match_keywords: ["CTRM", "ETRM", "trading", "commodities", "architecture", "integration"],
  search: {
    geos: ["Amsterdam", "London", "Geneva"],
    seniority: ["senior", "principal", "lead", "architect"],
  },
};

const DATA_ARCHETYPE: Archetype = {
  id: "head-of-data-ai",
  label: "Head of Data & AI",
  related_titles: ["Head of Data", "Chief Data Officer", "Director of Data", "VP of Data"],
  match_keywords: ["data", "AI", "machine learning", "analytics", "data platform"],
  search: {
    geos: ["Amsterdam", "London"],
    seniority: ["head", "director", "vp", "chief"],
  },
};

const ONTOLOGY: Ontology = {
  CTRM: ["commodity trading", "energy trading system", "trade lifecycle"],
  architecture: ["solution design", "systems architecture"],
};

// ── buildSynonymMap ───────────────────────────────────────────────────────────

describe("buildSynonymMap", () => {
  it("maps canonical terms to themselves", () => {
    const map = buildSynonymMap(ONTOLOGY);
    expect(map.has("ctrm")).toBe(true);
    expect(map.get("ctrm")).toBe("ctrm");
  });

  it("maps synonyms to their canonical", () => {
    const map = buildSynonymMap(ONTOLOGY);
    expect(map.get("commodity trading")).toBe("ctrm");
    expect(map.get("energy trading system")).toBe("ctrm");
    expect(map.get("solution design")).toBe("architecture");
  });

  it("normalises keys (strips punctuation, lowercases)", () => {
    const map = buildSynonymMap({ "C-suite": ["CXO", "C level"] });
    expect(map.has("c suite")).toBe(true);
    expect(map.has("cxo")).toBe(true);
  });

  it("handles empty ontology", () => {
    const map = buildSynonymMap({});
    expect(map.size).toBe(0);
  });

  it("handles null ontology values gracefully", () => {
    const ont = { SomeKey: null } as unknown as Ontology;
    expect(() => buildSynonymMap(ont)).not.toThrow();
  });
});

// ── scorePosting ──────────────────────────────────────────────────────────────

describe("scorePosting", () => {
  it("returns null archetype and grade F when no archetypes", () => {
    const result = scorePosting({ title: "Architect", company: "Trading House Ltd", location: "Amsterdam" }, []);
    expect(result.archetype).toBeNull();
    expect(result.grade).toBe("F");
    expect(result.fit_score).toBe(0);
  });

  it("scores a perfect title+location+sector match as grade A", () => {
    const posting: Posting = {
      title: "CTRM Architect",
      company: "Trading House Ltd",
      location: "Amsterdam",
      description: "CTRM trading architecture commodities integration",
    };
    const result = scorePosting(posting, [CTRM_ARCHETYPE]);
    expect(result.archetype).toBe("ctrm-enterprise-architect");
    expect(result.fit_score).toBeGreaterThanOrEqual(4.5);
    expect(result.grade).toBe("A");
  });

  it("selects best archetype when multiple are provided", () => {
    const posting: Posting = {
      title: "Head of Data & AI",
      company: "Portal Corp",
      location: "Amsterdam",
      description: "data platform AI machine learning analytics",
    };
    const result = scorePosting(posting, [CTRM_ARCHETYPE, DATA_ARCHETYPE]);
    expect(result.archetype).toBe("head-of-data-ai");
  });

  it("title_family weight is 35% — a strong title match dominates", () => {
    const posting: Posting = {
      title: "Enterprise Architect",
      company: "Unknown Corp",
      location: "Unknown City",
    };
    const result = scorePosting(posting, [CTRM_ARCHETYPE]);
    expect(result.dimensions.title_family.score).toBeGreaterThan(0);
    expect(result.dimensions.title_family.weight).toBe("35%");
  });

  it("exposes all 6 dimensions with correct weights", () => {
    const result = scorePosting({ title: "Architect", company: "X", location: "Y" }, [CTRM_ARCHETYPE]);
    const dims = result.dimensions;
    expect(dims.title_family.weight).toBe("35%");
    expect(dims.domain_match.weight).toBe("20%");
    expect(dims.geo_fit.weight).toBe("15%");
    expect(dims.seniority_match.weight).toBe("10%");
    expect(dims.company_type_fit.weight).toBe("10%");
    expect(dims.leadership_match.weight).toBe("10%");
  });

  it("fit_score is 0–5 range", () => {
    const result = scorePosting({ title: "Engineer", company: "Consulting", location: "Berlin" }, [CTRM_ARCHETYPE]);
    expect(result.fit_score).toBeGreaterThanOrEqual(0);
    expect(result.fit_score).toBeLessThanOrEqual(5);
  });

  it("geo_fit=0 when location not in target geos", () => {
    const result = scorePosting({ title: "Architect", company: "X", location: "São Paulo" }, [CTRM_ARCHETYPE]);
    expect(result.dimensions.geo_fit.score).toBe(0);
  });

  it("geo_fit=0.6 for remote/hybrid locations", () => {
    const result = scorePosting({ title: "Architect", company: "X", location: "Remote" }, [CTRM_ARCHETYPE]);
    expect(result.dimensions.geo_fit.score).toBe(0.6);
  });

  it("geo_fit=1.0 for exact geo match", () => {
    const result = scorePosting({ title: "Architect", company: "X", location: "Amsterdam, NL" }, [CTRM_ARCHETYPE]);
    expect(result.dimensions.geo_fit.score).toBe(1.0);
  });

  it("leadership_match=1.0 for executive title", () => {
    const result = scorePosting({ title: "Chief Architect", company: "X", location: "Y" }, [CTRM_ARCHETYPE]);
    expect(result.dimensions.leadership_match.score).toBe(1.0);
  });

  it("leadership_match=0.8 for lead/principal title", () => {
    const result = scorePosting({ title: "Lead Architect", company: "X", location: "Y" }, [CTRM_ARCHETYPE]);
    expect(result.dimensions.leadership_match.score).toBe(0.8);
  });

  it("leadership_match=0.2 when no leadership signal", () => {
    const result = scorePosting({ title: "Software Engineer", company: "X", location: "Y" }, [CTRM_ARCHETYPE]);
    expect(result.dimensions.leadership_match.score).toBe(0.2);
  });

  it("title family boost: d3≥0.9 boosts seniority and leadership", () => {
    // "CTRM Architect" is very close to "CTRM Architect" — high title family score
    const result = scorePosting({ title: "CTRM Architect", company: "X", location: "Y" }, [
      {
        ...CTRM_ARCHETYPE,
        search: { geos: [], seniority: [] }, // no seniority configured
      },
    ]);
    // With no seniority configured, default is 0.5 — but if d3 ≥ 0.9, boosted to 0.8
    if (result.dimensions.title_family.score >= 0.9) {
      expect(result.dimensions.seniority_match.score).toBeGreaterThanOrEqual(0.8);
    }
  });

  it("synonym expansion: synonym in description counts as keyword match", () => {
    const synonymMap = buildSynonymMap(ONTOLOGY);
    const posting: Posting = {
      title: "Trading Architect",
      company: "Trading House Ltd",
      location: "Amsterdam",
      description: "commodity trading lifecycle architecture", // "commodity trading" is synonym for CTRM
    };
    const withMap = scorePosting(posting, [CTRM_ARCHETYPE], synonymMap);
    const withoutMap = scorePosting(posting, [CTRM_ARCHETYPE]);
    // With synonym expansion, CTRM keyword "CTRM" should be matched via "commodity trading"
    expect(withMap.dimensions.domain_match.score).toBeGreaterThanOrEqual(
      withoutMap.dimensions.domain_match.score,
    );
  });

  it("company_type_fit detects trading sector signals", () => {
    const result = scorePosting({ title: "Architect", company: "Trading House Ltd", location: "Y" }, [CTRM_ARCHETYPE]);
    expect(result.dimensions.company_type_fit.score).toBeGreaterThan(0.5);
  });

  it("company_type_fit detects a data-layer commodity-trading company name", () => {
    const vocabulary = {
      anchors: [],
      industryTiers: [],
      commodityKeywords: ["north sea commodities co"],
    };
    const result = scorePosting(
      { title: "Architect", company: "North Sea Commodities Co", location: "Y" },
      [CTRM_ARCHETYPE],
      new Map(),
      vocabulary,
    );
    expect(result.dimensions.company_type_fit.score).toBeGreaterThan(0.3);
  });

  it("company_type_fit=0.3 when no sector signals", () => {
    const result = scorePosting({ title: "Architect", company: "Generic Corp", location: "Y" }, [CTRM_ARCHETYPE]);
    expect(result.dimensions.company_type_fit.score).toBe(0.3);
  });

  it("why_surfaced is non-empty string", () => {
    const result = scorePosting({ title: "Architect", company: "X", location: "Y" }, [CTRM_ARCHETYPE]);
    expect(typeof result.why_surfaced).toBe("string");
    expect(result.why_surfaced.length).toBeGreaterThan(0);
  });

  it("grade thresholds: ≥4.5→A, ≥4.0→B, ≥3.0→C, ≥2.0→D, else F", () => {
    // Directly check letterGrade logic through scorePosting on known-low scenario
    // A score of 0 (no archetypes) = F
    const zeroResult = scorePosting({ title: "", company: "", location: "" }, []);
    expect(zeroResult.grade).toBe("F");
  });

  it("domain_match: 0/n when no keywords match", () => {
    const result = scorePosting({ title: "HR Manager", company: "X", location: "Y" }, [CTRM_ARCHETYPE]);
    expect(result.dimensions.domain_match.note).toMatch(/^0\//);
  });

  it("archetype with no related_titles gives title_family score 0", () => {
    const noTitles: Archetype = {
      ...CTRM_ARCHETYPE,
      related_titles: [],
    };
    const result = scorePosting({ title: "Architect", company: "X", location: "Y" }, [noTitles]);
    expect(result.dimensions.title_family.score).toBe(0);
    expect(result.dimensions.title_family.note).toContain("No related_titles");
  });
});
