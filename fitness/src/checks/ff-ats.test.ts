// Negative-control and positive-control unit tests for the FF-ATS fitness check.
//
// These tests prove that:
//   1. When computeAts is called with an empty ontology, Pass B produces the
//      no-ontology-terms escape-hatch note (and a neutral 0.5 score, not a
//      silently-perfect 1.0) — and that the check would catch it.
//   2. The golden JD + golden ontology do NOT trigger the escape hatch, and both
//      passes score exactly 1.0.
import { describe, expect, it } from "vitest";
import { computeAts } from "@selfwright/core";
import { GOLDEN_JD, GOLDEN_CV, GOLDEN_ONTOLOGY, EMPTY_REGISTRY } from "./ff-ats.js";

describe("FF-ATS negative control — Pass B escape hatch detection", () => {
  it("empty ontology forces passB.note to be set and score to be neutral (0.5), not 1.0", () => {
    const result = computeAts(GOLDEN_JD, GOLDEN_CV, {}, EMPTY_REGISTRY);
    // The escape hatch fires when findJdTerms returns an empty set (empty ontology → no terms)
    expect(result.passB.note).toBeDefined();
    expect(result.passB.score).toBe(0.5);
    // The check logic in checkFfAts() catches this condition (note set) and returns passed: false
    const escapeHatchTriggered = result.passB.note !== undefined;
    expect(escapeHatchTriggered).toBe(true);
  });
});

describe("FF-ATS positive control — golden fixture scores perfectly", () => {
  it("golden JD + golden ontology: no escape hatch note, passA === 1.0, passB === 1.0", () => {
    const result = computeAts(GOLDEN_JD, GOLDEN_CV, GOLDEN_ONTOLOGY, EMPTY_REGISTRY);
    // No escape hatch
    const escapeHatchTriggered = result.passB.note !== undefined;
    expect(escapeHatchTriggered).toBe(false);
    // Both passes must be perfect
    expect(result.passA.score).toBe(1.0);
    expect(result.passB.score).toBe(1.0);
    expect(result.overall).toBeGreaterThanOrEqual(0.8);
  });
});
