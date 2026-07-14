import { describe, expect, it } from "vitest";
import { tailor } from "../tailor.js";
import type { CvContent } from "../../scoring/types.js";
import type { CvOverlay } from "../../tailoring/overlay.js";
import type { EvidenceMap } from "../../tailoring/evidence-map.js";
import type { EvidenceEntry, Identity, DriftEntry } from "../../truth/schemas/index.js";

const CV: CvContent = {
  name: "Test User",
  headline: "Enterprise Architect",
  summary: "Experienced architect.",
  skills: ["Architecture", "CTRM"],
  roles: [
    {
      company: "Globex",
      title: "Enterprise Architect",
      period: "Jan 2020 – Present",
      location: "Amsterdam",
      bullets: ["Led CTRM platform", "Built API layer"],
    },
  ],
};

const MAP: EvidenceMap = { roles: {} };

describe("tailor service", () => {
  it("delegates to applyOverlay and returns ok result for empty overlay", () => {
    const result = tailor(CV, {}, MAP);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value._tailor_meta).toBeDefined();
    expect(result.value.headline).toBe("Enterprise Architect");
  });

  it("applies headline override", () => {
    const overlay: CvOverlay = { headline: "Senior Architect" };
    const result = tailor(CV, overlay, MAP);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.headline).toBe("Senior Architect");
  });

  it("empty registry skips honesty post-validation (no false positives)", () => {
    const result = tailor(CV, {}, MAP, undefined, { registry: [], identity: STUB_IDENTITY });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value._tailor_meta.truth_warnings).toBeUndefined();
  });

  it("clean CV with registry+identity+no drifts produces no truth_warnings", () => {
    const evidenceEntry: EvidenceEntry = {
      id: "EVD-SYN-003",
      org: "SyntheticCo",
      claim: "Led CTRM trading platform integration",
      tag: "soft",
      keywords: ["ctrm", "trading", "platform", "integration"],
    };
    // CV.summary = "Experienced architect." — no retired phrases → no warnings
    const result = tailor(CV, {}, MAP, undefined, { registry: [evidenceEntry], identity: STUB_IDENTITY });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // honesty.ok === true (no violations) → truth_warnings remains undefined
    expect(result.value._tailor_meta.truth_warnings).toBeUndefined();
  });

  it("returns error for unknown EVD ID when registryIds provided", () => {
    const overlay: CvOverlay = { suppress_evidence: ["EVD-FAKE"] };
    const registry = new Set(["EVD-REAL"]);
    const result = tailor(CV, overlay, MAP, registry);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("VALIDATION_ERROR");
  });

  const STUB_IDENTITY: Identity = {
    name: "Test User",
    canonical_title: "Architect",
    years_experience: 10,
    headline: "Enterprise Architect",
    seniority_equivalence: "Senior",
    headline_policy: "None",
    also_known_as_titles: [],
    cv_generation_rules: [],
    education: [],
    contact: { location: "Amsterdam", phone: "+31000000000", email: "test@example.com", linkedin: "https://linkedin.com/in/test" },
    citizenship: "EU",
    relocation: [],
    languages: {},
    certifications: [],
    team_sizes: {},
    roles_timeline: [{ company: "SyntheticCo", title: "Principal Architect", period: "2020–present" }],
    honesty_boundaries: [],
    calibration: "None",
  };

  it("returns VALIDATION_ERROR when overlay.summary has untraceable claims (A-2)", () => {
    const evidenceEntry: EvidenceEntry = {
      id: "EVD-SYN-001",
      org: "SyntheticCo",
      claim: "Owned data pipeline design",
      tag: "soft",
      keywords: ["data", "pipeline", "platform", "architecture"],
    };
    const identity = STUB_IDENTITY;
    const fabricatedSummary = "I built a nuclear reactor during my tenure at SyntheticCo.";
    const result = tailor(
      CV,
      { summary: fabricatedSummary },
      MAP,
      undefined,
      { registry: [evidenceEntry], identity },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("VALIDATION_ERROR");
    expect(result.error.message).toContain("untraceable");
  });

  it("post-validation adds truth_warnings for retired drift phrases in output summary (C-4)", () => {
    const retiredDrift: DriftEntry = {
      id: "DRIFT-SYN-RET-001",
      org: "SyntheticCo",
      claim: "Synthetic retired drift",
      deviates_from: { evidence_ids: ["EVD-SYN-002"], kind: "embellishment" },
      tag: "soft",
      status: "retired",
      retired_reason: "deprecated terminology",
      keywords: ["innovative synergies"],
      confidence: {
        score: 5.0,
        band: "caution",
        factors: {
          verifiability_backstop: 0.5,
          distance_from_truth: 0.5,
          blast_radius: 0.5,
          external_checkability: 0.5,
          cross_app_consistency: 0.5,
          specificity_detectability: 0.5,
        },
        rubric_score: 5.0,
        ai_adjustment: 0,
        ai_reasoning: "Synthetic test fixture",
      },
      risks: [{ risk: "test", severity: "low", mitigation: "N/A" }],
      applications: [],
    };
    const evidenceEntry: EvidenceEntry = {
      id: "EVD-SYN-002",
      org: "SyntheticCo",
      claim: "Designed distributed trading platform with innovative synergies across teams",
      tag: "soft",
      keywords: ["trading", "platform", "distributed", "innovative", "synergies"],
    };
    const identity = STUB_IDENTITY;
    const cvWithRetiredPhrase: CvContent = {
      ...CV,
      summary: "Drove innovative synergies across trading platform teams.",
    };
    const result = tailor(
      cvWithRetiredPhrase,
      {},
      MAP,
      undefined,
      { registry: [evidenceEntry], identity, drifts: [retiredDrift] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value._tailor_meta.truth_warnings).toBeDefined();
    expect(result.value._tailor_meta.truth_warnings?.length).toBeGreaterThan(0);
  });

  it("post-validation scans applied-drift claims too, not just the summary (Task 1)", () => {
    const evidenceEntry: EvidenceEntry = {
      id: "EVD-SYN-004",
      org: "SyntheticCo",
      claim: "Owned the legacy pricing engine rollout",
      tag: "soft",
      keywords: ["legacy", "pricing", "engine", "rollout"],
      retired: ["legacy pricing engine — replaced by real-time pricing, 2024"],
    };
    const activeDrift: DriftEntry = {
      id: "DRIFT-SYN-ACTIVE-001",
      org: "Globex",
      claim: "Owned a legacy pricing engine rollout across three desks.",
      deviates_from: { evidence_ids: ["EVD-SYN-004"], kind: "embellishment" },
      tag: "soft",
      status: "active",
      keywords: ["pricing-engine"],
      confidence: {
        score: 8.0,
        band: "safe",
        factors: {
          verifiability_backstop: 0.8,
          distance_from_truth: 0.8,
          blast_radius: 0.8,
          external_checkability: 0.8,
          cross_app_consistency: 0.8,
          specificity_detectability: 0.8,
        },
        rubric_score: 8.0,
        ai_adjustment: 0,
        ai_reasoning: "Synthetic test fixture",
      },
      risks: [{ risk: "test", severity: "low", mitigation: "N/A" }],
      applications: [],
    };
    const overlay: CvOverlay = {
      drift_applications: [{ id: "DRIFT-SYN-ACTIVE-001", mode: "keywords-only", allow_high_risk: false }],
    };
    const result = tailor(CV, overlay, MAP, undefined, {
      registry: [evidenceEntry],
      identity: STUB_IDENTITY,
      drifts: [activeDrift],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The drift itself applied cleanly (it's active and safe) — the CV summary
    // is unrelated to the retired phrase, so only the applied-drift claim can
    // be the source of this warning.
    expect(result.value._tailor_meta.applied_drifts).toBeDefined();
    expect(result.value._tailor_meta.truth_warnings).toBeDefined();
    expect(result.value._tailor_meta.truth_warnings?.length).toBeGreaterThan(0);
  });
});
