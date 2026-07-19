// FF-ATS: ATS pass-through score on golden tailored CV fixtures.
// Tier 1 (no SELFWRIGHT_DATA_DIR required) — synthetic fixtures only.
//
// Jordan Doe / FictionalCo are entirely invented. No real person or
// company. The named-entity and machine-identity gates are laws; this check
// must never depend on private data.
//
// The check runs the real computeAts scorer against a well-tailored synthetic
// CV + a matching JD and asserts overall ≥ 0.80 (the default threshold). A
// failure means either:
//   (a) Pass A degraded — the CV structure checks now reject a well-formed CV, or
//   (b) Pass B degraded — keyword coverage logic no longer matches the CV to the JD.
// Both are regressions that should fail CI.
import { computeAts } from "@selfwright/core";
import type { CvContent, EvidenceEntry, Ontology } from "@selfwright/core";
import type { CheckResult } from "./shared.js";

const CHECK_NAME = "FF-ATS: ATS pass-through score on golden tailored CV fixture (≥0.80)";

const ATS_PASS_THRESHOLD = 0.80;

// ── Synthetic golden JD ───────────────────────────────────────────────────────
//
// Deliberately matches the skills in the CV below so that both Pass A
// (structure) and Pass B (keyword coverage) score 1.0. The JD uses ontology
// terms verbatim to ensure `findJdTerms` finds all four.
const GOLDEN_JD =
  "We are seeking a Senior Software Engineer with expertise in cloud architecture " +
  "and data engineering. Must have hands-on experience with Python and Kubernetes.";

// ── Synthetic ontology ────────────────────────────────────────────────────────
//
// Four canonical terms, each with one synonym. The four terms are present in
// both the JD and the CV so Pass B coverage = 4/4 = 1.0.
const GOLDEN_ONTOLOGY: Ontology = {
  "cloud architecture": ["cloud platform", "cloud design"],
  "data engineering": ["data pipelines", "data platform"],
  python: ["py"],
  kubernetes: ["k8s"],
};

// ── Synthetic golden CV (Jordan Doe / FictionalCo) ───────────────────────────
//
// All required Pass A sections are populated; date formats match the expected
// pattern; no markdown tables; all contact fields present; bullets are short.
const GOLDEN_CV: CvContent = {
  name: "Jordan Doe",
  headline: "Senior Software Engineer",
  summary: "Experienced in cloud architecture and data engineering for distributed systems.",
  citizenship: "EU",
  skills: [
    "Cloud Architecture",
    "Data Engineering",
    "Python",
    "Kubernetes",
    "Distributed Systems",
  ],
  roles: [
    {
      company: "FictionalCo",
      title: "Senior Software Engineer",
      period: "Jan 2019 – Present",
      location: "Amsterdam, Netherlands",
      lead: "Technical lead for cloud platform team.",
      bullets: [
        "Designed cloud architecture for the FictionalCo distributed services platform.",
        "Built data engineering pipelines using Python and Kubernetes on AWS.",
        "Reduced deployment time by 40% through infrastructure-as-code adoption.",
      ],
    },
  ],
  earlier_career: [
    { org: "StartupXYZ Ltd", rest: "Software Engineer 2015–2018, Amsterdam" },
  ],
  education: ["BSc Computer Science, University of Amsterdam (2015)"],
  certifications: ["AWS Certified Solutions Architect – Associate"],
  languages: "English (fluent), Dutch (professional)",
  contact: {
    location: "Amsterdam, Netherlands",
    // Use non-PII placeholder values — real PII must never appear in framework files.
    // Same convention as generated-artifact-trace.ts (no + prefix, no TLD domain).
    phone: "555-0100",
    email: "jordandoe@localhost",
    linkedin: "https://linkedin.com/in/jordandoe",
  },
};

// No evidence registry needed: Pass B defaulting to 1.0 when coverage is
// perfect does not require evidence entries. Registry is empty intentionally
// (the check is about structure + keyword coverage, not truth-trace).
// Exported for use in ff-ats.test.ts negative-control tests only.
export const EMPTY_REGISTRY: EvidenceEntry[] = [];

// Exported for use in ff-ats.test.ts negative-control tests only.
export { GOLDEN_JD, GOLDEN_CV, GOLDEN_ONTOLOGY };

export function checkFfAts(): CheckResult {
  const result = computeAts(GOLDEN_JD, GOLDEN_CV, GOLDEN_ONTOLOGY, EMPTY_REGISTRY);

  // MAJOR 1: Fail if Pass B fell back to the escape hatch (empty JD terms detected).
  // This would hide a regression in findJdTerms/normalise/buildSynonymIndex — the
  // golden JD must always produce detected ontology terms. `note` is only ever set
  // by the escape-hatch branch (jdTermsCount === 0), so its presence alone is the signal.
  if (result.passB.note !== undefined) {
    return {
      name: CHECK_NAME,
      passed: false,
      details:
        `Pass B hit the no-ontology-terms escape hatch — no ontology terms were detected ` +
        `in the golden JD. This is a regression in findJdTerms/normalise/buildSynonymIndex: ` +
        `the golden fixture JD must always yield detected terms. Pass B note: ${result.passB.note}`,
    };
  }

  // MAJOR 2: The golden fixture is constructed to score perfectly; anything less than
  // 1.0 on either pass indicates a scorer regression, even if the headline ≥0.80 holds.
  if (result.passA.score < 1.0) {
    return {
      name: CHECK_NAME,
      passed: false,
      details:
        `Pass A score ${result.passA.score.toFixed(3)} < 1.0 on golden fixture — CV structure ` +
        `regression. Failing checks: ${result.passA.checks.filter((c) => !c.pass).map((c) => c.name).join("; ") || "none"}`,
    };
  }

  if (result.passB.score < 1.0) {
    return {
      name: CHECK_NAME,
      passed: false,
      details:
        `Pass B score ${result.passB.score.toFixed(3)} < 1.0 on golden fixture — keyword ` +
        `coverage regression. Missing truthful: ${result.passB.missingTruthful.map((t) => t.term).join(", ") || "none"}; ` +
        `missing unsupported: ${result.passB.missingUnsupported.map((t) => t.term).join(", ") || "none"}`,
    };
  }

  if (result.overall < ATS_PASS_THRESHOLD) {
    return {
      name: CHECK_NAME,
      passed: false,
      details:
        `Golden tailored CV scored ${result.overall.toFixed(3)} (Pass A: ` +
        `${result.passA.score.toFixed(3)}, Pass B: ${result.passB.score.toFixed(3)}); ` +
        `expected ≥ ${ATS_PASS_THRESHOLD}`,
    };
  }

  return { name: CHECK_NAME, passed: true };
}
