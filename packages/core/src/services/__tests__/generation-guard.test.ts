import { describe, expect, it } from "vitest";
import {
  validateCoverArtifact,
  validateResearchArtifact,
  validatePrepPackArtifact,
  validateDrillArtifact,
  validateGapArtifact,
} from "../generation-guard.js";
import type { EvidenceEntry, Identity, DriftEntry, Gap } from "../../truth/schemas/index.js";
import {
  ADVERSARIAL_BROAD_REGISTRY,
  ADVERSARIAL_IDENTITY,
  ADVERSARIAL_GAP,
  ADVERSARIAL_RETIRED_REGISTRY,
  ADVERSARIAL_THIRD_PERSON_CLAIM,
  ADVERSARIAL_SPELLED_NUMBER_CLAIM,
  ADVERSARIAL_CLAUSE_GRAFT_CLAIM,
  ADVERSARIAL_HONESTY_EVASIONS,
  buildAdversarialDuplicateHeadingPrepPack,
  buildAdversarialDecoyGroundingDrill,
} from "../../truth/adversarial-corpus.js";

const REGISTRY: EvidenceEntry[] = [
  {
    id: "EVD-SYN-COVER-001",
    org: "SyntheticCo",
    claim: "Led the CTRM trading platform integration and architecture",
    tag: "hard",
    keywords: ["ctrm", "trading", "platform", "architecture", "integration"],
  },
  {
    id: "EVD-SYN-COVER-002",
    org: "SyntheticCo",
    claim: "Owned the legacy pricing engine rollout",
    tag: "soft",
    keywords: ["legacy", "pricing", "engine", "rollout"],
    retired: ["legacy pricing engine — replaced by real-time pricing, 2024"],
  },
];

const RETIRED_DRIFT: DriftEntry = {
  id: "DRIFT-SYN-COVER-001",
  org: "SyntheticCo",
  claim: "Synthetic retired drift",
  deviates_from: { evidence_ids: ["EVD-SYN-COVER-001"], kind: "embellishment" },
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

const IDENTITY: Identity = {
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
  roles_timeline: [{ company: "SyntheticCo", title: "Architect", period: "2020–present" }],
  honesty_boundaries: [],
  calibration: "None",
};

// Every content word here is a recognized stopword or <3 chars, so this
// sentence is skipped by traceClaims regardless of the registry — pure
// word-count padding that can never trip the truth-trace check.
const FILLER_SENTENCE = "I am not that or this.";
const TRACEABLE_SENTENCE =
  "I led the CTRM trading platform integration and architecture work for the enterprise.";
const UNTRACEABLE_SENTENCE =
  "I orchestrated a revolutionary blockchain payment protocol overhaul.";

function buildCoverLetter(opts: { fillerCount: number; sentence?: string; opening?: string }): string {
  const sentence = opts.sentence ?? TRACEABLE_SENTENCE;
  const filler = Array.from({ length: opts.fillerCount }, () => FILLER_SENTENCE).join(" ");
  const opening = opts.opening ?? sentence;
  return `${opening} ${filler}`;
}

describe("validateCoverArtifact", () => {
  it("passes a clean, 350-400 word, traceable letter with no banned opening", () => {
    const text = buildCoverLetter({ fillerCount: 60 }); // 13 + 60*6 = 373 words
    const result = validateCoverArtifact(text, { registry: REGISTRY, identity: IDENTITY, drifts: [] });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags an untraceable claim", () => {
    const text = buildCoverLetter({ fillerCount: 60, sentence: UNTRACEABLE_SENTENCE });
    const result = validateCoverArtifact(text, { registry: REGISTRY, identity: IDENTITY, drifts: [] });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("Untraceable"))).toBe(true);
  });

  it("flags a retired evidence-registry phrase", () => {
    const text = buildCoverLetter({
      fillerCount: 55,
      opening: "I owned the legacy pricing engine rollout across three trading desks.",
    });
    const result = validateCoverArtifact(text, { registry: REGISTRY, identity: IDENTITY, drifts: [] });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("retired") && v.includes("legacy pricing engine"))).toBe(
      true,
    );
  });

  it("flags a retired drift keyword", () => {
    const text = buildCoverLetter({
      fillerCount: 55,
      opening: `${TRACEABLE_SENTENCE} I drove innovative synergies across the platform.`,
    });
    const result = validateCoverArtifact(text, { registry: REGISTRY, identity: IDENTITY, drifts: [RETIRED_DRIFT] });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("retired") && v.includes("innovative synergies"))).toBe(
      true,
    );
  });

  it("flags a word count under 350", () => {
    const text = buildCoverLetter({ fillerCount: 5 }); // 13 + 30 = 43 words
    const result = validateCoverArtifact(text, { registry: REGISTRY, identity: IDENTITY, drifts: [] });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("Word count"))).toBe(true);
  });

  it("flags a word count over 400", () => {
    const text = buildCoverLetter({ fillerCount: 100 }); // 13 + 600 = 613 words
    const result = validateCoverArtifact(text, { registry: REGISTRY, identity: IDENTITY, drifts: [] });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("Word count"))).toBe(true);
  });

  it('flags an opening that starts with "I am writing to"', () => {
    const text = buildCoverLetter({
      fillerCount: 55,
      opening: `I am writing to express my interest in this role. ${TRACEABLE_SENTENCE}`,
    });
    const result = validateCoverArtifact(text, { registry: REGISTRY, identity: IDENTITY, drifts: [] });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("I am writing to"))).toBe(true);
  });
});

// A company-only sentence: no first-person pronoun, no candidate name, no
// keyword overlap with REGISTRY. Must never trip truth-trace — research
// documents are mostly sentences like this, about the target company.
const COMPANY_ONLY_SENTENCE =
  "SyntheticCo reported $4.2 billion in revenue in 2025 and operates a large distributed engineering organisation.";

describe("validateResearchArtifact", () => {
  it("passes a clean, traceable research artifact regardless of length", () => {
    // Deliberately short — validateResearchArtifact has no word-count rule.
    const result = validateResearchArtifact(TRACEABLE_SENTENCE, { registry: REGISTRY, identity: IDENTITY });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags an untraceable candidate claim", () => {
    const result = validateResearchArtifact(UNTRACEABLE_SENTENCE, { registry: REGISTRY, identity: IDENTITY });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("Untraceable"))).toBe(true);
  });

  it("flags a retired evidence-registry phrase", () => {
    const result = validateResearchArtifact(
      "The company owned the legacy pricing engine rollout across three trading desks.",
      { registry: REGISTRY, identity: IDENTITY },
    );
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("retired") && v.includes("legacy pricing engine"))).toBe(
      true,
    );
  });

  it("does not apply a word-count rule (a very long clean artifact still passes)", () => {
    const filler = Array.from({ length: 200 }, () => FILLER_SENTENCE).join(" ");
    const result = validateResearchArtifact(`${TRACEABLE_SENTENCE} ${filler}`, {
      registry: REGISTRY,
      identity: IDENTITY,
    });
    expect(result.ok).toBe(true);
  });

  it("does not flag company-only sentences (no candidate reference) as untraceable claims", () => {
    const text = `${COMPANY_ONLY_SENTENCE} ${TRACEABLE_SENTENCE}`;
    const result = validateResearchArtifact(text, { registry: REGISTRY, identity: IDENTITY });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("still flags an untraceable claim when it is the only candidate-referencing sentence", () => {
    const text = `${COMPANY_ONLY_SENTENCE} ${UNTRACEABLE_SENTENCE}`;
    const result = validateResearchArtifact(text, { registry: REGISTRY, identity: IDENTITY });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("Untraceable"))).toBe(true);
  });

  it("does not treat a company fact containing a digit as untraceable", () => {
    // COMPANY_ONLY_SENTENCE contains "$4.2 billion" and "2025" — digits that
    // would otherwise force traceClaims to consider it despite being short/
    // stopword-heavy. It has no candidate reference, so it must be exempt.
    const result = validateResearchArtifact(COMPANY_ONLY_SENTENCE, { registry: REGISTRY, identity: IDENTITY });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("does not false-positive-match the candidate's name as a substring of an unrelated word", () => {
    // IDENTITY.name is "Test User" -- "Test" must not match inside "testing"
    // or "contest" via plain substring inclusion (word-boundary match only).
    const text =
      "SyntheticCo is testing a new contest format for its engineering hiring process this year.";
    const result = validateResearchArtifact(text, { registry: REGISTRY, identity: IDENTITY });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  // F1 regression (Phase 3 adversarial review): a third-person self-claim
  // ("the incoming candidate for this role") previously escaped
  // extractCandidateSentences entirely — the narrow CANDIDATE_PRONOUN set
  // (i/i've/i'm/my/me) never selected it, so it was never truth-traced at
  // all and validateResearchArtifact returned ok:true. Confirmed by running
  // this exact artifact against the pre-fix code.
  it("F1 regression: flags a fabricated third-person self-claim describing 'the incoming candidate'", () => {
    const text =
      "Rebuilt the trading platform's core matching engine from scratch, cutting settlement latency to under 3 milliseconds, a project led entirely by the incoming candidate for this role.";
    const result = validateResearchArtifact(text, { registry: REGISTRY, identity: IDENTITY });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("Untraceable"))).toBe(true);
  });
});

// ── Coaching generation-guard additions (T3.2) ────────────────────────────────
// GAP_FIXTURE is grounded in EVD-SYN-COVER-001 (not EVD-SYN-COVER-002), which
// deliberately avoids EVD-SYN-COVER-002's retired phrase ("legacy pricing
// engine") so a clean gap fixture doesn't accidentally trip the honesty check.
const GAP_FIXTURE: Gap = {
  id: "GAP-SYN-001",
  title: "CTRM platform architecture ownership",
  honest_gap: "Limited direct ownership of the CTRM platform architecture",
  frame: "Adjacent exposure through the CTRM trading platform integration and architecture work",
  tag: "soft",
  evidence_ids: ["EVD-SYN-COVER-001"],
  company_specific: false,
};

// Coach-critique fixtures use "you/your" phrasing (not "I/my/me") to match how
// a coach naturally addresses the candidate, and to exercise the widened
// CANDIDATE_REFERENCE_RE filter rather than the first-person-only one.
//
// Deliberately no coordinating conjunction ("and"/"but"/";") in this
// sentence: clauseSupported()'s overlap bar now matches the sentence-level
// MIN_KEYWORD_OVERLAP (≥2 shared words) per the Phase 3 review round 2 fix,
// so a coordinating conjunction here would split this into two clauses and
// the second half ("architecture work is well-supported") would carry only
// ONE keyword ("architecture") on its own — correctly rejected as an
// under-evidenced clause by the very check this constant exists to exercise
// as PASSING. The single-clause phrasing below keeps all five CTRM/trading/
// platform/architecture/integration keywords in one clause, comfortably
// clearing the bar, while still being candidate-referencing ("Your") and
// still describing the SAME claim as before.
const COACH_TRACEABLE_SENTENCE =
  "Your claim about the CTRM trading platform integration is well-supported by the documented architecture work.";
const COACH_UNTRACEABLE_SENTENCE =
  "However, you also orchestrated a revolutionary blockchain payment protocol overhaul across twelve continents.";

describe("validateGapArtifact", () => {
  it("passes a clean, grounded gap with all evidence ids known", () => {
    const result = validateGapArtifact([GAP_FIXTURE], { registry: REGISTRY, drifts: [] });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags an unknown evidence id in evidence_ids", () => {
    const gap: Gap = { ...GAP_FIXTURE, evidence_ids: ["EVD-DOES-NOT-EXIST"] };
    const result = validateGapArtifact([gap], { registry: REGISTRY, drifts: [] });
    expect(result.ok).toBe(false);
    expect(
      result.violations.some(
        (v) => v.includes("GAP-SYN-001") && v.includes("unknown evidence id EVD-DOES-NOT-EXIST"),
      ),
    ).toBe(true);
  });

  it("flags a retired evidence-registry phrase in honest_gap or frame", () => {
    const gap: Gap = {
      ...GAP_FIXTURE,
      honest_gap: "Owned the legacy pricing engine rollout in a limited capacity",
    };
    const result = validateGapArtifact([gap], { registry: REGISTRY, drifts: [] });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("retired") && v.includes("legacy pricing engine"))).toBe(
      true,
    );
  });

  it("flags a retired drift keyword in honest_gap or frame", () => {
    const gap: Gap = { ...GAP_FIXTURE, frame: `${GAP_FIXTURE.frame} via innovative synergies` };
    const result = validateGapArtifact([gap], { registry: REGISTRY, drifts: [RETIRED_DRIFT] });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("retired") && v.includes("innovative synergies"))).toBe(
      true,
    );
  });

  it("flags a frame not grounded in its own evidence_ids, even if it would trace against a different registry entry", () => {
    // Frame text is about CTRM (EVD-SYN-COVER-001's topic); evidence_ids
    // points at EVD-SYN-COVER-002 (legacy pricing engine) instead — the trace
    // must be scoped to the gap's own evidence_ids, not the whole registry.
    const gap: Gap = { ...GAP_FIXTURE, evidence_ids: ["EVD-SYN-COVER-002"] };
    const result = validateGapArtifact([gap], { registry: REGISTRY, drifts: [] });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("GAP-SYN-001") && v.includes("frame not grounded"))).toBe(
      true,
    );
  });

  it("accumulates violations across multiple gaps, each prefixed with its own gap id", () => {
    const badGap: Gap = { ...GAP_FIXTURE, id: "GAP-SYN-002", evidence_ids: ["EVD-MISSING"] };
    const result = validateGapArtifact([GAP_FIXTURE, badGap], { registry: REGISTRY, drifts: [] });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.startsWith("GAP-SYN-002:"))).toBe(true);
    expect(result.violations.some((v) => v.startsWith("GAP-SYN-001:"))).toBe(false);
  });

  it("passes trivially with an empty gaps array", () => {
    const result = validateGapArtifact([], { registry: REGISTRY, drifts: [] });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  // Minor fix (Phase 3 adversarial review): validateGapArtifact previously
  // truth-traced only `frame`, never `honest_gap` — a fabricated honest_gap
  // grounded in nothing sailed through unexamined as long as `frame` traced.
  it("flags an honest_gap not grounded in its own evidence_ids, even when frame traces cleanly", () => {
    const gap: Gap = {
      ...GAP_FIXTURE,
      honest_gap: "Personally architected a proprietary quantum settlement network spanning 40 exchanges",
    };
    const result = validateGapArtifact([gap], { registry: REGISTRY, drifts: [] });
    expect(result.ok).toBe(false);
    expect(
      result.violations.some((v) => v.includes("GAP-SYN-001") && v.includes("honest_gap not grounded")),
    ).toBe(true);
  });
});

describe("validatePrepPackArtifact", () => {
  const baseCtx = { registry: REGISTRY, identity: IDENTITY, drifts: [] as DriftEntry[], gaps: [GAP_FIXTURE] };

  function interviewPrepPack(opts?: { gapsSection?: string }): string {
    const gapsSection =
      opts?.gapsSection ??
      `## Gaps to rehearse
GAP-SYN-001: Limited direct ownership of the CTRM platform architecture, with adjacent exposure through EVD-SYN-COVER-001's CTRM trading platform integration and architecture work.
`;
    return `## Likely questions
What did you own on the CTRM platform?

## Grounded answers
${TRACEABLE_SENTENCE}

${gapsSection}`;
  }

  it("passes a clean, grounded interview prep-pack with a well-formed Gaps to rehearse section", () => {
    const result = validatePrepPackArtifact(interviewPrepPack(), { ...baseCtx, kind: "interview" });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags a retired evidence-registry phrase", () => {
    const text = interviewPrepPack().replace(
      TRACEABLE_SENTENCE,
      "I owned the legacy pricing engine rollout across three trading desks.",
    );
    const result = validatePrepPackArtifact(text, { ...baseCtx, kind: "interview" });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("retired") && v.includes("legacy pricing engine"))).toBe(
      true,
    );
  });

  it("flags a retired drift keyword", () => {
    const text = interviewPrepPack().replace(
      TRACEABLE_SENTENCE,
      `${TRACEABLE_SENTENCE} I drove innovative synergies across the platform.`,
    );
    const result = validatePrepPackArtifact(text, { ...baseCtx, kind: "interview", drifts: [RETIRED_DRIFT] });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("retired") && v.includes("innovative synergies"))).toBe(
      true,
    );
  });

  it("flags an untraceable candidate-referencing claim", () => {
    const text = interviewPrepPack().replace(TRACEABLE_SENTENCE, UNTRACEABLE_SENTENCE);
    const result = validatePrepPackArtifact(text, { ...baseCtx, kind: "interview" });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("Untraceable"))).toBe(true);
  });

  it("flags when no EVD-* id is cited anywhere", () => {
    const text = `## Likely questions
Tell me about your background.

## Grounded answers
The company values broad experience.
`;
    const result = validatePrepPackArtifact(text, { ...baseCtx, kind: "networking" });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("No evidence cited"))).toBe(true);
  });

  it("flags a missing 'Gaps to rehearse' section for an interview prep-pack", () => {
    const text = `## Likely questions
What did you own?

## Grounded answers
${TRACEABLE_SENTENCE}
`;
    const result = validatePrepPackArtifact(text, { ...baseCtx, kind: "interview" });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes('Missing required "Gaps to rehearse" section'))).toBe(
      true,
    );
  });

  it("does not require a 'Gaps to rehearse' section for a networking prep-pack", () => {
    const text = `## Likely questions
Who should you meet at the event?

## Grounded answers
${TRACEABLE_SENTENCE} This is documented in EVD-SYN-COVER-001.
`;
    const result = validatePrepPackArtifact(text, { ...baseCtx, kind: "networking" });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('flags a "Gaps to rehearse" section missing a GAP-* id', () => {
    const text = interviewPrepPack({
      gapsSection: `## Gaps to rehearse
Limited direct ownership of the CTRM platform architecture, per EVD-SYN-COVER-001.
`,
    });
    const result = validatePrepPackArtifact(text, { ...baseCtx, kind: "interview" });
    expect(result.ok).toBe(false);
    expect(
      result.violations.some((v) => v.includes('"Gaps to rehearse" section missing') && v.includes("GAP-*")),
    ).toBe(true);
  });

  it('flags a "Gaps to rehearse" section missing an EVD-* id', () => {
    const text = interviewPrepPack({
      gapsSection: `## Gaps to rehearse
GAP-SYN-001: Limited direct ownership of the CTRM platform architecture.
`,
    });
    const result = validatePrepPackArtifact(text, { ...baseCtx, kind: "interview" });
    expect(result.ok).toBe(false);
    expect(
      result.violations.some((v) => v.includes('"Gaps to rehearse" section missing') && v.includes("EVD-*")),
    ).toBe(true);
  });

  it('enforces the same grounding rule on an optional "Gaps to rehearse" section for a networking prep-pack, scoped to before the next heading', () => {
    const text = `## Likely questions
Who should I meet?

## Grounded answers
${TRACEABLE_SENTENCE}

## Gaps to rehearse
GAP-SYN-001: Limited direct ownership of the CTRM platform architecture.

## Evidence used
EVD-SYN-COVER-001 documents the CTRM trading platform integration and architecture work.
`;
    const result = validatePrepPackArtifact(text, { ...baseCtx, kind: "networking" });
    expect(result.ok).toBe(false);
    expect(
      result.violations.some((v) => v.includes('"Gaps to rehearse" section missing') && v.includes("EVD-*")),
    ).toBe(true);
  });

  it("flags an unknown EVD-* id anywhere in the text", () => {
    const text = interviewPrepPack() + "\nAlso see EVD-UNKNOWN-999 for more.\n";
    const result = validatePrepPackArtifact(text, { ...baseCtx, kind: "interview" });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("unknown id: EVD-UNKNOWN-999"))).toBe(true);
  });

  it("flags an unknown GAP-* id anywhere in the text", () => {
    const text = interviewPrepPack() + "\nAlso see GAP-UNKNOWN-999 for more.\n";
    const result = validatePrepPackArtifact(text, { ...baseCtx, kind: "interview" });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("unknown id: GAP-UNKNOWN-999"))).toBe(true);
  });

  // F1 regression (Phase 3 adversarial review): validatePrepPackArtifact used
  // the NARROW first-person-only CANDIDATE_PRONOUN set, so a second-person
  // over-claim ("You personally built...") inside the "Gaps to rehearse"
  // section was never selected for truth-trace at all — confirmed to return
  // ok:true against the pre-fix code.
  it("F1 regression: flags a fabricated second-person self-claim inside the Gaps to rehearse section", () => {
    const text = interviewPrepPack({
      gapsSection: `## Gaps to rehearse
GAP-SYN-001: Limited direct ownership of the CTRM platform architecture, with adjacent exposure through EVD-SYN-COVER-001's CTRM trading platform integration and architecture work. You personally built a proprietary blockchain settlement system processing two billion dollars daily and hold three undisclosed patents in autonomous trading systems.
`,
    });
    const result = validatePrepPackArtifact(text, { ...baseCtx, kind: "interview" });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("Untraceable"))).toBe(true);
  });

  // Minor fix (Phase 3 adversarial review): a lowercase/mixed-case "evd-"/
  // "gap-" prefix previously evaded assertIdsExist's uppercase-only regex
  // entirely — invisible rather than flagged.
  it("flags a lowercase evd- citation as a malformed id rather than silently ignoring it", () => {
    const text = interviewPrepPack() + "\nAlso see evd-does-not-exist for more.\n";
    const result = validatePrepPackArtifact(text, { ...baseCtx, kind: "interview" });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("malformed id") && v.includes("evd-does-not-exist"))).toBe(
      true,
    );
  });

  it("does not flag an ordinary hyphenated word starting with 'gap' as a malformed id", () => {
    const text = interviewPrepPack() + "\nThere is a coverage gap-analysis pending review.\n";
    const result = validatePrepPackArtifact(text, { ...baseCtx, kind: "interview" });
    expect(result.violations.some((v) => v.includes("malformed id"))).toBe(false);
  });

  // R4 (Phase 3 truth-floor hardening round 3): the case-mismatch scan
  // previously required >=2 hyphens (3 segments), so a lowercase SINGLE-hyphen
  // citation ("evd-acme", "gap-042") — also a schema-legal id shape — was
  // invisible. Broadened to flag a single-hyphen match too, but only when the
  // segment after the hyphen structurally looks like an id token (contains a
  // digit or an uppercase letter) rather than an ordinary English compound.
  it("flags a lowercase evd- citation with a multi-segment id shape (regression: still flagged)", () => {
    const text = interviewPrepPack() + "\nAlso see evd-acme-001 for more.\n";
    const result = validatePrepPackArtifact(text, { ...baseCtx, kind: "interview" });
    expect(result.ok).toBe(false);
    expect(
      result.violations.some((v) => v.includes("malformed id") && v.includes("evd-acme-001")),
    ).toBe(true);
  });

  it("flags a lowercase evd- citation with a single hyphen and a digit segment", () => {
    const text = interviewPrepPack() + "\nAlso see evd-042 for more.\n";
    const result = validatePrepPackArtifact(text, { ...baseCtx, kind: "interview" });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("malformed id") && v.includes("evd-042"))).toBe(
      true,
    );
  });

  it("flags a mixed-case gap- citation with a single hyphen and an uppercase segment", () => {
    const text = interviewPrepPack() + "\nAlso see gap-SYN for more.\n";
    const result = validatePrepPackArtifact(text, { ...baseCtx, kind: "interview" });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("malformed id") && v.includes("gap-SYN"))).toBe(
      true,
    );
  });

  it("does not flag 'gap-year' in ordinary prose as a malformed id", () => {
    const text = interviewPrepPack() + "\nThere was a gap-year before starting the role.\n";
    const result = validatePrepPackArtifact(text, { ...baseCtx, kind: "interview" });
    expect(result.violations.some((v) => v.includes("malformed id"))).toBe(false);
  });

  it("does not flag 'gap analysis' (space, no hyphen) in ordinary prose as a malformed id", () => {
    const text = interviewPrepPack() + "\nA gap analysis was performed.\n";
    const result = validatePrepPackArtifact(text, { ...baseCtx, kind: "interview" });
    expect(result.violations.some((v) => v.includes("malformed id"))).toBe(false);
  });

  it("does not flag 'e-commerce' in ordinary prose as a malformed id", () => {
    const text = interviewPrepPack() + "\nThe platform also serves e-commerce clients.\n";
    const result = validatePrepPackArtifact(text, { ...baseCtx, kind: "interview" });
    expect(result.violations.some((v) => v.includes("malformed id"))).toBe(false);
  });

  // F4 regression (Phase 3 adversarial review): the id-presence check in the
  // "Gaps to rehearse" section only ever looked at the FIRST occurrence of
  // the heading (text.search() / a non-global regex) — a second, later
  // "## Gaps to rehearse" section's body was never id-checked at all.
  it("F4 regression: flags a second 'Gaps to rehearse' section with zero ids and fabricated content", () => {
    const text = `${interviewPrepPack()}
## Gaps to rehearse
I personally invented a zero-day exploit framework used by three governments.
`;
    const result = validatePrepPackArtifact(text, { ...baseCtx, kind: "interview" });
    expect(result.ok).toBe(false);
    expect(
      result.violations.some((v) => v.includes('"Gaps to rehearse" section missing') && v.includes("GAP-*")),
    ).toBe(true);
  });
});

describe("validateDrillArtifact", () => {
  const CLEAN_DRILL_TRANSCRIPT = `## Question
What was your ownership on the CTRM platform integration?

## My answer
${TRACEABLE_SENTENCE}

## Coach critique
${COACH_TRACEABLE_SENTENCE}

Grounding: EVD-SYN-COVER-001
`;

  it("passes a clean, grounded, well-formed drill transcript", () => {
    const result = validateDrillArtifact(CLEAN_DRILL_TRANSCRIPT, {
      registry: REGISTRY,
      identity: IDENTITY,
      drifts: [],
      gaps: [],
    });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags every missing required heading", () => {
    const text = "Just some random prose with no structure.";
    const result = validateDrillArtifact(text, { registry: REGISTRY, identity: IDENTITY, drifts: [], gaps: [] });
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([
      "Missing required heading: ## Question",
      "Missing required heading: ## My answer",
      "Missing required heading: ## Coach critique",
    ]);
  });

  it("flags a retired evidence-registry phrase within the coach critique", () => {
    const text = `## Question
What was your ownership on the CTRM platform integration?

## My answer
${TRACEABLE_SENTENCE}

## Coach critique
${COACH_TRACEABLE_SENTENCE} However, you also described it as owning the legacy pricing engine rollout, which is a retired framing.

Grounding: EVD-SYN-COVER-001
`;
    const result = validateDrillArtifact(text, { registry: REGISTRY, identity: IDENTITY, drifts: [], gaps: [] });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("retired") && v.includes("legacy pricing engine"))).toBe(
      true,
    );
  });

  it("flags a retired drift keyword within the coach critique", () => {
    const text = `## Question
What was your ownership on the CTRM platform integration?

## My answer
${TRACEABLE_SENTENCE}

## Coach critique
${COACH_TRACEABLE_SENTENCE} Avoid describing it with innovative synergies language going forward.

Grounding: EVD-SYN-COVER-001
`;
    const result = validateDrillArtifact(text, {
      registry: REGISTRY,
      identity: IDENTITY,
      drifts: [RETIRED_DRIFT],
      gaps: [],
    });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("retired") && v.includes("innovative synergies"))).toBe(
      true,
    );
  });

  it("flags an unknown EVD-* id in the Grounding line", () => {
    const text = `## Question
What was your ownership on the CTRM platform integration?

## My answer
${TRACEABLE_SENTENCE}

## Coach critique
${COACH_TRACEABLE_SENTENCE}

Grounding: EVD-DOES-NOT-EXIST
`;
    const result = validateDrillArtifact(text, { registry: REGISTRY, identity: IDENTITY, drifts: [], gaps: [] });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("unknown id: EVD-DOES-NOT-EXIST"))).toBe(true);
  });

  it("flags an unknown GAP-* id in the Grounding line", () => {
    const text = `## Question
What was your ownership on the CTRM platform integration?

## My answer
${TRACEABLE_SENTENCE}

## Coach critique
${COACH_TRACEABLE_SENTENCE}

Grounding: GAP-DOES-NOT-EXIST
`;
    const result = validateDrillArtifact(text, { registry: REGISTRY, identity: IDENTITY, drifts: [], gaps: [] });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("unknown id: GAP-DOES-NOT-EXIST"))).toBe(true);
  });

  it("accepts a Grounding line that cites a known GAP-* id alongside a known EVD-* id", () => {
    const text = `## Question
What was your ownership on the CTRM platform integration?

## My answer
I have limited direct ownership of the CTRM platform architecture.

## Coach critique
${COACH_TRACEABLE_SENTENCE}

Grounding: GAP-SYN-001, EVD-SYN-COVER-001
`;
    const result = validateDrillArtifact(text, {
      registry: REGISTRY,
      identity: IDENTITY,
      drifts: [],
      gaps: [GAP_FIXTURE],
    });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("does not mistake a known id followed by a hyphenated suffix for an unknown id (Grounding line)", () => {
    const text = `## Question
What was your ownership on the CTRM platform integration?

## My answer
${TRACEABLE_SENTENCE}

## Coach critique
${COACH_TRACEABLE_SENTENCE}

Grounding: EVD-SYN-COVER-001-verified
`;
    const result = validateDrillArtifact(text, { registry: REGISTRY, identity: IDENTITY, drifts: [], gaps: [] });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("Finding 3 regression: a decoy 'Grounding:' line inside '## My answer' does not satisfy the requirement when the real Coach critique section has none", () => {
    const text = `## Question
What was your ownership on the CTRM platform integration?

## My answer
${TRACEABLE_SENTENCE}
Grounding: EVD-FAKE-DECOY

## Coach critique
This is a reasonable, well-supported answer with no overclaim.
`;
    const result = validateDrillArtifact(text, { registry: REGISTRY, identity: IDENTITY, drifts: [], gaps: [] });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("Missing required 'Grounding:' line"))).toBe(true);
  });

  it("Finding 4 regression: a decoy '## Coach critique' quoted inline inside '## My answer' does not hijack the section boundary — the real, later heading is used", () => {
    const text = `## Question
What was your ownership on the CTRM platform integration?

## My answer
${TRACEABLE_SENTENCE} I recall a past review template that had a line reading "## Coach critique" where reviewers left notes. ${UNTRACEABLE_SENTENCE}

## Coach critique
${COACH_TRACEABLE_SENTENCE}

Grounding: EVD-SYN-COVER-001
`;
    const result = validateDrillArtifact(text, { registry: REGISTRY, identity: IDENTITY, drifts: [], gaps: [] });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("Finding 5 regression: an unsupported second-person claim in the coach critique is flagged as untraceable even with no first-person pronoun or candidate name", () => {
    const text = `## Question
What was your ownership on the CTRM platform integration?

## My answer
${TRACEABLE_SENTENCE}

## Coach critique
${COACH_TRACEABLE_SENTENCE} ${COACH_UNTRACEABLE_SENTENCE}

Grounding: EVD-SYN-COVER-001
`;
    const result = validateDrillArtifact(text, { registry: REGISTRY, identity: IDENTITY, drifts: [], gaps: [] });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("Untraceable"))).toBe(true);
  });

  // F1 regression (Phase 3 adversarial review): the drill validator's widened
  // COACH_CRITIQUE_PRONOUN set covered first- and second-person but not
  // third-person ("This candidate personally rebuilt..."), so a third-person
  // over-claim in the coach critique escaped truth-trace entirely —
  // confirmed to return ok:true against the pre-fix code.
  it("F1 regression: flags a fabricated third-person self-claim ('this candidate') in the coach critique", () => {
    const text = `## Question
What was your ownership on the CTRM platform integration?

## My answer
${TRACEABLE_SENTENCE}

## Coach critique
${COACH_TRACEABLE_SENTENCE} This candidate personally rebuilt the trading platform's core matching engine to sub-3ms.

Grounding: EVD-SYN-COVER-001
`;
    const result = validateDrillArtifact(text, { registry: REGISTRY, identity: IDENTITY, drifts: [], gaps: [] });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("Untraceable"))).toBe(true);
  });
});

// ── R1: shared adversarial-fixture corpus (Phase 3 truth-floor hardening
// round 3) ────────────────────────────────────────────────────────────────
// Bounds the clause-overlap threshold residual with a permanent regression
// barrier instead of tightening the threshold (owner decision: bound with
// tests, do NOT tighten — tightening over-rejects real compound writing).
// ../../truth/adversarial-corpus.js is the single source for these
// known-bypass artifacts; it is wired into both this unit-test suite and the
// FF-GEN-1 fitness self-test (fitness/src/checks/generated-artifact-trace.ts)
// so a regression in either surface fails CI.
describe("R1: adversarial-fixture corpus (must stay rejected)", () => {
  const researchCtx = { registry: ADVERSARIAL_BROAD_REGISTRY, identity: ADVERSARIAL_IDENTITY };

  it("validateResearchArtifact rejects the third-person self-claim artifact", () => {
    const result = validateResearchArtifact(ADVERSARIAL_THIRD_PERSON_CLAIM, researchCtx);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("Untraceable"))).toBe(true);
  });

  it("validateResearchArtifact rejects the spelled-out compound-number fabrication artifact", () => {
    const result = validateResearchArtifact(ADVERSARIAL_SPELLED_NUMBER_CLAIM, researchCtx);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("Untraceable"))).toBe(true);
  });

  it("validateResearchArtifact rejects the clause-graft fabrication artifact", () => {
    const result = validateResearchArtifact(ADVERSARIAL_CLAUSE_GRAFT_CLAIM, researchCtx);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("Untraceable"))).toBe(true);
  });

  it("validateCoverArtifact rejects a cover letter built around the third-person self-claim artifact", () => {
    const filler = Array.from(
      { length: 55 },
      () => "I led the CTRM strategy work for the enterprise team.",
    ).join(" ");
    const text = `${ADVERSARIAL_THIRD_PERSON_CLAIM} ${filler}`;
    const result = validateCoverArtifact(text, { ...researchCtx, drifts: [] });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("Untraceable"))).toBe(true);
  });

  for (const variant of ADVERSARIAL_HONESTY_EVASIONS) {
    it(`validateCoverArtifact rejects a retired phrase evaded via ${variant.label}`, () => {
      const filler = Array.from(
        { length: 55 },
        () => "I led the CTRM strategy work for the enterprise team.",
      ).join(" ");
      const text = `${variant.text} ${filler}`;
      const result = validateCoverArtifact(text, {
        registry: ADVERSARIAL_RETIRED_REGISTRY,
        identity: ADVERSARIAL_IDENTITY,
        drifts: [],
      });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.includes("retired"))).toBe(true);
    });
  }

  it("validatePrepPackArtifact rejects a duplicate 'Gaps to rehearse' section carrying the clause-graft fabrication", () => {
    const text = buildAdversarialDuplicateHeadingPrepPack();
    const result = validatePrepPackArtifact(text, {
      registry: ADVERSARIAL_BROAD_REGISTRY,
      identity: ADVERSARIAL_IDENTITY,
      drifts: [],
      gaps: [ADVERSARIAL_GAP],
      kind: "interview",
    });
    expect(result.ok).toBe(false);
  });

  it("validateDrillArtifact rejects a decoy 'Grounding:' line quoted inside '## My answer'", () => {
    const text = buildAdversarialDecoyGroundingDrill();
    const result = validateDrillArtifact(text, {
      registry: ADVERSARIAL_BROAD_REGISTRY,
      identity: ADVERSARIAL_IDENTITY,
      drifts: [],
      gaps: [],
    });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("Missing required 'Grounding:' line"))).toBe(true);
  });

  it("sanity: a clean, evidence-grounded sentence from the broad registry still passes (false-positive bound)", () => {
    const cleanSentence = `I ${(ADVERSARIAL_BROAD_REGISTRY[0]?.claim ?? "").replace(/^Own\b/, "own")}.`;
    const result = validateResearchArtifact(cleanSentence, researchCtx);
    expect(result.ok).toBe(true);
  });
});
