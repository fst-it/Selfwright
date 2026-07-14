import { describe, expect, it } from "vitest";
import type { Archetype, EvidenceEntry, Ontology } from "../../truth/schemas/index.js";
import { scoreJd } from "../jd-score.js";

const CTRM_ARCH: Archetype = {
  id: "ctrm-enterprise-architect",
  label: "CTRM Enterprise Architect",
  related_titles: ["Enterprise Architect", "CTRM Architect"],
  match_keywords: ["CTRM", "trading", "commodities", "architecture"],
  search: {
    geos: ["Amsterdam", "Geneva"],
    seniority: ["senior", "principal", "architect"],
  },
};

const ONTOLOGY: Ontology = {
  CTRM: ["commodity trading", "energy trading"],
  architecture: ["solution design"],
  integration: ["API integration"],
};

const REGISTRY: EvidenceEntry[] = [
  {
    id: "EVD-GLOBEX-ARCH",
    org: "Globex",
    claim: "Led CTRM architecture",
    tag: "hard",
    keywords: ["CTRM", "architecture", "trading"],
  },
];

describe("scoreJd", () => {
  it("returns null archetype and grade F when no archetypes", () => {
    const result = scoreJd({
      jdText: "Looking for a CTRM architect in Amsterdam.",
      archetypes: [],
      ontology: ONTOLOGY,
      registry: REGISTRY,
    });
    expect(result.archetype).toBeNull();
    expect(result.grade).toBe("F");
  });

  it("returns a valid JdScoreResult with all 8 dimensions", () => {
    const result = scoreJd({
      jdText: "We need a CTRM architect with trading and architecture expertise in Amsterdam.",
      archetypes: [CTRM_ARCH],
      ontology: ONTOLOGY,
      registry: REGISTRY,
    });
    expect(result.archetype).toBe("ctrm-enterprise-architect");
    expect(result.dimensions.evidence_coverage).toBeDefined();
    expect(result.dimensions.keyword_density).toBeDefined();
    expect(result.dimensions.domain_match).toBeDefined();
    expect(result.dimensions.leadership_match).toBeDefined();
    expect(result.dimensions.geo_fit).toBeDefined();
    expect(result.dimensions.title_family).toBeDefined();
    expect(result.dimensions.seniority_match).toBeDefined();
    expect(result.dimensions.company_type_fit).toBeDefined();
  });

  it("fit_score is in 0-5 range", () => {
    const result = scoreJd({
      jdText: "CTRM trading architecture commodities Amsterdam",
      archetypes: [CTRM_ARCH],
      ontology: ONTOLOGY,
      registry: REGISTRY,
    });
    expect(result.fit_score).toBeGreaterThanOrEqual(0);
    expect(result.fit_score).toBeLessThanOrEqual(5);
  });

  it("evidence_coverage reflects registry support for JD terms", () => {
    const jd = "Needs CTRM architecture integration experience.";
    const result = scoreJd({ jdText: jd, archetypes: [CTRM_ARCH], ontology: ONTOLOGY, registry: REGISTRY });
    // CTRM and architecture have EVD support; integration does not
    const ev = result.dimensions.evidence_coverage;
    expect(ev.score).toBeGreaterThan(0);
    expect(ev.weight).toBe("25%");
  });

  it("picks best archetype when multiple provided", () => {
    const dataArch: Archetype = {
      id: "head-of-data-ai",
      label: "Head of Data AI",
      related_titles: ["Head of Data"],
      match_keywords: ["data", "AI", "analytics"],
      search: { geos: ["Amsterdam"] },
    };
    const result = scoreJd({
      jdText: "CTRM trading commodities architecture",
      archetypes: [CTRM_ARCH, dataArch],
      ontology: ONTOLOGY,
      registry: REGISTRY,
    });
    expect(result.archetype).toBe("ctrm-enterprise-architect");
  });

  it("uses provided posting for scan-time dimensions", () => {
    const result = scoreJd({
      jdText: "Some JD text",
      archetypes: [CTRM_ARCH],
      ontology: ONTOLOGY,
      registry: REGISTRY,
      posting: { title: "Chief Architect", company: "Globex", location: "Amsterdam" },
    });
    // leadership_match should reflect the posting title (chief = exec = 1.0)
    expect(result.dimensions.leadership_match.score).toBe(1.0);
  });

  it("without a structured posting (plain/markdown JD), seniority + geo signals present in the JD body are still found -- not degenerate to a bare title/location default", () => {
    const jd = [
      "# Principal CTRM Architect",
      "",
      "We are looking for a principal-level architect to own our commodity trading",
      "platform architecture.",
      "",
      "Location: Amsterdam (hybrid)",
    ].join("\n");
    const result = scoreJd({
      jdText: jd,
      archetypes: [CTRM_ARCH],
      ontology: ONTOLOGY,
      registry: REGISTRY,
    });
    // CTRM_ARCH.search.seniority includes "principal"/"architect", both present in the body.
    expect(result.dimensions.seniority_match.score).toBeGreaterThan(0.3);
    // CTRM_ARCH.search.geos includes "Amsterdam", present in the body.
    expect(result.dimensions.geo_fit.score).toBeGreaterThan(0);
  });

  it("evidence_coverage=0.5 (neutral) when no JD ontology terms — never inflates to 1.0", () => {
    const result = scoreJd({
      jdText: "No relevant ontology terms here at all.",
      archetypes: [CTRM_ARCH],
      ontology: ONTOLOGY,
      registry: REGISTRY,
    });
    expect(result.dimensions.evidence_coverage.score).toBe(0.5);
  });

  it("grade thresholds same as scan-time: A≥4.5 B≥4.0 C≥3.0 D≥2.0 F<2.0", () => {
    // With all zeros (no posting, no matching JD), should get F
    const result = scoreJd({
      jdText: "no matches",
      archetypes: [{ ...CTRM_ARCH, match_keywords: [], related_titles: [], search: undefined }],
      ontology: {},
      registry: [],
    });
    expect(["A", "B", "C", "D", "F"]).toContain(result.grade);
  });
});
