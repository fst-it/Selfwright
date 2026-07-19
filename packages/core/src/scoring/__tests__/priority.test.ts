import { describe, expect, it } from "vitest";
import type { CompFloors } from "../../truth/schemas/index.js";
import { classifyIndustry, compAxis, computePriority, fitNorm, locationAxis } from "../priority.js";
import type { ScoringVocabulary } from "../vocabulary.js";

// ── Synthetic test vocabulary (dictionary-safe, no real company names) ────────
// ADR 0017: the owner's real industry-tier company names live in the private
// data layer, never in framework tests. classifyIndustry/computePriority take
// the vocabulary as an explicit parameter, so tests inject this fixture.

const TEST_VOCABULARY: ScoringVocabulary = {
  anchors: ["acme rowing", "widget bank", "north star consulting"],
  industryTiers: [
    { bucket: "trading", points: 5, keywords: ["acme rowing", "north sea trading co"] },
    { bucket: "bank_or_asset_mgr", points: 4, keywords: ["widget bank", "north star financial"] },
    { bucket: "strategy_consulting", points: 4, keywords: ["north star consulting", "blue ridge advisory"] },
    { bucket: "tech_frontier", points: 3, keywords: ["nimbus cloud corp", "vertex software"] },
    { bucket: "pharma_manufacturing", points: 2, keywords: ["greenfield pharma", "meridian biotech"] },
    { bucket: "it_services_or_other", points: 1, keywords: ["oakridge it services", "lighthouse outsourcing"] },
  ],
  commodityKeywords: ["acme rowing", "north sea trading co"],
};

// ── Fixture comp floors ───────────────────────────────────────────────────────

const FLOORS: CompFloors = {
  meta: {
    source: "test-fixture",
    generated: "2026-01-01",
    amsterdam_discretionary_baseline_eur: 120000,
    review_cadence: "annual",
    location_tiers: "see cities",
  },
  cities: [
    {
      city: "Amsterdam",
      country: "NL",
      location_tier_points: 6,
      floor_a_eur: 120000,
      floor_b_eur: 145000,
      col_index: null,
      regime_floor_a_eur: null,
    },
    {
      city: "Geneva",
      country: "CH",
      location_tier_points: 5,
      floor_a_eur: 150000,
      floor_b_eur: null, // will be computed as floor_a * 1.175
      col_index: null,
      regime_floor_a_eur: null,
    },
    {
      city: "Madrid",
      country: "ES",
      location_tier_points: 3,
      floor_a_eur: 80000,
      floor_b_eur: 95000,
      col_index: null,
      regime_floor_a_eur: 70000,
    },
  ],
};

// ── classifyIndustry ──────────────────────────────────────────────────────────

describe("classifyIndustry", () => {
  it("classifies a trading-tier company as trading (5 points)", () => {
    const result = classifyIndustry("Acme Rowing", TEST_VOCABULARY);
    expect(result.bucket).toBe("trading");
    expect(result.points).toBe(5);
  });

  it("classifies a consulting-tier company as strategy_consulting (4 points)", () => {
    const result = classifyIndustry("North Star Consulting Group", TEST_VOCABULARY);
    expect(result.bucket).toBe("strategy_consulting");
    expect(result.points).toBe(4);
  });

  it("classifies a bank-tier company as bank_or_asset_mgr (4 points)", () => {
    const result = classifyIndustry("Widget Bank plc", TEST_VOCABULARY);
    expect(result.bucket).toBe("bank_or_asset_mgr");
    expect(result.points).toBe(4);
  });

  it("classifies a tech-tier company as tech_frontier (3 points)", () => {
    const result = classifyIndustry("Nimbus Cloud Corp", TEST_VOCABULARY);
    expect(result.bucket).toBe("tech_frontier");
    expect(result.points).toBe(3);
  });

  it("classifies an it-services-tier company as it_services_or_other (1 point)", () => {
    const result = classifyIndustry("Oakridge IT Services BV", TEST_VOCABULARY);
    expect(result.bucket).toBe("it_services_or_other");
    expect(result.points).toBe(1);
  });

  it("defaults unknown company to it_services_or_other", () => {
    const result = classifyIndustry("Random Startup GmbH", TEST_VOCABULARY);
    expect(result.bucket).toBe("it_services_or_other");
    expect(result.points).toBe(1);
  });

  it("norm value is points/5 clamped to 0-1", () => {
    expect(classifyIndustry("Acme Rowing", TEST_VOCABULARY).norm).toBe(1.0);
    expect(classifyIndustry("Oakridge IT Services BV", TEST_VOCABULARY).norm).toBeCloseTo(0.2, 3);
  });

  it("is case-insensitive", () => {
    expect(classifyIndustry("ACME ROWING", TEST_VOCABULARY).points).toBe(5);
    expect(classifyIndustry("acme rowing", TEST_VOCABULARY).points).toBe(5);
  });

  it("uses the synthetic default vocabulary when none is supplied", () => {
    const result = classifyIndustry("Some Company With No Match");
    expect(result.bucket).toBe("it_services_or_other");
    expect(result.points).toBe(1);
  });
});

// ── locationAxis ──────────────────────────────────────────────────────────────

describe("locationAxis", () => {
  it("returns NL = 6 points for Amsterdam", () => {
    const result = locationAxis("Amsterdam", FLOORS);
    expect(result.points).toBe(6);
    expect(result.country).toBe("NL");
    expect(result.in_scope).toBe(true);
  });

  it("returns CH = 5 points for Geneva", () => {
    expect(locationAxis("Geneva", FLOORS).points).toBe(5);
  });

  it("returns 0 points for unknown city", () => {
    const result = locationAxis("Nairobi", FLOORS);
    expect(result.points).toBe(0);
    expect(result.in_scope).toBe(false);
  });

  it("matches substring (city in larger string)", () => {
    const result = locationAxis("Amsterdam, Netherlands", FLOORS);
    expect(result.points).toBe(6);
  });

  it("norm = points/6 clamped to 0-1", () => {
    expect(locationAxis("Amsterdam", FLOORS).norm).toBeCloseTo(1.0, 5);
    expect(locationAxis("Geneva", FLOORS).norm).toBeCloseTo(5 / 6, 5);
  });
});

// ── compAxis ──────────────────────────────────────────────────────────────────

describe("compAxis", () => {
  it("returns norm=1.0 when comp >= floor_b", () => {
    const result = compAxis(150000, "Amsterdam", FLOORS);
    expect(result.norm).toBe(1.0);
    expect(result.risk).toBeNull();
    expect(result.floor_a_used).toBe(120000);
  });

  it("returns linear norm between 0.70-0.99 when comp in [floor_a, floor_b)", () => {
    const result = compAxis(130000, "Amsterdam", FLOORS);
    expect(result.norm).toBeGreaterThanOrEqual(0.7);
    expect(result.norm).toBeLessThan(1.0);
    expect(result.risk).toBeNull();
  });

  it("returns norm=0.5 and risk=marginal when comp in [0.9*floor_a, floor_a)", () => {
    const result = compAxis(110000, "Amsterdam", FLOORS); // 0.9*120k = 108k
    expect(result.norm).toBe(0.5);
    expect(result.risk).toBe("marginal");
  });

  it("returns norm=0.2 and risk=below when comp < 0.9*floor_a", () => {
    const result = compAxis(90000, "Amsterdam", FLOORS);
    expect(result.norm).toBe(0.2);
    expect(result.risk).toBe("below");
  });

  it("returns norm=0.5 and risk=undisclosed when comp is null", () => {
    const result = compAxis(null, "Amsterdam", FLOORS);
    expect(result.norm).toBe(0.5);
    expect(result.risk).toBe("undisclosed");
  });

  it("returns risk=no_floor_data for unknown city", () => {
    const result = compAxis(100000, "Nairobi", FLOORS);
    expect(result.risk).toBe("no_floor_data");
    expect(result.norm).toBe(0.5);
  });

  it("uses regime_floor_a_eur when useRegime=true", () => {
    // Madrid: floor_a=80k, regime_floor_a=70k
    const normal = compAxis(75000, "Madrid", FLOORS);
    const regime = compAxis(75000, "Madrid", FLOORS, { useRegime: true });
    // With regime floor (70k), 75k is above floor_a — should be better
    expect(regime.floor_a_used).toBe(70000);
    expect(normal.floor_a_used).toBe(80000);
  });

  it("uses computed floor_b when null (floor_a * 1.175)", () => {
    // Geneva: floor_a=150k, floor_b=null → floor_b = 150k * 1.175 = 176.25k
    const result = compAxis(180000, "Geneva", FLOORS);
    expect(result.norm).toBe(1.0); // 180k > 176.25k
  });
});

// ── fitNorm ───────────────────────────────────────────────────────────────────

describe("fitNorm", () => {
  it("normalises fit score to 0-1 range (divides by 5)", () => {
    expect(fitNorm(5)).toBe(1.0);
    expect(fitNorm(0)).toBe(0.0);
    expect(fitNorm(2.5)).toBe(0.5);
  });

  it("clamps to 0..1", () => {
    expect(fitNorm(10)).toBe(1.0);
    expect(fitNorm(-1)).toBe(0.0);
  });

  it("returns 0 for null/undefined/NaN", () => {
    expect(fitNorm(null)).toBe(0);
    expect(fitNorm(undefined)).toBe(0);
    expect(fitNorm(NaN)).toBe(0);
  });
});

// ── computePriority ───────────────────────────────────────────────────────────

describe("computePriority", () => {
  it("returns a priority_score in 0..4 range", () => {
    const result = computePriority(
      { company: "Acme Rowing", scored_city: "Amsterdam", fit_score: 5, comp_eur: 160000 },
      FLOORS,
      {},
      TEST_VOCABULARY,
    );
    expect(result.priority_score).toBeGreaterThanOrEqual(0);
    expect(result.priority_score).toBeLessThanOrEqual(4);
  });

  it("marks anchor companies correctly", () => {
    const anchor = computePriority(
      { company: "Acme Rowing", scored_city: "Amsterdam", fit_score: 4, comp_eur: 130000 },
      FLOORS,
      {},
      TEST_VOCABULARY,
    );
    const nonAnchor = computePriority(
      { company: "Oakridge IT Services BV", scored_city: "Amsterdam", fit_score: 4, comp_eur: 130000 },
      FLOORS,
      {},
      TEST_VOCABULARY,
    );
    expect(anchor.anchor).toBe(true);
    expect(nonAnchor.anchor).toBe(false);
  });

  it("high-quality role: trading-tier anchor Amsterdam fit=5 good-comp scores high", () => {
    const result = computePriority(
      { company: "Acme Rowing", scored_city: "Amsterdam", fit_score: 5, comp_eur: 160000 },
      FLOORS,
      {},
      TEST_VOCABULARY,
    );
    expect(result.priority_score).toBeGreaterThan(3.0);
  });

  it("poor role: IT services unknown city fit=2 no comp scores low", () => {
    const result = computePriority(
      { company: "Oakridge IT Services BV", scored_city: "Nairobi", fit_score: 2, comp_eur: null },
      FLOORS,
      {},
      TEST_VOCABULARY,
    );
    expect(result.priority_score).toBeLessThan(1.5);
  });

  it("exposes all 4 axis breakdowns", () => {
    const result = computePriority(
      { company: "Acme Rowing", scored_city: "Amsterdam", fit_score: 4, comp_eur: 130000 },
      FLOORS,
      {},
      TEST_VOCABULARY,
    );
    expect(result.axes.industry.bucket).toBe("trading");
    expect(result.axes.location.country).toBe("NL");
    expect(result.axes.fit.fit_score).toBe(4);
    expect(result.axes.comp.comp_eur).toBe(130000);
  });

  it("passes through comp_risk", () => {
    const result = computePriority(
      { company: "X", scored_city: "Amsterdam", fit_score: 3, comp_eur: null },
      FLOORS,
    );
    expect(result.comp_risk).toBe("undisclosed");
  });

  it("priority_score = ind_norm + loc_norm + fit + comp_norm", () => {
    const result = computePriority(
      { company: "Acme Rowing", scored_city: "Amsterdam", fit_score: 5, comp_eur: 160000 },
      FLOORS,
      {},
      TEST_VOCABULARY,
    );
    const expected =
      result.axes.industry.norm +
      result.axes.location.norm +
      result.axes.fit.norm +
      result.axes.comp.norm;
    expect(result.priority_score).toBeCloseTo(expected, 1);
  });
});
