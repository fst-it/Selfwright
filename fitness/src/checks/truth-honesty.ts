import { scanHonestyBoundary } from "@selfwright/core/truth/honesty";
import type { EvidenceEntry, DriftEntry } from "@selfwright/core";
import type { CheckResult } from "./shared.js";

const CHECK_NAME = "FF-TRUTH-3: truth-honesty — no retired phrases in active content";

// ── Synthetic fixtures (CI-safe — no private data required) ───────────────────
//
// This check is fully decoupled from production data. The retired phrase
// "autonomous trading agents" is embedded in the synthetic registry entry below —
// the same value that was previously read from EVD-ACME-AIVALUE.retired in the
// private data directory. The algorithm is unchanged; only the fixture source changed.

const SYNTHETIC_REGISTRY: EvidenceEntry[] = [
  {
    id: "EVD-SYN-FF3-001",
    org: "SyntheticCo",
    claim: "Led AI initiatives to build the business case for an AI Centre of Excellence",
    tag: "soft",
    keywords: ["ai", "initiatives", "business", "centre", "excellence"],
    // This retired array mimics EVD-ACME-AIVALUE.retired — the phrase that
    // previously made this check dependent on private data.
    retired: ["autonomous trading agents — do not use anywhere"],
  },
];

// Must be CLEAN — no retired phrase present
const FIXTURE_CLEAN =
  "Led AI initiatives that built the business case for an AI Centre of Excellence.";

// Must DETECT a violation — contains the retired phrase from SYNTHETIC_REGISTRY
const FIXTURE_RETIRED =
  "Designed autonomous trading agents to automate front-office desk execution.";

// Synthetic drifts: one retired drift with a keyword to test drift-keyword detection
const SYNTHETIC_DRIFTS: DriftEntry[] = [
  {
    id: "DRIFT-SYN-FF3-001",
    org: "SyntheticCo",
    claim: "Synthetic drift for honesty boundary test",
    deviates_from: { evidence_ids: ["EVD-SYN-FF3-001"], kind: "embellishment" },
    tag: "soft",
    status: "retired",
    retired_reason: "replaced by cleaner terminology",
    keywords: ["synergistic-disruption"],
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
  },
];

export function checkTruthHonesty(): CheckResult {
  // (a) Clean fixture must produce zero violations
  const clean = scanHonestyBoundary(FIXTURE_CLEAN, SYNTHETIC_DRIFTS, SYNTHETIC_REGISTRY);
  if (!clean.ok) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `Clean fixture triggered unexpected violation: ${clean.violations.map((v) => v.phrase).join(", ")}`,
    };
  }

  // (b) Retired-phrase fixture must be detected via EVD retired array
  const retired = scanHonestyBoundary(FIXTURE_RETIRED, SYNTHETIC_DRIFTS, SYNTHETIC_REGISTRY);
  if (retired.ok) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: "Retired phrase 'autonomous trading agents' not detected in fixture text",
    };
  }

  // (c) Drift-keyword fixture: text with retired drift keyword must be detected
  const driftText = "We applied synergistic-disruption methods to the platform architecture.";
  const driftResult = scanHonestyBoundary(driftText, SYNTHETIC_DRIFTS, SYNTHETIC_REGISTRY);
  if (driftResult.ok) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: "Retired drift keyword 'synergistic-disruption' not detected in fixture text",
    };
  }

  return { name: CHECK_NAME, passed: true };
}
