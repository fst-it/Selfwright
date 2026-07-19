// FF-TAILOR-2: Integration test for governed drift_applications (Task 1 / BUG-1 fix).
// Asserts that an active drift's replace/keywords-only modes actually apply,
// that the high-risk confidence band is gated by allow_high_risk, that
// non-active drifts are silently skipped, and that an unknown drift id fails
// with the real id in the message (not the historical "[object Object]").
import { tailorService } from "@selfwright/core";
import type { DriftEntry } from "@selfwright/core";
import type { EvidenceMap } from "@selfwright/core";
import type { CvContent } from "@selfwright/core";
import type { CheckResult } from "./shared.js";

const CHECK_NAME = "FF-TAILOR-2: tailor pipeline applies governed drift_applications";

function makeDrift(
  id: string,
  status: DriftEntry["status"],
  keywords: string[],
  extra?: Partial<DriftEntry>,
): DriftEntry {
  return {
    id,
    org: "SyntheticCo",
    claim: "Delivered a synthetic drift fixture initiative.",
    deviates_from: { evidence_ids: ["EVD-SYN-001"], kind: "embellishment" },
    tag: "soft",
    keywords,
    confidence: {
      score: 8.0,
      band: "safe",
      factors: { verifiability_backstop: 0.8, distance_from_truth: 0.8, blast_radius: 0.8, external_checkability: 0.8, cross_app_consistency: 0.8, specificity_detectability: 0.8 },
      rubric_score: 8.0,
      ai_adjustment: 0,
      ai_reasoning: "Synthetic test fixture",
    },
    risks: [{ risk: "test", severity: "low", mitigation: "N/A" }],
    status,
    applications: [],
    ...extra,
  };
}

const SYNTHETIC_ACTIVE_DRIFT = makeDrift("DRIFT-SYN-FFT2-001", "active", ["realtime", "pnl", "risk-engine"]);

const SYNTHETIC_RETIRED_DRIFT = makeDrift("DRIFT-SYN-FFT2-002", "retired", ["legacy-keyword"], {
  retired_reason: "superseded",
});

const SYNTHETIC_HIGH_RISK_DRIFT = makeDrift("DRIFT-SYN-FFT2-003", "active", ["moonshot"], {
  confidence: {
    score: 3.0,
    band: "high-risk",
    factors: { verifiability_backstop: 0.3, distance_from_truth: 0.3, blast_radius: 0.3, external_checkability: 0.3, cross_app_consistency: 0.3, specificity_detectability: 0.3 },
    rubric_score: 3.0,
    ai_adjustment: 0,
    ai_reasoning: "Synthetic high-risk fixture",
  },
});

const SYNTHETIC_CV: CvContent = {
  name: "Test User",
  headline: "Architect",
  summary: "Systems architect.",
  skills: ["Architecture", "Cloud"],
  roles: [
    {
      company: "SyntheticCo",
      title: "Architect",
      period: "2020–present",
      location: "Remote",
      bullets: ["Led platform work", "Owned integration layer"],
    },
  ],
};

const EVIDENCE_MAP: EvidenceMap = { roles: {} };

export function checkTailorDriftApply(): CheckResult {
  // (a) replace mode: active drift replaces the target bullet and unions its keywords
  const replaceResult = tailorService(
    SYNTHETIC_CV,
    {
      drift_applications: [
        { id: "DRIFT-SYN-FFT2-001", mode: "replace", target: { role: "SyntheticCo", bullet: 0 }, allow_high_risk: false },
      ],
    },
    EVIDENCE_MAP,
    undefined,
    { drifts: [SYNTHETIC_ACTIVE_DRIFT, SYNTHETIC_RETIRED_DRIFT, SYNTHETIC_HIGH_RISK_DRIFT] },
  );
  if (!replaceResult.ok) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `replace mode with an active drift returned error: ${replaceResult.error.message}`,
    };
  }
  const bullets = replaceResult.value.roles?.[0]?.bullets ?? [];
  if (bullets[0] !== SYNTHETIC_ACTIVE_DRIFT.claim) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `Expected bullet 0 to be replaced with the drift claim; got: ${String(bullets[0])}`,
    };
  }
  const skills = replaceResult.value.skills ?? [];
  if (!skills.includes("realtime") || !skills.includes("pnl")) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `Expected "realtime" and "pnl" in output skills; got: ${skills.join(", ")}`,
    };
  }
  const applied = replaceResult.value._tailor_meta.applied_drifts;
  if (!applied?.some((d) => d.id === "DRIFT-SYN-FFT2-001" && d.mode === "replace")) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `Expected applied_drifts to record DRIFT-SYN-FFT2-001 with mode "replace"; got: ${JSON.stringify(applied)}`,
    };
  }

  // (b) retired drift must not apply even when referenced
  const retiredResult = tailorService(
    SYNTHETIC_CV,
    { drift_applications: [{ id: "DRIFT-SYN-FFT2-002", mode: "keywords-only", allow_high_risk: false }] },
    EVIDENCE_MAP,
    undefined,
    { drifts: [SYNTHETIC_ACTIVE_DRIFT, SYNTHETIC_RETIRED_DRIFT] },
  );
  if (!retiredResult.ok) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `drift_applications with a retired drift returned unexpected error: ${retiredResult.error.message}`,
    };
  }
  if ((retiredResult.value.skills ?? []).includes("legacy-keyword")) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: "Retired drift keyword 'legacy-keyword' was applied — non-active drifts must be skipped",
    };
  }

  // (c) high-risk band is gated without allow_high_risk
  const gatedResult = tailorService(
    SYNTHETIC_CV,
    { drift_applications: [{ id: "DRIFT-SYN-FFT2-003", mode: "keywords-only", allow_high_risk: false }] },
    EVIDENCE_MAP,
    undefined,
    { drifts: [SYNTHETIC_HIGH_RISK_DRIFT] },
  );
  if (gatedResult.ok) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: "high-risk drift applied without allow_high_risk — the confidence-band gate is not enforced",
    };
  }

  // (d) high-risk band applies when explicitly allowed
  const allowedResult = tailorService(
    SYNTHETIC_CV,
    { drift_applications: [{ id: "DRIFT-SYN-FFT2-003", mode: "keywords-only", allow_high_risk: true }] },
    EVIDENCE_MAP,
    undefined,
    { drifts: [SYNTHETIC_HIGH_RISK_DRIFT] },
  );
  if (!allowedResult.ok) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `high-risk drift with allow_high_risk: true returned unexpected error: ${allowedResult.error.message}`,
    };
  }

  // (e) unknown drift ID must produce VALIDATION_ERROR naming the real id — the BUG-1 crash fix
  const unknownResult = tailorService(
    SYNTHETIC_CV,
    { drift_applications: [{ id: "DRIFT-DOES-NOT-EXIST", mode: "keywords-only", allow_high_risk: false }] },
    EVIDENCE_MAP,
    undefined,
    { drifts: [SYNTHETIC_ACTIVE_DRIFT] },
  );
  if (unknownResult.ok) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: "Unknown drift ID in drift_applications did not return VALIDATION_ERROR",
    };
  }
  if (
    !unknownResult.error.message.includes("DRIFT-DOES-NOT-EXIST") ||
    unknownResult.error.message.includes("[object Object]")
  ) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `Unknown drift ID error must name the real id, not "[object Object]"; got: ${unknownResult.error.message}`,
    };
  }

  return { name: CHECK_NAME, passed: true };
}
