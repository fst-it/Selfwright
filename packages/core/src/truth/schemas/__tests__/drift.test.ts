import { describe, it, expect } from "vitest";
import {
  DriftEntrySchema,
  DriftLedgerSchema,
  DriftIndexSchema,
  computeRubricScore,
  rubricScoreMatchesFactors,
} from "../drift.js";

const BASE_FACTORS = {
  verifiability_backstop: 0.85,
  distance_from_truth: 0.7,
  blast_radius: 0.8,
  external_checkability: 0.6,
  cross_app_consistency: 0.9,
  specificity_detectability: 0.7,
};

const BASE_DRIFT = {
  id: "DRIFT-ACME-TEST",
  org: "Acme Corp",
  claim: "Led a cross-asset desk latency reduction.",
  deviates_from: {
    evidence_ids: ["EVD-ACME-POSITIONPNL"],
    kind: "reframe" as const,
  },
  tag: "claim" as const,
  keywords: ["latency", "trading"],
  confidence: {
    score: 7.6,
    band: "caution" as const,
    factors: BASE_FACTORS,
    rubric_score: 7.6,
    ai_adjustment: 0.3,
    ai_reasoning: "Context supports the reframe.",
  },
  risks: [
    {
      risk: "May not align with interviewer expectations.",
      severity: "medium" as const,
      mitigation: "Clarify scope upfront.",
    },
  ],
  status: "active" as const,
  applications: ["2026-06-acme-architect"],
};

describe("DriftEntrySchema", () => {
  it("parses a valid drift entry", () => {
    const result = DriftEntrySchema.parse(BASE_DRIFT);
    expect(result.id).toBe("DRIFT-ACME-TEST");
    expect(result.status).toBe("active");
  });

  it("accepts optional fields", () => {
    const result = DriftEntrySchema.parse({
      ...BASE_DRIFT,
      detail: "Additional detail here.",
      defense: "Can demonstrate with output files.",
      honesty: "This is a reframe, not fabricated.",
      drift_family: "desk-latency-reframe",
      created: "2026-06-14",
      last_update: "2026-06-14",
      promoted_to: null,
      retired_reason: null,
      confidence: { ...BASE_DRIFT.confidence, rubric_version: "v1" },
    });
    expect(result.drift_family).toBe("desk-latency-reframe");
    expect(result.promoted_to).toBeNull();
    expect(result.retired_reason).toBeNull();
    expect(result.confidence.rubric_version).toBe("v1");
  });

  it("accepts facet-map tag on drift", () => {
    const result = DriftEntrySchema.parse({
      ...BASE_DRIFT,
      tag: { direct: "hard", functional: "soft" },
    });
    expect(result.tag).toEqual({ direct: "hard", functional: "soft" });
  });

  it("rejects invalid DRIFT-* id", () => {
    expect(() =>
      DriftEntrySchema.parse({ ...BASE_DRIFT, id: "BAD-ID" }),
    ).toThrow();
  });

  it("rejects invalid EVD-* reference in deviates_from", () => {
    expect(() =>
      DriftEntrySchema.parse({
        ...BASE_DRIFT,
        deviates_from: { ...BASE_DRIFT.deviates_from, evidence_ids: ["bad-ref"] },
      }),
    ).toThrow();
  });

  it("rejects empty evidence_ids array", () => {
    expect(() =>
      DriftEntrySchema.parse({
        ...BASE_DRIFT,
        deviates_from: { ...BASE_DRIFT.deviates_from, evidence_ids: [] },
      }),
    ).toThrow();
  });

  it("rejects confidence score outside 0-10", () => {
    expect(() =>
      DriftEntrySchema.parse({
        ...BASE_DRIFT,
        confidence: { ...BASE_DRIFT.confidence, score: 11 },
      }),
    ).toThrow();
  });

  it("rejects ai_adjustment outside ±1", () => {
    expect(() =>
      DriftEntrySchema.parse({
        ...BASE_DRIFT,
        confidence: { ...BASE_DRIFT.confidence, ai_adjustment: 1.5 },
      }),
    ).toThrow();
  });

  it("rejects risks: [] (must have at least one)", () => {
    expect(() =>
      DriftEntrySchema.parse({ ...BASE_DRIFT, risks: [] }),
    ).toThrow();
  });

  it("accepts entry without applications field — defaults to []", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { applications: _omit, ...withoutApps } = BASE_DRIFT;
    const result = DriftEntrySchema.parse(withoutApps);
    expect(result.applications).toEqual([]);
  });
});

describe("DriftLedgerSchema", () => {
  it("parses a company ledger", () => {
    const result = DriftLedgerSchema.parse({
      company: "Acme Corp",
      company_slug: "acme-corp",
      drifts: [BASE_DRIFT],
    });
    expect(result.drifts).toHaveLength(1);
  });

  it("accepts empty drifts array", () => {
    const result = DriftLedgerSchema.parse({
      company: "Acme Corp",
      company_slug: "acme-corp",
      drifts: [],
    });
    expect(result.drifts).toEqual([]);
  });
});

describe("DriftIndexSchema", () => {
  it("parses a valid index", () => {
    const result = DriftIndexSchema.parse({
      rubric_version: "v1",
      companies: [
        {
          slug: "acme-corp",
          name: "Acme Corp",
          file: "companies/acme-corp.yml",
          drift_count: 1,
          active: 1,
          min_confidence: 7.6,
        },
      ],
    });
    expect(result.companies).toHaveLength(1);
  });
});

describe("computeRubricScore()", () => {
  it("computes a weighted sum within 0-10", () => {
    const score = computeRubricScore(BASE_FACTORS);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(10);
  });

  it("returns 0.0 for all-zero factors", () => {
    const factors = {
      verifiability_backstop: 0,
      distance_from_truth: 0,
      blast_radius: 0,
      external_checkability: 0,
      cross_app_consistency: 0,
      specificity_detectability: 0,
    };
    expect(computeRubricScore(factors)).toBe(0);
  });

  it("returns 10.0 for all-one factors", () => {
    const factors = {
      verifiability_backstop: 1,
      distance_from_truth: 1,
      blast_radius: 1,
      external_checkability: 1,
      cross_app_consistency: 1,
      specificity_detectability: 1,
    };
    expect(computeRubricScore(factors)).toBe(10);
  });
});

describe("rubricScoreMatchesFactors()", () => {
  it("returns true when rubric_score matches computed value (within 0.05)", () => {
    const computed = computeRubricScore(BASE_FACTORS);
    const entry = DriftEntrySchema.parse({
      ...BASE_DRIFT,
      confidence: { ...BASE_DRIFT.confidence, rubric_score: computed },
    });
    expect(rubricScoreMatchesFactors(entry)).toBe(true);
  });

  it("returns false when rubric_score diverges by more than 0.05", () => {
    const entry = DriftEntrySchema.parse({
      ...BASE_DRIFT,
      confidence: { ...BASE_DRIFT.confidence, rubric_score: 0.5 },
    });
    expect(rubricScoreMatchesFactors(entry)).toBe(false);
  });
});
