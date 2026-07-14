import { describe, expect, it } from "vitest";
import { buildGapScanReport } from "../gap-scan.js";
import type { CandidateGap } from "../../coaching/index.js";

function gap(opts: Partial<CandidateGap> & Pick<CandidateGap, "topic" | "coverage">): CandidateGap {
  return {
    evidenceIds: [],
    bestScore: 0,
    ...opts,
  };
}

describe("buildGapScanReport", () => {
  it("renders the report header and all three section headings with counts", () => {
    const report = buildGapScanReport([]);
    const lines = report.split("\n");
    expect(lines[0]).toBe("# Skill Gap Coverage Report");
    expect(report).toContain("## Uncovered (0)");
    expect(report).toContain("## Partial coverage (0)");
    expect(report).toContain("## Covered (0)");
  });

  it("renders '(none)' for every section when there are no candidates", () => {
    const report = buildGapScanReport([]);
    expect(report.match(/\(none\)/g)).toHaveLength(3);
  });

  it("counts and groups candidates into the correct section by coverage tier", () => {
    const candidates: CandidateGap[] = [
      gap({ topic: "treasury settlement", coverage: "uncovered" }),
      gap({ topic: "credit risk", coverage: "partial" }),
      gap({ topic: "ctrm platform", coverage: "covered" }),
    ];
    const report = buildGapScanReport(candidates);
    expect(report).toContain("## Uncovered (1)");
    expect(report).toContain("## Partial coverage (1)");
    expect(report).toContain("## Covered (1)");
  });

  describe("uncovered section", () => {
    it("shows 'existing: <id>' when existingGapId is set", () => {
      const report = buildGapScanReport([
        gap({ topic: "treasury settlement", coverage: "uncovered", existingGapId: "GAP-001" }),
      ]);
      expect(report).toContain("- treasury settlement (existing: GAP-001)");
    });

    it("shows 'suggested id: <id>' when only suggestedGapId is set", () => {
      const report = buildGapScanReport([
        gap({ topic: "treasury settlement", coverage: "uncovered", suggestedGapId: "GAP-TREASURY-SETTLEMENT" }),
      ]);
      expect(report).toContain("- treasury settlement (suggested id: GAP-TREASURY-SETTLEMENT)");
    });

    it("prefers existingGapId over suggestedGapId when both are set", () => {
      const report = buildGapScanReport([
        gap({
          topic: "treasury settlement",
          coverage: "uncovered",
          existingGapId: "GAP-001",
          suggestedGapId: "GAP-TREASURY-SETTLEMENT",
        }),
      ]);
      expect(report).toContain("- treasury settlement (existing: GAP-001)");
      expect(report).not.toContain("suggested id");
    });

    it("shows the bare topic with no parenthetical when neither id is set", () => {
      const report = buildGapScanReport([gap({ topic: "treasury settlement", coverage: "uncovered" })]);
      expect(report).toContain("- treasury settlement\n");
      expect(report).not.toContain("treasury settlement (");
    });
  });

  describe("partial coverage section", () => {
    it("shows evidence ids and '(existing: <id>)' when both are present", () => {
      const report = buildGapScanReport([
        gap({
          topic: "credit risk",
          coverage: "partial",
          evidenceIds: ["EVD-001", "EVD-002"],
          existingGapId: "GAP-002",
        }),
      ]);
      expect(report).toContain("- credit risk [EVD-001, EVD-002] (existing: GAP-002)");
    });

    it("shows '(suggested: <id>)' when only suggestedGapId is set", () => {
      const report = buildGapScanReport([
        gap({ topic: "credit risk", coverage: "partial", suggestedGapId: "GAP-CREDIT-RISK" }),
      ]);
      expect(report).toContain("- credit risk (suggested: GAP-CREDIT-RISK)");
    });

    it("prefers existingGapId over suggestedGapId when both are set", () => {
      const report = buildGapScanReport([
        gap({
          topic: "credit risk",
          coverage: "partial",
          existingGapId: "GAP-002",
          suggestedGapId: "GAP-CREDIT-RISK",
        }),
      ]);
      expect(report).toContain("- credit risk (existing: GAP-002)");
      expect(report).not.toContain("suggested:");
    });

    it("omits both the evidence-id bracket and the gap parenthetical when neither is present", () => {
      const report = buildGapScanReport([gap({ topic: "credit risk", coverage: "partial" })]);
      expect(report).toContain("- credit risk\n");
    });
  });

  describe("covered section", () => {
    it("shows the evidence-id bracket when evidenceIds is non-empty", () => {
      const report = buildGapScanReport([
        gap({ topic: "ctrm platform", coverage: "covered", evidenceIds: ["EVD-001"] }),
      ]);
      expect(report).toContain("- ctrm platform [EVD-001]");
    });

    it("shows the bare topic when evidenceIds is empty", () => {
      // Covered is the last section (no trailing blank line after its last
      // bullet), so assert on the report's final line rather than assuming
      // a trailing "\n" that only exists for non-terminal sections.
      const report = buildGapScanReport([gap({ topic: "ctrm platform", coverage: "covered" })]);
      const lines = report.split("\n");
      expect(lines[lines.length - 1]).toBe("- ctrm platform");
    });

    it("never shows a gap-id parenthetical, even if existingGapId/suggestedGapId happen to be set", () => {
      // computeCoverageGapsForKeywords never actually sets these for a
      // "covered" row, but buildGapScanReport must not render them even if
      // present, since a covered topic has no gap to rehearse.
      const report = buildGapScanReport([
        gap({ topic: "ctrm platform", coverage: "covered", existingGapId: "GAP-003", suggestedGapId: "GAP-X" }),
      ]);
      expect(report).not.toContain("existing:");
      expect(report).not.toContain("suggested:");
    });
  });
});
