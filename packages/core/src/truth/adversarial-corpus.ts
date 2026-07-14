import type { DriftEntry, EvidenceEntry, Gap, Identity } from "./schemas/index.js";

// ── Shared adversarial-fixture corpus (Phase 3 truth-floor hardening, R1) ───
//
// Bounds the residual risk left by the clause-overlap threshold decision
// (owner: bound with tests, do NOT tighten — tightening over-rejects real
// compound writing). This module is the single source of the confirmed
// known-bypass artifact shapes from the Phase 3 adversarial reviews
// (third-person self-claims, spelled-out-number fabrications, clause grafts,
// honesty whitespace/zero-width evasions, decoy-Grounding lines, duplicate
// headings) — every one of these MUST stay rejected by the generation-guard
// validators and traceClaims/guardSummary forever. It is wired into both
// packages/core's generation-guard unit tests and the FF-GEN-1 fitness
// self-test (fitness/src/checks/generated-artifact-trace.ts) so a regression
// in either surface fails CI, not just one of them.

/**
 * A realistic, multi-entry registry with vocabulary that deliberately
 * overlaps across several unrelated topics — mirroring the real ~30-entry
 * evidence registry (Selfwright-data/truth/evidence/registry.yml). A
 * single-entry registry is NOT sufficient to catch a regression in the
 * clause/quantity layer: its sentence-level ids>=2 threshold alone already
 * rejects a fabricated artifact trivially, masking whether the
 * clause-graft/numeric-corroboration logic actually fired.
 */
export const ADVERSARIAL_BROAD_REGISTRY: EvidenceEntry[] = [
  {
    id: "EVD-ADV-CTRM",
    org: "SyntheticCo",
    claim:
      "Own enterprise CTRM strategy: multi-vendor buy-vs-build hybrid target architecture across the physical trade lifecycle",
    tag: "soft",
    keywords: ["CTRM", "ETRM", "buy vs build", "hybrid target architecture", "physical trade lifecycle"],
  },
  {
    id: "EVD-ADV-POSITIONPNL",
    org: "SyntheticCo",
    claim: "Lead architect for the global Position PnL trading system; re-architected daily to under 30-minute latency",
    tag: "soft",
    keywords: ["position", "P&L", "latency", "data product", "distributed systems", "trading system"],
  },
  {
    id: "EVD-ADV-BACKOFFICE",
    org: "SyntheticCo",
    claim:
      "Designed end-to-end commodity trade process flows for a trading house; middle/back office settlement to the financial ledger",
    tag: "soft",
    keywords: ["trade lifecycle", "back office", "middle office", "settlement", "derivatives"],
  },
  {
    id: "EVD-ADV-ARCHPLATFORM",
    org: "SyntheticCo",
    claim: "Designed and hands-on built an AI-augmented enterprise-architecture platform; now leads the small team that evolves it",
    tag: "soft",
    keywords: ["architecture decision records", "platform", "distributed systems", "microservices"],
  },
];

export const ADVERSARIAL_IDENTITY: Identity = {
  name: "Test User",
  canonical_title: "Architect",
  years_experience: 10,
  headline: "Enterprise Architect",
  seniority_equivalence: "Senior",
  headline_policy: "None",
  also_known_as_titles: [],
  cv_generation_rules: [],
  education: [],
  contact: {
    location: "Amsterdam",
    phone: "555-0100",
    email: "user@localhost",
    linkedin: "https://linkedin.com/in/test",
  },
  citizenship: "EU",
  relocation: [],
  languages: {},
  certifications: [],
  team_sizes: {},
  roles_timeline: [{ company: "SyntheticCo", title: "Architect", period: "2020–present" }],
  honesty_boundaries: [],
  calibration: "None",
};

export const ADVERSARIAL_GAP: Gap = {
  id: "GAP-ADV-001",
  title: "CTRM platform architecture ownership",
  honest_gap: "Limited direct ownership of the CTRM platform architecture",
  frame: "Adjacent exposure through the CTRM strategy and physical trade lifecycle work",
  tag: "soft",
  evidence_ids: ["EVD-ADV-CTRM"],
  company_specific: false,
};

// A retired phrase + drift, kept separate from ADVERSARIAL_BROAD_REGISTRY so
// the honesty-evasion fixtures below don't perturb the quantity/clause
// registry's vocabulary.
export const ADVERSARIAL_RETIRED_PHRASE = "fully autonomous portfolio rebalancing";

export const ADVERSARIAL_RETIRED_REGISTRY: EvidenceEntry[] = [
  {
    id: "EVD-ADV-RETIRED",
    org: "SyntheticCo",
    claim: "Owned portfolio risk analytics tooling for the trading desk",
    tag: "soft",
    keywords: ["portfolio", "risk", "analytics", "trading desk"],
    retired: [`${ADVERSARIAL_RETIRED_PHRASE} — walked back after review`],
  },
];

export const ADVERSARIAL_RETIRED_DRIFT: DriftEntry = {
  id: "DRIFT-ADV-001",
  org: "SyntheticCo",
  claim: "Synthetic retired drift for the adversarial corpus",
  deviates_from: { evidence_ids: ["EVD-ADV-RETIRED"], kind: "embellishment" },
  tag: "soft",
  status: "retired",
  retired_reason: "deprecated terminology",
  keywords: ["clandestine trade execution network"],
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
    ai_reasoning: "Synthetic adversarial-corpus fixture",
  },
  risks: [{ risk: "test", severity: "low", mitigation: "N/A" }],
  applications: [],
};

// ── Known-bypass artifacts (confirmed pre-fix, must stay rejected) ─────────

// Confirmed bypass (Phase 3 adversarial review, F1): a third-person self-claim
// naming "the incoming candidate", grafted onto a topic close enough to a
// real entry to have ridden through whole-sentence keyword overlap before
// candidate-sentence extraction covered third person.
export const ADVERSARIAL_THIRD_PERSON_CLAIM =
  "Rebuilt the trading platform's core matching engine from scratch, cutting settlement latency to under 3 milliseconds, a project led entirely by the incoming candidate for this role.";

// Confirmed bypass (Phase 3 adversarial review round 2, F2 residual; and R3
// round-3 extension to compound cardinals twenty..ninety-nine): a
// second-person self-claim carrying both a spelled-out compound-cardinal
// money figure and a spelled-out bare cardinal, neither of which
// pre-hardening extractQuantityPhrases recognized.
export const ADVERSARIAL_SPELLED_NUMBER_CLAIM =
  "You personally built a proprietary blockchain settlement system processing twenty billion dollars daily and hold forty undisclosed patents in autonomous trading systems.";

// Confirmed bypass (Phase 3 adversarial review, F2): a real, evidence-grounded
// clause with a wholly fabricated clause grafted on via a coordinating
// conjunction — whole-sentence bag-of-words overlap let the fabricated
// clause ride through on the real clause's overlap before clause-splitting.
// Prefixed with "I " (a candidate-reference pronoun) — without one, the
// generation-guard validators that scope truth-trace to candidate-
// referencing sentences (extractCandidateSentences) would silently exclude
// this sentence from scope entirely, making a "must be rejected" assertion
// pass for the wrong reason (never checked, not correctly grounded).
export const ADVERSARIAL_CLAUSE_GRAFT_CLAIM =
  `I ${(ADVERSARIAL_BROAD_REGISTRY[0]?.claim ?? "").replace(/^Own\b/, "own")}, and personally invented a zero-day exploit framework used by three foreign governments.`;

export interface HonestyEvasionVariant {
  label: string;
  text: string;
}

// Confirmed bypass (Phase 3 adversarial review, F3): a retired phrase
// reformatted across a double space, a markdown line-wrap newline, or a
// zero-width Unicode separator evaded a plain substring match. All three
// must still be detected by scanHonestyBoundary (and by every generation
// guard validator that calls it).
export const ADVERSARIAL_HONESTY_EVASIONS: HonestyEvasionVariant[] = [
  { label: "double-space", text: "Delivered fully  autonomous portfolio rebalancing across the trading desk." },
  { label: "newline", text: "Delivered fully\nautonomous portfolio rebalancing across the trading desk." },
  { label: "zero-width-space", text: "Delivered fully​autonomous portfolio rebalancing across the trading desk." },
];

/**
 * Build a prep-pack artifact with a decoy "Grounding:"-style structure: a
 * duplicate "## Gaps to rehearse" heading whose second occurrence has zero
 * ids and carries the clause-graft fabrication. Confirmed bypass (Phase 3
 * adversarial review, F4): a non-global heading match only ever found the
 * FIRST occurrence, so a second section's fabricated body was never
 * id-checked at all.
 */
export function buildAdversarialDuplicateHeadingPrepPack(): string {
  return `## Likely questions
What did you own on the CTRM platform?

## Grounded answers
${ADVERSARIAL_BROAD_REGISTRY[0]?.claim ?? ""}.

## Gaps to rehearse
${ADVERSARIAL_GAP.id}: ${ADVERSARIAL_GAP.frame}, documented in ${ADVERSARIAL_GAP.evidence_ids[0] ?? ""}.

## Gaps to rehearse
${ADVERSARIAL_CLAUSE_GRAFT_CLAIM}
`;
}

/**
 * Build a drill transcript with a decoy "Grounding:" line quoted inside
 * "## My answer" (not the real Coach critique section, which has none).
 * Confirmed bypass (Phase 3 adversarial review, Finding 3): checking
 * Grounding-line presence over the full text let the decoy satisfy the
 * requirement even though the real Coach critique section carried no
 * grounding at all.
 */
export function buildAdversarialDecoyGroundingDrill(): string {
  return `## Question
What did you own on the CTRM platform?

## My answer
${ADVERSARIAL_BROAD_REGISTRY[0]?.claim ?? ""}.

Grounding: EVD-FAKE-DECOY

## Coach critique
${ADVERSARIAL_THIRD_PERSON_CLAIM}
`;
}
