import { describe, it, expect } from "vitest";
import { guardSummary } from "../r19-guard.js";
import type { EvidenceEntry } from "../schemas/index.js";
import type { Identity } from "../schemas/index.js";

// Uses only real EVD-* IDs from registry.yml
const REGISTRY: EvidenceEntry[] = [
  {
    id: "EVD-ACME-LEADERSHIP",
    org: "Acme Corp",
    claim: "Leads enterprise architecture function across data, AI, integration and trading",
    tag: "soft",
    keywords: [
      "enterprise architecture",
      "principal architects",
      "federated organisation",
      "application portfolio management",
    ],
  },
  {
    id: "EVD-ACME-DATAPLATFORM",
    org: "Acme Corp",
    claim: "Sole lead architect of future-state Data Platform on AWS and Snowflake",
    tag: { value: "hard", lead: "soft" },
    keywords: ["data platform", "Snowflake", "AWS", "lakehouse", "data mesh", "streaming"],
  },
  {
    id: "EVD-ACME-CTRM",
    org: "Acme Corp",
    claim: "Own enterprise CTRM strategy: multi-vendor buy-vs-build hybrid target architecture",
    tag: "soft",
    keywords: ["CTRM", "buy vs build", "physical trade lifecycle", "hybrid target architecture"],
  },
];

// Minimal identity stub — guardSummary does not use identity in this implementation
const STUB_IDENTITY: Identity = {
  name: "Test User",
  canonical_title: "Architect",
  years_experience: 10,
  headline: "Enterprise Architecture",
  seniority_equivalence: "Director",
  headline_policy: "per-application",
  also_known_as_titles: [],
  cv_generation_rules: [],
  education: [],
  contact: {
    location: "Amsterdam",
    phone: "0000000000",
    email: "not-provided",
    linkedin: "linkedin.com/in/test",
  },
  citizenship: "EU",
  relocation: [],
  languages: {},
  certifications: [],
  team_sizes: {},
  roles_timeline: [],
  honesty_boundaries: [],
  calibration: "test fixture",
};

describe("guardSummary()", () => {
  it("grounds a sentence well-anchored in EVD keywords", () => {
    const text =
      "Leads enterprise architecture at Acme Corp across data platform and integration domains.";
    const result = guardSummary(text, STUB_IDENTITY, REGISTRY);
    expect(result.grounded).toHaveLength(1);
    expect(result.ungrounded).toHaveLength(0);
    expect(result.ok).toBe(true);
  });

  it("flags a sentence with vocabulary absent from all EVD content", () => {
    const text = "Passionate about surfing and ocean conservation initiatives.";
    const result = guardSummary(text, STUB_IDENTITY, REGISTRY);
    expect(result.ungrounded).toHaveLength(1);
    expect(result.ok).toBe(false);
  });

  it("skips short non-numeric sentences (fewer than 4 content words)", () => {
    const result = guardSummary("Yes, indeed.", STUB_IDENTITY, REGISTRY);
    expect(result.grounded).toHaveLength(0);
    expect(result.ungrounded).toHaveLength(0);
    expect(result.ok).toBe(true);
  });

  it("flags a metric claim sentence as untraceable when not in registry", () => {
    // "Raised $22M" is a numeric claim — not skipped by the short-sentence threshold.
    // No EVD entry in REGISTRY mentions fundraising or Series A.
    const result = guardSummary("Raised $22M in Series A funding.", STUB_IDENTITY, REGISTRY);
    expect(result.ungrounded).toHaveLength(1);
    expect(result.ok).toBe(false);
  });

  it("does not ground a sentence that shares only generic vocabulary across entries", () => {
    // This tests the per-entry algorithm: "VP of Engineering at Acme Corp leading 500 engineers"
    // contains vocabulary from EVD entries (architecture, leading) but no single entry has
    // MIN_CORPUS_MATCHES overlap with this specific fabricated seniority claim.
    const tightRegistry: EvidenceEntry[] = [
      {
        id: "EVD-SYN-001",
        org: "SyntheticCo",
        claim: "Owned data pipeline design",
        tag: "soft",
        keywords: ["data", "pipeline"],
      },
    ];
    const result = guardSummary(
      "VP of Engineering at Acme Corp leading 500 engineers.",
      STUB_IDENTITY,
      tightRegistry,
    );
    // "acme", "corp", and "leading" appear, but "vp", "engineering", "leading", "engineers"
    // do not overlap with EVD-SYN-001 (data/pipeline only). STUB_IDENTITY has no roles.
    expect(result.ok).toBe(false);
  });

  it("handles empty text", () => {
    const result = guardSummary("", STUB_IDENTITY, REGISTRY);
    expect(result.ok).toBe(true);
    expect(result.grounded).toHaveLength(0);
    expect(result.ungrounded).toHaveLength(0);
  });

  it("handles empty registry — all substantive sentences ungrounded", () => {
    const text =
      "Leads enterprise architecture across data platform and CTRM strategy globally.";
    const result = guardSummary(text, STUB_IDENTITY, []);
    expect(result.ungrounded).toHaveLength(1);
    expect(result.ok).toBe(false);
  });

  it("grounds CTRM sentence against EVD-ACME-CTRM corpus", () => {
    const text =
      "Defined CTRM strategy using buy vs build approach for the physical trade lifecycle.";
    const result = guardSummary(text, STUB_IDENTITY, REGISTRY);
    expect(result.ok).toBe(true);
  });

  it("handles multi-sentence text with mixed grounded and ungrounded", () => {
    const text = [
      "Leads enterprise architecture and data platform strategy across global trading.",
      "Also enjoys weekend cycling through the Dutch countryside.",
    ].join(" ");
    const result = guardSummary(text, STUB_IDENTITY, REGISTRY);
    expect(result.grounded).toHaveLength(1);
    expect(result.ungrounded).toHaveLength(1);
    expect(result.ok).toBe(false);
  });

  it("grounds a Snowflake data platform sentence", () => {
    const text =
      "Architected the enterprise data platform on Snowflake and AWS with streaming and lakehouse capabilities.";
    const result = guardSummary(text, STUB_IDENTITY, REGISTRY);
    expect(result.ok).toBe(true);
  });

  it("returns grounded sentences as trimmed strings", () => {
    const text = "  Leads enterprise architecture and application portfolio management.  ";
    const result = guardSummary(text, STUB_IDENTITY, REGISTRY);
    if (result.grounded.length > 0) {
      expect(result.grounded[0]).toBe(result.grounded[0]?.trim());
    }
  });

  it("uses EVD detail text to ground a sentence", () => {
    const registryWithDetail: EvidenceEntry[] = [
      {
        id: "EVD-ACME-DATAPLATFORM",
        org: "Acme Corp",
        claim: "Lead architect of future-state Data Platform",
        detail: "A data-fabric-plus-lakehouse design on AWS and Snowflake with Iceberg tables",
        tag: { value: "hard", lead: "soft" },
        keywords: [],
      },
    ];
    const text = "Designed lakehouse architecture using Iceberg tables on Snowflake platform.";
    const result = guardSummary(text, STUB_IDENTITY, registryWithDetail);
    expect(result.ok).toBe(true);
  });
});

// ── R8: guardSummary aligned with trace.ts's clause-graft + numeric ─────────
// corroboration hardening (Phase 3 truth-floor hardening round 3).
// guardSummary previously carried its own parallel whole-sentence
// bag-of-words implementation — the same weakness trace.ts had before its
// F2 fix — so a fabricated clause or number grafted onto a real one in a CV
// summary line rode through on the real clause's overlap. guardSummary now
// delegates to traceClaims and inherits its clause-splitting and
// quantity-phrase corroboration.
describe("guardSummary() — R8: third-person/numeric clause-graft rejection", () => {
  it("rejects a third-person clause with a fabricated technology grafted onto a real one via a coordinating conjunction", () => {
    // Clause 1 ("Leads enterprise architecture at Acme Corp") is real and
    // grounds against EVD-ACME-LEADERSHIP. Clause 2 (third-person, "this
    // candidate personally built...") shares zero vocabulary with any
    // registry/identity entry — a wholesale graft that whole-sentence
    // bag-of-words overlap let ride through before R8.
    const text =
      "Leads enterprise architecture at Acme Corp and this candidate personally built a proprietary blockchain settlement network processing twenty billion dollars daily.";
    const result = guardSummary(text, STUB_IDENTITY, REGISTRY);
    expect(result.ok).toBe(false);
    expect(result.ungrounded).toHaveLength(1);
  });

  it("rejects a fabricated spelled-out figure grafted onto a topically-overlapping real clause (numeric corroboration)", () => {
    // Clause 2 genuinely overlaps EVD-ACME-CTRM's vocabulary (ctrm, buy,
    // build, strategy, trade) — enough to have passed the old whole-sentence
    // AND a bare clause-overlap check — but asserts "forty billion dollars",
    // a spelled-out figure (R3) that appears nowhere in EVD-ACME-CTRM's
    // own claim/detail text. The quantity-corroboration check must still
    // reject it even though the clause is topically grounded.
    const text =
      "Leads enterprise architecture at Acme Corp and personally owns the CTRM buy vs build strategy worth forty billion dollars in trade volume.";
    const result = guardSummary(text, STUB_IDENTITY, REGISTRY);
    expect(result.ok).toBe(false);
    expect(result.ungrounded).toHaveLength(1);
  });

  it("still grounds a real compound CV-summary sentence whose second clause is a short continuation, not a graft", () => {
    const text = "Leads enterprise architecture at Acme Corp across data and integration domains.";
    const result = guardSummary(text, STUB_IDENTITY, REGISTRY);
    expect(result.ok).toBe(true);
    expect(result.grounded).toHaveLength(1);
  });
});
