// FF-TAILOR-1: Integration test for overlay free-text validation (Fix A-2).
// Asserts that overlay.summary with untraceable claims is rejected before the CV
// is produced — this is the first gate in the truth pipeline.
import { tailorService } from "@selfwright/core";
import type { EvidenceEntry, Identity } from "@selfwright/core";
import type { EvidenceMap } from "@selfwright/core";
import type { CvContent } from "@selfwright/core";
import type { CheckResult } from "./shared.js";

const CHECK_NAME = "FF-TAILOR-1: tailor pipeline rejects untraceable overlay.summary";

const SYNTHETIC_REGISTRY: EvidenceEntry[] = [
  {
    id: "EVD-SYN-FFT1-001",
    org: "SyntheticCo",
    claim: "Led migration of trading data platform to cloud infrastructure",
    tag: "hard",
    keywords: ["trading", "data", "platform", "cloud", "migration", "infrastructure"],
  },
];

const SYNTHETIC_IDENTITY: Identity = {
  name: "Test User",
  canonical_title: "Principal Architect",
  years_experience: 10,
  headline: "Principal Architect",
  seniority_equivalence: "Principal",
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
    { company: "SyntheticCo", title: "Principal Architect", period: "2020–present" },
  ],
  honesty_boundaries: [],
  calibration: "None",
};

const SYNTHETIC_CV: CvContent = {
  name: "Test User",
  headline: "Enterprise Architect",
  summary: "Led migration of trading data platform to cloud infrastructure at SyntheticCo.",
  skills: ["Architecture", "Cloud", "Trading"],
  roles: [
    {
      company: "SyntheticCo",
      title: "Principal Architect",
      period: "2020–present",
      location: "Amsterdam",
      bullets: ["Led trading data platform migration"],
    },
  ],
};

const EVIDENCE_MAP: EvidenceMap = { roles: {} };

export function checkTailorOverlayGuard(): CheckResult {
  // (a) Fabricated overlay.summary must be rejected with VALIDATION_ERROR
  const fabricatedSummary =
    "I built a nuclear reactor and patented a time-travel algorithm during my tenure at SyntheticCo.";
  const rejectedResult = tailorService(
    SYNTHETIC_CV,
    { summary: fabricatedSummary },
    EVIDENCE_MAP,
    undefined,
    { registry: SYNTHETIC_REGISTRY, identity: SYNTHETIC_IDENTITY },
  );
  if (rejectedResult.ok) {
    return {
      name: CHECK_NAME,
      passed: false,
      details:
        "Fabricated overlay.summary was accepted without error — overlay validation is not active in the tailor pipeline",
    };
  }
  if (!rejectedResult.error.message.includes("untraceable")) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `VALIDATION_ERROR raised but message did not cite untraceable claims: ${rejectedResult.error.message}`,
    };
  }

  // (b) Traceable overlay.summary must be accepted
  const traceableSummary =
    "Led migration of trading data platform to cloud infrastructure at SyntheticCo.";
  const acceptedResult = tailorService(
    SYNTHETIC_CV,
    { summary: traceableSummary },
    EVIDENCE_MAP,
    undefined,
    { registry: SYNTHETIC_REGISTRY, identity: SYNTHETIC_IDENTITY },
  );
  if (!acceptedResult.ok) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `Traceable overlay.summary was incorrectly rejected: ${acceptedResult.error.message}`,
    };
  }

  return { name: CHECK_NAME, passed: true };
}
