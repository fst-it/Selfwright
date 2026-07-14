import { describe, expect, it } from "vitest";
import { applyOverlay, _resolveRoleOrderName } from "../tailor.js";
import { CvOverlaySchema } from "../overlay.js";
import type { CvOverlay } from "../overlay.js";
import type { EvidenceMap } from "../evidence-map.js";
import type { CvContent } from "../../scoring/types.js";
import type { EvidenceEntry, DriftEntry } from "../../truth/schemas/index.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_CV: CvContent = {
  name: "Test User",
  headline: "Enterprise Architect",
  summary: "Experienced architect.",
  citizenship: "EU",
  skills: ["Architecture", "CTRM", "Integration"],
  roles: [
    {
      company: "Globex",
      title: "Enterprise Architect",
      period: "Jan 2020 – Present",
      location: "Amsterdam",
      bullets: ["Led CTRM platform", "Built API layer", "Mentored 12 engineers"],
    },
    {
      company: "Acme Corp",
      title: "Principal Architect",
      period: "Jan 2015 – Dec 2019",
      location: "Geneva",
      bullets: ["Designed trading system", "Led integration work"],
    },
    {
      company: "Acme Corp",
      title: "Product Data Lead",
      period: "Jan 2012 – Dec 2014",
      location: "Geneva",
      bullets: ["Managed product data platform"],
    },
  ],
};

const EMPTY_OVERLAY: CvOverlay = {};

const EVIDENCE_MAP: EvidenceMap = {
  roles: {
    "0": {
      company: "Globex",
      bullets: {
        "0": { evidence: ["EVD-GLOBEX-CTRM"] },
        "1": { evidence: ["EVD-GLOBEX-API"] },
        "2": { evidence: ["EVD-GLOBEX-MENTOR"] },
      },
    },
    "1": {
      company: "Acme Corp",
      bullets: {
        "0": { evidence: ["EVD-ACME-TRADE"] },
        "1": { evidence: ["EVD-ACME-INT"] },
      },
    },
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("applyOverlay", () => {
  it("identity transform: empty overlay preserves all CV fields", () => {
    const result = applyOverlay(BASE_CV, EMPTY_OVERLAY, EVIDENCE_MAP);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.headline).toBe("Enterprise Architect");
    expect(result.value.summary).toBe("Experienced architect.");
    expect(result.value.skills).toEqual(["Architecture", "CTRM", "Integration"]);
    expect(result.value.citizenship).toBe("EU");
    expect(result.value.roles).toHaveLength(3);
  });

  it("headline override replaces headline", () => {
    const overlay: CvOverlay = { headline: "  Senior Enterprise Architect  " };
    const result = applyOverlay(BASE_CV, EMPTY_OVERLAY, EVIDENCE_MAP);
    expect(result.ok).toBe(true);
    const withOverride = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP);
    expect(withOverride.ok).toBe(true);
    if (!withOverride.ok) return;
    expect(withOverride.value.headline).toBe("Senior Enterprise Architect");
  });

  it("summary override replaces summary", () => {
    const overlay: CvOverlay = { summary: "Focused on trading systems." };
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.summary).toBe("Focused on trading systems.");
  });

  it("skills override replaces skills", () => {
    const overlay: CvOverlay = { skills: ["CTRM", "Cloud"] };
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.skills).toEqual(["CTRM", "Cloud"]);
  });

  it("empty skills overlay keeps original skills", () => {
    const overlay: CvOverlay = { skills: [] };
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.skills).toEqual(BASE_CV.skills);
  });

  it("suppress_evidence: excludes bullet whose all EVD-IDs are suppressed", () => {
    const overlay: CvOverlay = { suppress_evidence: ["EVD-GLOBEX-CTRM"] };
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const role0Bullets = result.value.roles?.[0]?.bullets ?? [];
    expect(role0Bullets).not.toContain("Led CTRM platform");
    expect(role0Bullets).toContain("Built API layer");
  });

  it("suppress_evidence: keeps bullet if only SOME EVD-IDs are suppressed", () => {
    // EVD-GLOBEX-API is one of possibly multiple evidence IDs; if bullet has only
    // EVD-GLOBEX-API and we suppress it, it should be excluded. But if there
    // are multiple IDs and only one is suppressed, bullet stays.
    const mapWithMulti: EvidenceMap = {
      roles: {
        "0": {
          bullets: {
            "0": { evidence: ["EVD-GLOBEX-CTRM", "EVD-GLOBEX-API"] },
          },
        },
      },
    };
    // Suppress only one of two evidence IDs
    const overlay: CvOverlay = { suppress_evidence: ["EVD-GLOBEX-CTRM"] };
    const result = applyOverlay(BASE_CV, overlay, mapWithMulti);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bullets = result.value.roles?.[0]?.bullets ?? [];
    // Bullet 0 has both EVD-GLOBEX-CTRM and EVD-GLOBEX-API; only CTRM suppressed → kept
    expect(bullets).toContain("Led CTRM platform");
  });

  it("include_evidence: de-emphasizes bullets not in include set (moved to end)", () => {
    const overlay: CvOverlay = { include_evidence: ["EVD-GLOBEX-MENTOR"] };
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bullets = result.value.roles?.[0]?.bullets ?? [];
    // EVD-GLOBEX-MENTOR is bullet index 2 → should be moved to front (emphasized)
    // Others (0,1) should be moved to end
    expect(bullets.at(0)).toBe("Mentored 12 engineers");
    expect(bullets).toContain("Led CTRM platform");
    expect(bullets).toContain("Built API layer");
  });

  it("include_evidence empty: no de-emphasis", () => {
    const overlay: CvOverlay = { include_evidence: [] };
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bullets = result.value.roles?.[0]?.bullets ?? [];
    // Original order preserved
    expect(bullets.at(0)).toBe("Led CTRM platform");
  });

  it("bullet_order: explicit ordering respected", () => {
    const overlay: CvOverlay = {
      bullet_order: { Globex: [2, 0, 1] },
    };
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bullets = result.value.roles?.[0]?.bullets ?? [];
    expect(bullets.at(0)).toBe("Mentored 12 engineers");
    expect(bullets.at(1)).toBe("Led CTRM platform");
    expect(bullets.at(2)).toBe("Built API layer");
  });

  it("bullet_order empty result → fallback to all original", () => {
    // bullet_order indices that map to suppressed bullets → all filtered → fallback
    const overlay: CvOverlay = {
      suppress_evidence: ["EVD-GLOBEX-CTRM", "EVD-GLOBEX-API", "EVD-GLOBEX-MENTOR"],
      bullet_order: { Globex: [0, 1, 2] },
    };
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bullets = result.value.roles?.[0]?.bullets ?? [];
    // All suppressed via bullet_order → fallback to original
    expect(bullets).toEqual(BASE_CV.roles?.[0]?.bullets);
  });

  it("role_order: roles reordered correctly; unmentioned roles appended", () => {
    const overlay: CvOverlay = { role_order: ["acme corp"] };
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const roles = result.value.roles ?? [];
    // "acme corp" resolves to index 1 (first Acme Corp architect)
    expect(roles.at(0)?.company).toBe("Acme Corp");
    expect(roles.at(0)?.title).toBe("Principal Architect");
    // Globex and Acme Corp-GPDL appended
    expect(roles.some((r) => r.company === "Globex")).toBe(true);
  });

  it("registryIds validation: unknown ID in suppress_evidence → error", () => {
    const overlay: CvOverlay = { suppress_evidence: ["EVD-UNKNOWN"] };
    const registry = new Set(["EVD-GLOBEX-CTRM", "EVD-GLOBEX-API"]);
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP, registry);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("VALIDATION_ERROR");
    expect(result.error.message).toContain("EVD-UNKNOWN");
  });

  it("registryIds = undefined: no validation (skip)", () => {
    const overlay: CvOverlay = { suppress_evidence: ["EVD-NONEXISTENT"] };
    // No registry provided → no validation → succeeds
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP, undefined);
    expect(result.ok).toBe(true);
  });

  it("headline validation: fabricated headline with registry+identity is rejected", () => {
    const registry: EvidenceEntry[] = [
      { id: "EVD-SYN-001", org: "Globex", claim: "Led API layer development", tag: "soft", keywords: ["api", "development", "integration"] },
    ];
    const identity: import("../../truth/schemas/index.js").Identity = {
      name: "Test User", canonical_title: "Architect", years_experience: 10,
      headline: "Enterprise Architect", seniority_equivalence: "Senior", headline_policy: "None",
      also_known_as_titles: [], cv_generation_rules: [], education: [],
      contact: { location: "Amsterdam", phone: "+31000000000", email: "test@example.com", linkedin: "https://linkedin.com/in/test" },
      citizenship: "EU", relocation: [], languages: {}, certifications: [], team_sizes: {},
      roles_timeline: [{ company: "Globex", title: "Enterprise Architect", period: "2020–present" }],
      honesty_boundaries: [], calibration: "None",
    };
    const overlay: CvOverlay = { headline: "Nobel Prize winning quantum physicist and astronaut." };
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP, undefined, { registry, identity });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("VALIDATION_ERROR");
    expect(result.error.message).toContain("headline");
  });

  it("drift_applications: empty array is a no-op", () => {
    const overlay: CvOverlay = { drift_applications: [] };
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value._tailor_meta.applied_drifts).toBeUndefined();
  });

  it("role_order: duplicate company name is placed only once", () => {
    const overlay: CvOverlay = { role_order: ["globex", "globex", "acme corp"] };
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const trafRoles = (result.value.roles ?? []).filter((r) => r.company === "Globex");
    expect(trafRoles).toHaveLength(1);
  });

  it("zero bullets after filtering → fallback to original", () => {
    const overlay: CvOverlay = {
      suppress_evidence: ["EVD-GLOBEX-CTRM", "EVD-GLOBEX-API", "EVD-GLOBEX-MENTOR"],
    };
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bullets = result.value.roles?.[0]?.bullets ?? [];
    expect(bullets).toEqual(BASE_CV.roles?.[0]?.bullets);
  });

  it("metadata: _tailor_meta has correct fields", () => {
    const overlay: CvOverlay = {
      archetype: "ctrm-enterprise-architect",
      suppress_evidence: ["EVD-GLOBEX-CTRM"],
      include_evidence: ["EVD-GLOBEX-API"],
    };
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const meta = result.value._tailor_meta;
    expect(meta.archetype).toBe("ctrm-enterprise-architect");
    expect(meta.suppressed_evidence).toContain("EVD-GLOBEX-CTRM");
    expect(meta.included_evidence).toContain("EVD-GLOBEX-API");
    expect(typeof meta.generated_at).toBe("string");
    expect(typeof meta.overlay_applied).toBe("string");
  });

  it("citizenship override", () => {
    const overlay: CvOverlay = { citizenship: "British" };
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.citizenship).toBe("British");
  });
});

describe("resolveRoleOrderName", () => {
  const roles = BASE_CV.roles ?? [];

  it('"acme corp" resolves to first Acme Corp architect role', () => {
    const idx = _resolveRoleOrderName("acme corp", roles);
    expect(idx).toBe(1); // Principal Architect at Acme Corp
  });

  it('"Acme Corp|product data" pipe-syntax resolves to product data lead role', () => {
    // Hardcoded "acme-corp-gpdl" logic is removed; callers now use pipe syntax.
    const idx = _resolveRoleOrderName("Acme Corp|product data", roles);
    expect(idx).toBe(2); // Product Data Lead at Acme Corp
  });

  it("company_aliases map: alias resolves via pipe-separated canonical", () => {
    const aliases = { "gpdl": "Acme Corp|product data" };
    const idx = _resolveRoleOrderName("gpdl", roles, aliases);
    expect(idx).toBe(2);
  });

  it("general company name match", () => {
    const idx = _resolveRoleOrderName("globex", roles);
    expect(idx).toBe(0);
  });

  it("returns -1 for unknown company", () => {
    const idx = _resolveRoleOrderName("shell", roles);
    expect(idx).toBe(-1);
  });
});

function makeDriftEntry(
  id: string,
  status: DriftEntry["status"],
  keywords: string[],
  opts: {
    org?: string;
    band?: "safe" | "caution" | "high-risk";
    claim?: string;
    extra?: Partial<DriftEntry>;
  } = {},
): DriftEntry {
  const band = opts.band ?? "safe";
  return {
    id,
    org: opts.org ?? "SyntheticCo",
    claim: opts.claim ?? "Synthetic drift claim for testing",
    deviates_from: { evidence_ids: ["EVD-SYN-001"], kind: "embellishment" },
    tag: "soft",
    keywords,
    confidence: {
      score: 8.0,
      band,
      factors: { verifiability_backstop: 0.8, distance_from_truth: 0.8, blast_radius: 0.8, external_checkability: 0.8, cross_app_consistency: 0.8, specificity_detectability: 0.8 },
      rubric_score: 8.0,
      ai_adjustment: 0,
      ai_reasoning: "Synthetic test fixture",
    },
    risks: [{ risk: "Test risk", severity: "low", mitigation: "N/A" }],
    status,
    applications: [],
    ...opts.extra,
  };
}

describe("drift_applications — governed operation", () => {
  it("replace mode: target bullet becomes the drift claim", () => {
    const drift = makeDriftEntry("DRIFT-SYN-REPLACE", "active", ["realtime"], {
      org: "Globex",
      claim: "Rebuilt the CTRM platform around a realtime pricing core.",
    });
    const overlay: CvOverlay = {
      drift_applications: [
        { id: "DRIFT-SYN-REPLACE", mode: "replace", target: { role: "Globex", bullet: 0 }, allow_high_risk: false },
      ],
    };
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP, undefined, { drifts: [drift] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bullets = result.value.roles?.[0]?.bullets ?? [];
    expect(bullets).toHaveLength(3);
    expect(bullets[0]).toBe("Rebuilt the CTRM platform around a realtime pricing core.");
    expect(result.value.skills).toContain("realtime");
  });

  it("inject mode: splices the claim at target.bullet", () => {
    const drift = makeDriftEntry("DRIFT-SYN-INJECT", "active", ["risk-engine"], {
      org: "Globex",
      claim: "Introduced a realtime risk-engine dashboard for traders.",
    });
    const overlay: CvOverlay = {
      drift_applications: [
        { id: "DRIFT-SYN-INJECT", mode: "inject", target: { role: "Globex", bullet: 1 }, allow_high_risk: false },
      ],
    };
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP, undefined, { drifts: [drift] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bullets = result.value.roles?.[0]?.bullets ?? [];
    expect(bullets).toHaveLength(4);
    expect(bullets[0]).toBe("Led CTRM platform");
    expect(bullets[1]).toBe("Introduced a realtime risk-engine dashboard for traders.");
    expect(bullets[2]).toBe("Built API layer");
  });

  it("inject mode: appends the claim when target.bullet is omitted", () => {
    const drift = makeDriftEntry("DRIFT-SYN-APPEND", "active", ["cloud-migration"], {
      org: "Globex",
      claim: "Led the cloud migration of the trading desk.",
    });
    const overlay: CvOverlay = {
      drift_applications: [
        { id: "DRIFT-SYN-APPEND", mode: "inject", target: { role: "Globex" }, allow_high_risk: false },
      ],
    };
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP, undefined, { drifts: [drift] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bullets = result.value.roles?.[0]?.bullets ?? [];
    expect(bullets).toHaveLength(4);
    expect(bullets.at(-1)).toBe("Led the cloud migration of the trading desk.");
  });

  it("keywords-only mode: unions skills without touching bullets", () => {
    const drift = makeDriftEntry("DRIFT-SYN-KWONLY", "active", ["kubernetes", "terraform"], {
      org: "Globex",
    });
    const overlay: CvOverlay = {
      drift_applications: [{ id: "DRIFT-SYN-KWONLY", mode: "keywords-only", allow_high_risk: false }],
    };
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP, undefined, { drifts: [drift] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.skills).toContain("kubernetes");
    expect(result.value.skills).toContain("terraform");
    expect(result.value.roles?.[0]?.bullets).toEqual(BASE_CV.roles?.[0]?.bullets);
  });

  it("band gate: high-risk drift is refused without allow_high_risk", () => {
    const drift = makeDriftEntry("DRIFT-SYN-HIGHRISK", "active", ["moonshot"], {
      org: "Globex",
      band: "high-risk",
    });
    const overlay: CvOverlay = {
      drift_applications: [{ id: "DRIFT-SYN-HIGHRISK", mode: "keywords-only", allow_high_risk: false }],
    };
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP, undefined, { drifts: [drift] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("VALIDATION_ERROR");
    expect(result.error.message).toContain("DRIFT-SYN-HIGHRISK");
    expect(result.error.message).toContain("high-risk");
  });

  it("band gate: high-risk drift applies when allow_high_risk is true", () => {
    const drift = makeDriftEntry("DRIFT-SYN-HIGHRISK-OK", "active", ["moonshot"], {
      org: "Globex",
      band: "high-risk",
    });
    const overlay: CvOverlay = {
      drift_applications: [{ id: "DRIFT-SYN-HIGHRISK-OK", mode: "keywords-only", allow_high_risk: true }],
    };
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP, undefined, { drifts: [drift] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.skills).toContain("moonshot");
  });

  it("retired drift is skipped even when referenced", () => {
    const drift = makeDriftEntry("DRIFT-SYN-RETIRED", "retired", ["legacy-term"], {
      org: "Globex",
      extra: { retired_reason: "superseded" },
    });
    const overlay: CvOverlay = {
      drift_applications: [{ id: "DRIFT-SYN-RETIRED", mode: "keywords-only", allow_high_risk: false }],
    };
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP, undefined, { drifts: [drift] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.skills).not.toContain("legacy-term");
    expect(result.value._tailor_meta.applied_drifts).toBeUndefined();
  });

  it("unknown drift ID returns VALIDATION_ERROR naming the real id (not [object Object])", () => {
    const overlay: CvOverlay = {
      drift_applications: [{ id: "DRIFT-DOES-NOT-EXIST", mode: "keywords-only", allow_high_risk: false }],
    };
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP, undefined, { drifts: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("VALIDATION_ERROR");
    expect(result.error.message).toContain("DRIFT-DOES-NOT-EXIST");
    expect(result.error.message).not.toContain("[object Object]");
  });

  it("falls back to the drift's org when target.role does not resolve", () => {
    const drift = makeDriftEntry("DRIFT-SYN-FALLBACK", "active", ["fallback-kw"], {
      org: "Globex",
      claim: "Owned a fallback-anchored initiative at Globex.",
    });
    const overlay: CvOverlay = {
      drift_applications: [
        { id: "DRIFT-SYN-FALLBACK", mode: "inject", target: { role: "not-a-real-company" }, allow_high_risk: false },
      ],
    };
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP, undefined, { drifts: [drift] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.roles?.[0]?.bullets).toContain("Owned a fallback-anchored initiative at Globex.");
  });

  it("returns VALIDATION_ERROR when neither target.role nor the drift's org resolve", () => {
    const drift = makeDriftEntry("DRIFT-SYN-NORESOLVE", "active", ["kw"], { org: "Nonexistent Corp" });
    const overlay: CvOverlay = {
      drift_applications: [
        { id: "DRIFT-SYN-NORESOLVE", mode: "inject", target: { role: "also-not-real" }, allow_high_risk: false },
      ],
    };
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP, undefined, { drifts: [drift] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("VALIDATION_ERROR");
    expect(result.error.message).toContain("DRIFT-SYN-NORESOLVE");
  });

  it("returns VALIDATION_ERROR when replace target.bullet is out of range", () => {
    const drift = makeDriftEntry("DRIFT-SYN-OOR", "active", ["kw"], { org: "Globex" });
    const overlay: CvOverlay = {
      drift_applications: [
        { id: "DRIFT-SYN-OOR", mode: "replace", target: { role: "Globex", bullet: 99 }, allow_high_risk: false },
      ],
    };
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP, undefined, { drifts: [drift] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("VALIDATION_ERROR");
  });

  it("_tailor_meta.applied_drifts records { id, mode, role, bullet, claim, band }", () => {
    const drift = makeDriftEntry("DRIFT-SYN-META", "active", ["observability"], {
      org: "Globex",
      band: "caution",
      claim: "Stood up an observability stack for the trading platform.",
    });
    const overlay: CvOverlay = {
      drift_applications: [
        { id: "DRIFT-SYN-META", mode: "replace", target: { role: "Globex", bullet: 1 }, allow_high_risk: false },
      ],
    };
    const result = applyOverlay(BASE_CV, overlay, EVIDENCE_MAP, undefined, { drifts: [drift] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value._tailor_meta.applied_drifts).toEqual([
      {
        id: "DRIFT-SYN-META",
        mode: "replace",
        role: "Globex",
        bullet: 1,
        claim: "Stood up an observability stack for the trading platform.",
        band: "caution",
      },
    ]);
  });
});

describe("CvOverlaySchema — drift_applications", () => {
  it("accepts a valid drift_applications overlay and defaults allow_high_risk to false", () => {
    const raw = {
      drift_applications: [{ id: "DRIFT-GLOBEX-001", mode: "replace", target: { role: "Globex", bullet: 0 } }],
    };
    const result = CvOverlaySchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.drift_applications?.[0]?.allow_high_risk).toBe(false);
  });

  it("rejects mode \"replace\" with no target", () => {
    const raw = { drift_applications: [{ id: "DRIFT-GLOBEX-001", mode: "replace" }] };
    expect(CvOverlaySchema.safeParse(raw).success).toBe(false);
  });

  it("rejects mode \"inject\" with no target", () => {
    const raw = { drift_applications: [{ id: "DRIFT-GLOBEX-001", mode: "inject" }] };
    expect(CvOverlaySchema.safeParse(raw).success).toBe(false);
  });

  it("rejects mode \"replace\" with a target missing bullet", () => {
    const raw = { drift_applications: [{ id: "DRIFT-GLOBEX-001", mode: "replace", target: { role: "Globex" } }] };
    expect(CvOverlaySchema.safeParse(raw).success).toBe(false);
  });

  it("rejects the legacy bare-string inject_drifts shape (object-only schema)", () => {
    // This is the exact shape that used to crash `[object Object]`-style: a
    // raw string where an object is now required. It must fail validation
    // cleanly at the boundary instead of reaching applyOverlay.
    const raw = { drift_applications: ["DRIFT-GLOBEX-001"] };
    expect(CvOverlaySchema.safeParse(raw).success).toBe(false);
  });

  it("rejects an id that doesn't match the DRIFT-* pattern", () => {
    const raw = { drift_applications: [{ id: "not-a-drift-id", mode: "keywords-only" }] };
    expect(CvOverlaySchema.safeParse(raw).success).toBe(false);
  });
});
