import { describe, expect, it } from "vitest";
import { score } from "../score.js";
import type { ScoreInput } from "../types.js";
import type { Archetype } from "../../truth/schemas/index.js";

const ARCH: Archetype = {
  id: "ctrm-enterprise-architect",
  label: "CTRM Enterprise Architect",
  related_titles: ["Enterprise Architect"],
  match_keywords: ["CTRM", "architecture"],
  search: { geos: ["Amsterdam"], seniority: ["senior"] },
};

const INPUT: ScoreInput = {
  jdText: "We need a CTRM enterprise architect in Amsterdam.",
  archetypes: [ARCH],
  ontology: { CTRM: ["commodity trading"], architecture: ["solution design"] },
  registry: [],
};

describe("score service", () => {
  it("returns a JdScoreResult", () => {
    const result = score(INPUT);
    expect(result).toBeDefined();
    expect(typeof result.fit_score).toBe("number");
    expect(["A", "B", "C", "D", "F"]).toContain(result.grade);
  });

  it("returns non-null archetype for matching input", () => {
    const result = score(INPUT);
    expect(result.archetype).toBe("ctrm-enterprise-architect");
  });

  it("returns null archetype when no archetypes provided", () => {
    const result = score({ ...INPUT, archetypes: [] });
    expect(result.archetype).toBeNull();
  });

  it("result has all required dimension fields", () => {
    const result = score(INPUT);
    expect(result.dimensions.domain_match).toBeDefined();
    expect(result.dimensions.evidence_coverage).toBeDefined();
    expect(result.dimensions.keyword_density).toBeDefined();
  });
});
