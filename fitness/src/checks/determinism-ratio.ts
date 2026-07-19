// FF-DET-1: determinism ratio (Phase 2). Synthetic fixtures (Tier 1) — run the
// deterministic pipeline (scoreJd + computeAts) twice with identical inputs and
// assert byte-identical JSON output. Catches any accidental introduction of
// Math.random(), Date.now(), or other non-deterministic operations into the core.
import { scoreJd, computeAts, CvContentSchema } from "@selfwright/core";
import type { Archetype, CvContent, EvidenceEntry, Ontology } from "@selfwright/core";
import type { CheckResult } from "./shared.js";

const CHECK_NAME = "FF-DET-1: deterministic pipeline produces byte-identical output on repeated runs";

// Reuse a synthetic archetype + JD representative of real usage.
const ARCHETYPE: Archetype = {
  id: "ffdet1-enterprise-architect",
  label: "Enterprise Architect (synthetic)",
  related_titles: ["Enterprise Architect", "Solution Architect"],
  match_keywords: ["architecture", "enterprise", "cloud", "microservices"],
  search: {
    geos: ["Amsterdam"],
    seniority: ["senior", "principal", "architect"],
  },
};

const ONTOLOGY: Ontology = {
  architecture: ["solution design", "system design"],
  cloud: ["aws", "azure", "gcp"],
};

const REGISTRY: EvidenceEntry[] = [
  {
    id: "EVD-FFDET1-ARCH",
    org: "SyntheticCorp",
    claim: "Designed enterprise architecture for cloud migration",
    tag: "hard",
    keywords: ["architecture", "enterprise", "cloud"],
  },
  {
    id: "EVD-FFDET1-MICRO",
    org: "SyntheticCorp",
    claim: "Led microservices platform rebuild",
    tag: "hard",
    keywords: ["microservices", "architecture", "platform"],
  },
];

const JD_TEXT =
  "We are looking for a Senior Enterprise Architect with cloud and microservices expertise " +
  "to lead solution design at scale in Amsterdam. You will drive architecture decisions across " +
  "our platform and partner with engineering teams.";

const CV_CONTENT: CvContent = CvContentSchema.parse({
  summary: "Enterprise architect with cloud and microservices expertise.",
  skills: ["architecture", "cloud", "microservices", "enterprise"],
  roles: [
    {
      title: "Principal Architect",
      company: "SyntheticCorp",
      period: "2020–present",
      location: "Amsterdam, NL",
      bullets: ["Designed cloud migration architecture"],
    },
  ],
});

export function checkDeterminismRatio(): CheckResult {
  const inputs = {
    jdText: JD_TEXT,
    archetypes: [ARCHETYPE],
    ontology: ONTOLOGY,
    registry: REGISTRY,
  };

  // Run scoreJd twice and compare serialised output.
  const score1 = JSON.stringify(scoreJd(inputs));
  const score2 = JSON.stringify(scoreJd(inputs));
  if (score1 !== score2) {
    return {
      name: CHECK_NAME,
      passed: false,
      details:
        "scoreJd produced different output on two identical calls — non-determinism detected.\n" +
        `Run 1: ${score1.slice(0, 200)}\nRun 2: ${score2.slice(0, 200)}`,
    };
  }

  // Run computeAts twice and compare serialised output.
  const ats1 = JSON.stringify(computeAts(JD_TEXT, CV_CONTENT, ONTOLOGY, REGISTRY));
  const ats2 = JSON.stringify(computeAts(JD_TEXT, CV_CONTENT, ONTOLOGY, REGISTRY));
  if (ats1 !== ats2) {
    return {
      name: CHECK_NAME,
      passed: false,
      details:
        "computeAts produced different output on two identical calls — non-determinism detected.\n" +
        `Run 1: ${ats1.slice(0, 200)}\nRun 2: ${ats2.slice(0, 200)}`,
    };
  }

  return { name: CHECK_NAME, passed: true };
}
