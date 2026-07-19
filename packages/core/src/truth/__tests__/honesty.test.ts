import { describe, it, expect } from "vitest";
import { scanHonestyBoundary } from "../honesty.js";
import type { EvidenceEntry } from "../schemas/index.js";
import type { DriftEntry } from "../schemas/index.js";

// EVD-ACME-AIVALUE from registry: has retired phrase "autonomous trading agents"
const REGISTRY_WITH_RETIRED: EvidenceEntry[] = [
  {
    id: "EVD-ACME-AIVALUE",
    org: "Acme Corp",
    claim: "Built the business case attributing $55M value to AI and data initiatives",
    tag: "soft",
    keywords: ["GenAI", "AI strategy", "business case", "value", "front office"],
    retired: ["autonomous trading agents — do not use anywhere"],
  },
];

const CLEAN_REGISTRY: EvidenceEntry[] = [
  {
    id: "EVD-ACME-LEADERSHIP",
    org: "Acme Corp",
    claim: "Leads enterprise architecture function",
    tag: "soft",
    keywords: ["enterprise architecture"],
  },
];

const NO_DRIFTS: DriftEntry[] = [];

// Minimal retired drift fixture using real DRIFT-* id pattern and real EVD-* reference
const RETIRED_DRIFT: DriftEntry = {
  id: "DRIFT-GLOBEX-DESKLATENCY",
  org: "Acme Corp",
  claim: "Re-architected Position PnL to near-real-time for front-office traders",
  deviates_from: {
    evidence_ids: ["EVD-ACME-POSITIONPNL"],
    kind: "reframe",
  },
  tag: "claim",
  keywords: ["near real-time", "front office", "intraday"],
  confidence: {
    score: 7.6,
    band: "caution",
    rubric_version: "v1",
    factors: {
      verifiability_backstop: 0.85,
      distance_from_truth: 0.70,
      blast_radius: 0.60,
      external_checkability: 0.75,
      cross_app_consistency: 0.80,
      specificity_detectability: 0.65,
    },
    rubric_score: 7.3,
    ai_adjustment: 0.3,
    ai_reasoning: "Test fixture — drift retired for clarity in test suite.",
  },
  risks: [
    {
      risk: "Interviewer probes near-real-time and expects sub-second streaming",
      severity: "medium",
      mitigation: "Fall back to the locked 30-minute figure.",
    },
  ],
  status: "retired",
  applications: [],
  retired_reason: "Walked back for consistency with locked evidence.",
  promoted_to: null,
};

describe("scanHonestyBoundary()", () => {
  it("detects a retired EVD phrase in text", () => {
    const text =
      "Designed autonomous trading agents for automated front-office execution strategies.";
    const result = scanHonestyBoundary(text, NO_DRIFTS, REGISTRY_WITH_RETIRED);
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.source).toBe("evd-retired");
    expect(result.violations[0]?.phrase).toBe("autonomous trading agents");
  });

  it("is case-insensitive when detecting retired phrases", () => {
    const text = "Deployed AUTONOMOUS TRADING AGENTS across multiple desks.";
    const result = scanHonestyBoundary(text, NO_DRIFTS, REGISTRY_WITH_RETIRED);
    expect(result.ok).toBe(false);
    expect(result.violations[0]?.phrase).toBe("autonomous trading agents");
  });

  it("passes clean text that does not contain retired phrases", () => {
    const text =
      "Led AI initiatives that built the business case for an AI Centre of Excellence.";
    const result = scanHonestyBoundary(text, NO_DRIFTS, REGISTRY_WITH_RETIRED);
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("detects a retired drift keyword in text", () => {
    const text =
      "Built a system delivering near real-time position visibility for intraday trading.";
    const result = scanHonestyBoundary(text, [RETIRED_DRIFT], CLEAN_REGISTRY);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.source === "drift-retired")).toBe(true);
  });

  it("ignores keywords from active drifts", () => {
    const activeDrift: DriftEntry = {
      ...RETIRED_DRIFT,
      status: "active",
      retired_reason: null,
    };
    const text =
      "Built a system delivering near real-time position visibility for intraday trading.";
    const result = scanHonestyBoundary(text, [activeDrift], CLEAN_REGISTRY);
    expect(result.ok).toBe(true);
  });

  it("returns ok when registry has no retired entries", () => {
    const text =
      "Led enterprise architecture and data platform strategy across the organisation.";
    const result = scanHonestyBoundary(text, NO_DRIFTS, CLEAN_REGISTRY);
    expect(result.ok).toBe(true);
  });

  it("handles empty registry and no drifts", () => {
    const text = "Leads enterprise architecture across global domains.";
    const result = scanHonestyBoundary(text, [], []);
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("handles EVD entry with no retired field", () => {
    const registry: EvidenceEntry[] = [
      {
        id: "EVD-ACME-LEADERSHIP",
        org: "Acme Corp",
        claim: "Leads enterprise architecture function",
        tag: "soft",
        keywords: [],
      },
    ];
    const result = scanHonestyBoundary(
      "Leads enterprise architecture globally.",
      NO_DRIFTS,
      registry,
    );
    expect(result.ok).toBe(true);
  });

  it("handles EVD entry with empty retired array", () => {
    const registry: EvidenceEntry[] = [
      {
        id: "EVD-GPDL-REVENUE",
        org: "Acme Corp (Global Product Data Leader)",
        claim: "Product leader owning global product data end-to-end",
        tag: "soft",
        keywords: ["data products"],
        retired: [],
      },
    ];
    const result = scanHonestyBoundary(
      "Delivered global data products across the organisation.",
      NO_DRIFTS,
      registry,
    );
    expect(result.ok).toBe(true);
  });

  // ── F3 regression: whitespace/zero-width evasion of the honesty boundary ──
  // Phase 3 adversarial review. A retired phrase reformatted across a double
  // space, a markdown line-wrap newline, or a U+200B zero-width space
  // previously evaded the plain lowercase .includes() substring check
  // entirely. All three must now still be detected.
  describe("F3: whitespace/zero-width evasion", () => {
    it("detects a retired phrase split by a double space", () => {
      const text = "Designed autonomous  trading agents for automated execution.";
      const result = scanHonestyBoundary(text, NO_DRIFTS, REGISTRY_WITH_RETIRED);
      expect(result.ok).toBe(false);
      expect(result.violations[0]?.source).toBe("evd-retired");
    });

    it("detects a retired phrase split by a newline (markdown line-wrap)", () => {
      const text = "Designed autonomous\ntrading agents for automated execution.";
      const result = scanHonestyBoundary(text, NO_DRIFTS, REGISTRY_WITH_RETIRED);
      expect(result.ok).toBe(false);
      expect(result.violations[0]?.source).toBe("evd-retired");
    });

    it("detects a retired phrase with a U+200B zero-width space inserted between words", () => {
      const text = "Designed autonomous​trading​agents for automated execution.";
      const result = scanHonestyBoundary(text, NO_DRIFTS, REGISTRY_WITH_RETIRED);
      expect(result.ok).toBe(false);
      expect(result.violations[0]?.source).toBe("evd-retired");
    });

    it("detects a retired drift keyword split by a double space", () => {
      const text = "Built a system delivering near  real-time position visibility for intraday trading.";
      const result = scanHonestyBoundary(text, [RETIRED_DRIFT], CLEAN_REGISTRY);
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.source === "drift-retired")).toBe(true);
    });
  });
});
