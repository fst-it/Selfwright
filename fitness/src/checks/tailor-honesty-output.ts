// FF-TAILOR-3: Integration test for truth post-validation in the tailor service (Fix C-4).
// Asserts that when the tailored CV summary contains a retired phrase, truth_warnings is populated.
import { tailorService } from "@selfwright/core";
import type { EvidenceEntry, Identity, DriftEntry } from "@selfwright/core";
import type { EvidenceMap } from "@selfwright/core";
import type { CvContent } from "@selfwright/core";
import type { CheckResult } from "./shared.js";

const CHECK_NAME = "FF-TAILOR-3: tailor post-validation populates truth_warnings for retired phrases";

const SYNTHETIC_REGISTRY: EvidenceEntry[] = [
  {
    id: "EVD-SYN-FFT3-001",
    org: "SyntheticCo",
    claim: "Delivered innovative synergies across trading platform teams and integration layers",
    tag: "soft",
    keywords: ["innovative", "synergies", "trading", "platform", "integration"],
  },
];

const SYNTHETIC_RETIRED_DRIFT: DriftEntry = {
  id: "DRIFT-SYN-FFT3-001",
  org: "SyntheticCo",
  claim: "Synthetic retired drift for honesty post-check test",
  deviates_from: { evidence_ids: ["EVD-SYN-FFT3-001"], kind: "embellishment" },
  tag: "soft",
  status: "retired",
  retired_reason: "jargon that signals consulting-speak; avoid",
  keywords: ["innovative synergies"],
  confidence: {
    score: 5.0,
    band: "caution",
    factors: { verifiability_backstop: 0.5, distance_from_truth: 0.5, blast_radius: 0.5, external_checkability: 0.5, cross_app_consistency: 0.5, specificity_detectability: 0.5 },
    rubric_score: 5.0,
    ai_adjustment: 0,
    ai_reasoning: "Synthetic test fixture",
  },
  risks: [{ risk: "test", severity: "low", mitigation: "N/A" }],
  applications: [],
};

const SYNTHETIC_IDENTITY: Identity = {
  name: "Test User",
  canonical_title: "Platform Architect",
  years_experience: 8,
  headline: "Platform Architect",
  seniority_equivalence: "Senior",
  headline_policy: "None",
  also_known_as_titles: [],
  cv_generation_rules: [],
  education: [],
  contact: { location: "Amsterdam", phone: "555-0100", email: "user@localhost", linkedin: "https://linkedin.com/in/test" },
  citizenship: "EU",
  relocation: [],
  languages: {},
  certifications: [],
  team_sizes: {},
  roles_timeline: [
    { company: "SyntheticCo", title: "Platform Architect", period: "2020–present" },
  ],
  honesty_boundaries: [],
  calibration: "None",
};

const EVIDENCE_MAP: EvidenceMap = { roles: {} };

export function checkTailorHonestyOutput(): CheckResult {
  // (a) CV with retired phrase in summary must produce truth_warnings (advisory, not hard error)
  const cvWithRetiredPhrase: CvContent = {
    name: "Test User",
    headline: "Platform Architect",
    summary: "Drove innovative synergies across trading platform teams at SyntheticCo.",
    skills: ["Architecture"],
    roles: [
      {
        company: "SyntheticCo",
        title: "Platform Architect",
        period: "2020–present",
        location: "Amsterdam",
        bullets: ["Led trading platform integration"],
      },
    ],
  };

  const warningResult = tailorService(
    cvWithRetiredPhrase,
    {},
    EVIDENCE_MAP,
    undefined,
    {
      registry: SYNTHETIC_REGISTRY,
      identity: SYNTHETIC_IDENTITY,
      drifts: [SYNTHETIC_RETIRED_DRIFT],
    },
  );

  if (!warningResult.ok) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `tailor returned error for CV with retired phrase (expected ok+warnings): ${warningResult.error.message}`,
    };
  }

  const warnings = warningResult.value._tailor_meta.truth_warnings;
  if (!warnings || warnings.length === 0) {
    return {
      name: CHECK_NAME,
      passed: false,
      details:
        "CV summary containing retired drift phrase 'innovative synergies' produced no truth_warnings — post-validation is not active",
    };
  }

  // (b) Clean CV summary must produce no truth_warnings
  const cleanCv: CvContent = {
    ...cvWithRetiredPhrase,
    summary: "Led trading platform integration across SyntheticCo teams.",
  };

  const cleanResult = tailorService(
    cleanCv,
    {},
    EVIDENCE_MAP,
    undefined,
    {
      registry: SYNTHETIC_REGISTRY,
      identity: SYNTHETIC_IDENTITY,
      drifts: [SYNTHETIC_RETIRED_DRIFT],
    },
  );

  if (!cleanResult.ok) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `tailor returned error for clean CV: ${cleanResult.error.message}`,
    };
  }

  const cleanWarnings = cleanResult.value._tailor_meta.truth_warnings;
  if (cleanWarnings && cleanWarnings.length > 0) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `Clean CV summary produced unexpected truth_warnings: ${cleanWarnings.join(", ")}`,
    };
  }

  return { name: CHECK_NAME, passed: true };
}
