// FF-FIT-1: Non-degeneracy floor for the deterministic fit scorer (Task 2 / BUG-2, D-4).
// The deterministic fit score is a ranking/pre-filter signal, not a DoD gate (ADR 0004) —
// its only guarantee is that a JD crafted to match an archetype does not degenerate to
// a null match / grade F. This is deliberately synthetic (Tier 1, no SELFWRIGHT_DATA_DIR).
import { scoreJd } from "@selfwright/core";
import type { Archetype, EvidenceEntry, Ontology } from "@selfwright/core";
import type { CheckResult } from "./shared.js";

const CHECK_NAME = "FF-FIT-1: fit scorer non-degeneracy floor (archetype match never null/F)";

const SYNTHETIC_ARCHETYPE: Archetype = {
  id: "fft1-ctrm-enterprise-architect",
  label: "Synthetic CTRM Enterprise Architect",
  related_titles: ["Enterprise Architect", "CTRM Architect"],
  match_keywords: ["CTRM", "trading", "commodities", "architecture"],
  search: {
    geos: ["Amsterdam", "Geneva"],
    seniority: ["senior", "principal", "architect"],
  },
};

const SYNTHETIC_ONTOLOGY: Ontology = {
  CTRM: ["commodity trading", "energy trading"],
  architecture: ["solution design"],
};

const SYNTHETIC_REGISTRY: EvidenceEntry[] = [
  {
    id: "EVD-FFT1-ARCH",
    org: "SyntheticCo",
    claim: "Led CTRM architecture",
    tag: "hard",
    keywords: ["CTRM", "architecture", "trading"],
  },
];

const SYNTHETIC_JD_TEXT =
  "We need a CTRM architect with trading and architecture expertise in Amsterdam.";

export function checkFitNonDegeneracy(): CheckResult {
  const result = scoreJd({
    jdText: SYNTHETIC_JD_TEXT,
    archetypes: [SYNTHETIC_ARCHETYPE],
    ontology: SYNTHETIC_ONTOLOGY,
    registry: SYNTHETIC_REGISTRY,
  });

  if (result.archetype === null) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `Expected a non-null archetype match for a JD crafted to match the synthetic archetype; got null (fit_score=${result.fit_score})`,
    };
  }

  if (result.grade === "F") {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `Expected grade !== "F" (non-degeneracy floor); got F (fit_score=${result.fit_score}, archetype=${result.archetype})`,
    };
  }

  return { name: CHECK_NAME, passed: true };
}
