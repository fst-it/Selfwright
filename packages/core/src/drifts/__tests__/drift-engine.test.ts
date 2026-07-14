import { describe, expect, it } from "vitest";
import type { DriftEntry } from "../../truth/schemas/index.js";
import { bandFor, blendScore, companyToken, computeDrift, slugifyCompany, validateDrift } from "../drift-engine.js";

// ── Fixture drift entry ───────────────────────────────────────────────────────

const BASE_ENTRY: DriftEntry = {
  id: "DRIFT-GLOBEX-ARCH",
  org: "Globex",
  claim: "Led end-to-end CTRM transformation as de-facto enterprise architect",
  deviates_from: {
    evidence_ids: ["EVD-GLOBEX-LEAD"],
    kind: "reframe",
  },
  tag: "soft",
  keywords: ["architecture", "CTRM"],
  defense: "The role covered architecture decisions even without the formal title",
  confidence: {
    score: 8.1,
    band: "safe",
    rubric_version: "v1",
    factors: {
      verifiability_backstop: 0.9,
      distance_from_truth: 0.8,
      blast_radius: 0.85,
      external_checkability: 0.8,
      cross_app_consistency: 0.9,
      specificity_detectability: 0.85,
    },
    rubric_score: 8.5,
    ai_adjustment: -0.4,
    ai_reasoning: "The title drift is moderate but well-backstopped by EVD-GLOBEX-LEAD",
  },
  risks: [
    {
      risk: "Hiring manager may ask for formal title",
      severity: "low",
      mitigation: "Reference the specific projects led",
    },
  ],
  status: "active",
  applications: ["2026-globex-enterprise-architect"],
};

// ── slugifyCompany ────────────────────────────────────────────────────────────

describe("slugifyCompany", () => {
  it("lowercases and replaces non-alphanumeric with hyphens", () => {
    expect(slugifyCompany("Zorblatt & Company")).toBe("zorblatt-company");
    expect(slugifyCompany("Blorptech.io")).toBe("blorptech-io");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugifyCompany("  Globex  ")).toBe("globex");
  });

  it("handles empty string", () => {
    expect(slugifyCompany("")).toBe("");
  });

  it("converts ampersand to space then normalises", () => {
    expect(slugifyCompany("Procter & Gamble")).toBe("procter-gamble");
  });
});

// ── companyToken ─────────────────────────────────────────────────────────────

describe("companyToken", () => {
  it("uppercases the slug", () => {
    expect(companyToken("globex")).toBe("GLOBEX");
    expect(companyToken("zorblatt-company")).toBe("ZORBLATT-COMPANY");
  });
});

// ── blendScore ────────────────────────────────────────────────────────────────

describe("blendScore", () => {
  it("adds ai_adjustment clamped to ±1.0", () => {
    expect(blendScore(8.0, 0.5)).toBe(8.5);
    expect(blendScore(8.0, -0.5)).toBe(7.5);
  });

  it("clamps ai_adjustment to ±1.0", () => {
    expect(blendScore(5.0, 2.0)).toBe(6.0); // 5 + clamp(2, -1, 1)=1 = 6
    expect(blendScore(5.0, -2.0)).toBe(4.0);
  });

  it("clamps result to 0..10", () => {
    expect(blendScore(9.5, 1.0)).toBe(10.0);
    expect(blendScore(0.3, -1.0)).toBe(0.0);
  });

  it("rounds to 1 decimal", () => {
    expect(blendScore(7.83, 0.5)).toBe(8.3);
  });
});

// ── bandFor ───────────────────────────────────────────────────────────────────

describe("bandFor", () => {
  it("returns safe for score ≥ 8.0", () => {
    expect(bandFor(8.0)).toBe("safe");
    expect(bandFor(10.0)).toBe("safe");
  });

  it("returns caution for 5.0 ≤ score < 8.0", () => {
    expect(bandFor(5.0)).toBe("caution");
    expect(bandFor(7.9)).toBe("caution");
  });

  it("returns high-risk for score < 5.0", () => {
    expect(bandFor(4.9)).toBe("high-risk");
    expect(bandFor(0.0)).toBe("high-risk");
  });
});

// ── computeDrift ─────────────────────────────────────────────────────────────

describe("computeDrift", () => {
  it("returns rubric_score, score, and band", () => {
    const result = computeDrift(BASE_ENTRY);
    expect(result.rubric_score).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(10);
    expect(["safe", "caution", "high-risk"]).toContain(result.band);
  });

  it("score = rubric_score + ai_adjustment (clamped)", () => {
    const result = computeDrift(BASE_ENTRY);
    // rubric_score + ai_adjustment = result.rubric_score + (-0.4)
    const expected = blendScore(result.rubric_score, BASE_ENTRY.confidence.ai_adjustment);
    expect(result.score).toBeCloseTo(expected, 1);
  });

  it("band reflects the blended score", () => {
    const result = computeDrift(BASE_ENTRY);
    expect(result.band).toBe(bandFor(result.score));
  });

  it("a high-confidence entry lands in safe band", () => {
    const highConf: DriftEntry = {
      ...BASE_ENTRY,
      confidence: {
        ...BASE_ENTRY.confidence,
        factors: {
          verifiability_backstop: 1.0,
          distance_from_truth: 1.0,
          blast_radius: 1.0,
          external_checkability: 1.0,
          cross_app_consistency: 1.0,
          specificity_detectability: 1.0,
        },
        ai_adjustment: 0,
        rubric_score: 10,
        score: 10,
        band: "safe",
      },
    };
    const result = computeDrift(highConf);
    expect(result.band).toBe("safe");
  });
});

// ── validateDrift ─────────────────────────────────────────────────────────────

describe("validateDrift", () => {
  it("returns ok=true for a valid entry with matching scores", () => {
    // Compute what the rubric_score should be and build a correct entry
    const computed = computeDrift(BASE_ENTRY);
    const correctEntry: DriftEntry = {
      ...BASE_ENTRY,
      confidence: {
        ...BASE_ENTRY.confidence,
        rubric_score: computed.rubric_score,
        score: computed.score,
      },
    };
    const result = validateDrift(correctEntry);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns error when rubric_score is wrong", () => {
    const wrong: DriftEntry = {
      ...BASE_ENTRY,
      confidence: { ...BASE_ENTRY.confidence, rubric_score: 99 },
    };
    const result = validateDrift(wrong);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("rubric_score"))).toBe(true);
  });

  it("returns error when score is wrong", () => {
    const computed = computeDrift(BASE_ENTRY);
    const wrong: DriftEntry = {
      ...BASE_ENTRY,
      confidence: { ...BASE_ENTRY.confidence, rubric_score: computed.rubric_score, score: 99 },
    };
    const result = validateDrift(wrong);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("score"))).toBe(true);
  });

  it("returns error when promoted entry has no promoted_to", () => {
    const computed = computeDrift(BASE_ENTRY);
    const promoted: DriftEntry = {
      ...BASE_ENTRY,
      status: "promoted",
      promoted_to: null,
      confidence: { ...BASE_ENTRY.confidence, rubric_score: computed.rubric_score, score: computed.score },
    };
    const result = validateDrift(promoted);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("promoted"))).toBe(true);
  });

  it("returns error when retired entry has no retired_reason", () => {
    const computed = computeDrift(BASE_ENTRY);
    const retired: DriftEntry = {
      ...BASE_ENTRY,
      status: "retired",
      retired_reason: null,
      confidence: { ...BASE_ENTRY.confidence, rubric_score: computed.rubric_score, score: computed.score },
    };
    const result = validateDrift(retired);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("retired"))).toBe(true);
  });

  it("validates ID prefix against slug when slug provided", () => {
    const computed = computeDrift(BASE_ENTRY);
    const correct: DriftEntry = {
      ...BASE_ENTRY,
      confidence: { ...BASE_ENTRY.confidence, rubric_score: computed.rubric_score, score: computed.score },
    };
    const okResult = validateDrift(correct, { slug: "globex" });
    expect(okResult.ok).toBe(true);

    const wrongSlug = validateDrift(correct, { slug: "booking" });
    expect(wrongSlug.ok).toBe(false);
    expect(wrongSlug.errors.some((e) => e.includes("DRIFT-BOOKING-"))).toBe(true);
  });
});
