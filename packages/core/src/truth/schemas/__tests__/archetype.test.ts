import { describe, it, expect } from "vitest";
import { ArchetypeSchema } from "../archetype.js";

const BASE_ARCHETYPE = {
  id: "ctrm-enterprise-architect",
  label: "CTRM Enterprise Architect",
  related_titles: [
    "Commodity Trading Technology Architect",
    "ETRM Platform Architect",
  ],
  match_keywords: ["CTRM", "ETRM", "commodity trading", "position management"],
  search: {
    geos: ["Netherlands", "UK", "Switzerland"],
    seniority: ["senior", "staff", "principal"],
    comp_floor_eur: 170000,
  },
  cv_slant: {
    foreground_evidence: ["EVD-ACME-ARCHPLATFORM", "EVD-ACME-CTRM"],
    suppress_evidence: [],
    summary_emphasis: "CTRM platform ownership and cross-asset architecture.",
    variant: "architect",
  },
  honesty_notes:
    "Candidate has not owned a full CTRM product end-to-end; frames it as domain expertise + platform governance.",
};

describe("ArchetypeSchema", () => {
  it("parses a full archetype", () => {
    const result = ArchetypeSchema.parse(BASE_ARCHETYPE);
    expect(result.id).toBe("ctrm-enterprise-architect");
    expect(result.related_titles).toHaveLength(2);
  });

  it("parses a minimal archetype (only required fields)", () => {
    const result = ArchetypeSchema.parse({
      id: "generic",
      related_titles: [],
      match_keywords: [],
    });
    expect(result.id).toBe("generic");
    expect(result.search).toBeUndefined();
  });

  it("accepts optional value_proposition", () => {
    const result = ArchetypeSchema.parse({
      ...BASE_ARCHETYPE,
      value_proposition: "Proven pattern in trading tech transformations.",
    });
    expect(result.value_proposition).toBe(
      "Proven pattern in trading tech transformations.",
    );
  });

  it("rejects empty id", () => {
    expect(() => ArchetypeSchema.parse({ ...BASE_ARCHETYPE, id: "" })).toThrow();
  });

  it("accepts missing optional search.comp_floor_eur", () => {
    const result = ArchetypeSchema.parse({
      ...BASE_ARCHETYPE,
      search: { geos: ["Netherlands"], seniority: ["senior"] },
    });
    expect(result.search?.comp_floor_eur).toBeUndefined();
  });
});
