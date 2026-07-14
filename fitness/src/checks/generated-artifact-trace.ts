// FF-GEN-1: generated-artifact truth-trace (Task 6, extended Phase 3 review).
// Self-test over synthetic fixtures, one clean-pass + one adversarial-reject
// pair per validator, covering ALL SIX generation-guard validators
// (validateCoverArtifact, validateResearchArtifact, validatePrepPackArtifact,
// validateDrillArtifact, validateGapArtifact, validateTopicsArtifact).
// Previously this check only exercised validateCoverArtifact — a regression
// in any of the other five validators (e.g. the F1/F2/F3/F4 bypasses found
// in the Phase 3 adversarial review) would not have failed the build. This
// is the CI-side guarantee that produced artifacts are validated even though
// generation is no longer behind LlmPort (co-piloted generation, D-1) — the
// validator is the constant; the generator is now pluggable.
import {
  validateCoverArtifact,
  validateResearchArtifact,
  validatePrepPackArtifact,
  validateDrillArtifact,
  validateGapArtifact,
  validateTopicsArtifact,
} from "@selfwright/core";
import type { EvidenceEntry, Identity, Gap } from "@selfwright/core";
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
} from "@selfwright/core/truth/adversarial-corpus";
import type { CheckResult } from "./shared.js";

const CHECK_NAME =
  "FF-GEN-1: generated-artifact truth-trace (all six generation-guard validators)";

const REGISTRY: EvidenceEntry[] = [
  {
    id: "EVD-FFG1-001",
    org: "SyntheticCo",
    claim: "Led the CTRM trading platform integration and architecture",
    tag: "hard",
    keywords: ["ctrm", "trading", "platform", "architecture", "integration"],
  },
];

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
  contact: { location: "Amsterdam", phone: "555-0100", email: "user@localhost", linkedin: "https://linkedin.com/in/test" },
  citizenship: "EU",
  relocation: [],
  languages: {},
  certifications: [],
  team_sizes: {},
  roles_timeline: [{ company: "SyntheticCo", title: "Architect", period: "2020–present" }],
  honesty_boundaries: [],
  calibration: "None",
};

// A realistic, multi-entry registry with vocabulary that deliberately
// overlaps across several unrelated topics — mirroring the real ~30-entry
// evidence registry (Selfwright-data/truth/evidence/registry.yml). The
// single-entry REGISTRY above is NOT sufficient to catch a regression in the
// clause/quantity layer (Phase 3 review round 2): its sentence-level ids>=2
// threshold alone already rejects a fabricated artifact, masking whether the
// clause-graft/numeric-corroboration logic actually fired. Sourced from
// packages/core/src/truth/adversarial-corpus.ts (R1, Phase 3 truth-floor
// hardening round 3) — the single shared source for this broad registry and
// the confirmed known-bypass artifacts below, also wired into
// packages/core's generation-guard unit tests.
const BROAD_REGISTRY: EvidenceEntry[] = ADVERSARIAL_BROAD_REGISTRY;

const GAP_FIXTURE: Gap = {
  id: "GAP-FFG1-001",
  title: "CTRM platform architecture ownership",
  honest_gap: "Limited direct ownership of the CTRM platform architecture",
  frame: "Adjacent exposure through the CTRM trading platform integration and architecture work",
  tag: "soft",
  evidence_ids: ["EVD-FFG1-001"],
  company_specific: false,
};

// Every content word here is a recognized stopword or <3 chars, so this
// sentence is skipped by traceClaims regardless of the registry — pure
// word-count padding that can never trip the truth-trace check.
const FILLER_SENTENCE = "I am not that or this.";
const TRACEABLE_SENTENCE =
  "I led the CTRM trading platform integration and architecture work for the enterprise.";
// Confirmed bypass artifact (Phase 3 adversarial review, F1/F2): a
// third-person self-claim naming "the incoming candidate" carrying a
// fabricated figure — grafted onto a topic (trading platform) close enough
// to REGISTRY to have ridden through whole-sentence keyword overlap before.
const UNTRACEABLE_THIRD_PERSON_SENTENCE =
  "Rebuilt the trading platform's core matching engine from scratch, cutting settlement latency to under 3 milliseconds, a project led entirely by the incoming candidate for this role.";
// Confirmed bypass artifact (Phase 3 adversarial review round 2, F2
// residual): a spelled-out figure ("two billion dollars") and a bare
// spelled-out cardinal ("three undisclosed patents") produced zero
// extractQuantityPhrases hits pre-fix, and clauseSupported's ≥1-overlap bar
// let the clause ride through on one incidentally-shared word against a
// broad, multi-entry registry.
const SPELLED_OUT_NUMBER_BYPASS_SENTENCE =
  "You personally built a proprietary blockchain settlement system processing two billion dollars daily and hold three undisclosed patents in autonomous trading systems.";

function buildLetter(openingSentence: string, fillerCount: number): string {
  const filler = Array.from({ length: fillerCount }, () => FILLER_SENTENCE).join(" ");
  return `${openingSentence} ${filler}`;
}

function fail(detail: string): CheckResult {
  return { name: CHECK_NAME, passed: false, details: detail };
}

function checkCover(): string | null {
  const clean = buildLetter(TRACEABLE_SENTENCE, 60); // 373 words, in the 350-400 range
  const cleanResult = validateCoverArtifact(clean, { registry: REGISTRY, identity: IDENTITY, drifts: [] });
  if (!cleanResult.ok) {
    return `validateCoverArtifact: clean synthetic cover artifact failed: ${cleanResult.violations.join("; ")}`;
  }

  const untraceable = buildLetter(UNTRACEABLE_THIRD_PERSON_SENTENCE, 60);
  const untraceableResult = validateCoverArtifact(untraceable, { registry: REGISTRY, identity: IDENTITY, drifts: [] });
  if (untraceableResult.ok) {
    return "validateCoverArtifact: an untraceable claim was NOT flagged";
  }
  if (!untraceableResult.violations.some((v) => v.includes("Untraceable"))) {
    return `validateCoverArtifact: untraceable artifact rejected for the wrong reason: ${untraceableResult.violations.join("; ")}`;
  }
  return null;
}

function checkResearch(): string | null {
  const cleanResult = validateResearchArtifact(TRACEABLE_SENTENCE, { registry: REGISTRY, identity: IDENTITY });
  if (!cleanResult.ok) {
    return `validateResearchArtifact: clean synthetic research artifact failed: ${cleanResult.violations.join("; ")}`;
  }

  // Adversarial: third-person self-claim ("the incoming candidate") — the
  // confirmed F1 bypass. Must be flagged now that candidate-sentence
  // extraction covers third person.
  const untraceableResult = validateResearchArtifact(UNTRACEABLE_THIRD_PERSON_SENTENCE, {
    registry: REGISTRY,
    identity: IDENTITY,
  });
  if (untraceableResult.ok) {
    return "validateResearchArtifact: a third-person untraceable self-claim was NOT flagged";
  }
  if (!untraceableResult.violations.some((v) => v.includes("Untraceable"))) {
    return `validateResearchArtifact: untraceable artifact rejected for the wrong reason: ${untraceableResult.violations.join("; ")}`;
  }
  return null;
}

function buildPrepPack(gapsSectionExtra: string): string {
  return `## Likely questions
What did you own on the CTRM platform?

## Grounded answers
${TRACEABLE_SENTENCE}

## Gaps to rehearse
GAP-FFG1-001: Limited direct ownership of the CTRM platform architecture, with adjacent exposure through EVD-FFG1-001's CTRM trading platform integration and architecture work.${gapsSectionExtra}
`;
}

function checkPrepPack(): string | null {
  const cleanCtx = { registry: REGISTRY, identity: IDENTITY, drifts: [], gaps: [GAP_FIXTURE], kind: "interview" as const };
  const cleanResult = validatePrepPackArtifact(buildPrepPack(""), cleanCtx);
  if (!cleanResult.ok) {
    return `validatePrepPackArtifact: clean synthetic prep-pack failed: ${cleanResult.violations.join("; ")}`;
  }

  // Adversarial: confirmed F1 bypass — a second-person self-claim inside the
  // "Gaps to rehearse" section, previously invisible to the narrow
  // first-person-only pronoun set.
  const untraceableText = buildPrepPack(` ${SPELLED_OUT_NUMBER_BYPASS_SENTENCE}`);
  const untraceableResult = validatePrepPackArtifact(untraceableText, cleanCtx);
  if (untraceableResult.ok) {
    return "validatePrepPackArtifact: a second-person untraceable self-claim was NOT flagged";
  }
  if (!untraceableResult.violations.some((v) => v.includes("Untraceable"))) {
    return `validatePrepPackArtifact: untraceable artifact rejected for the wrong reason: ${untraceableResult.violations.join("; ")}`;
  }
  return null;
}

function buildDrill(coachExtra: string): string {
  return `## Question
What was your ownership on the CTRM platform integration?

## My answer
${TRACEABLE_SENTENCE}

## Coach critique
This claim is well-supported by EVD-FFG1-001.${coachExtra}

Grounding: EVD-FFG1-001
`;
}

function checkDrill(): string | null {
  const ctx = { registry: REGISTRY, identity: IDENTITY, drifts: [], gaps: [] };
  const cleanResult = validateDrillArtifact(buildDrill(""), ctx);
  if (!cleanResult.ok) {
    return `validateDrillArtifact: clean synthetic drill transcript failed: ${cleanResult.violations.join("; ")}`;
  }

  // Adversarial: confirmed F1 bypass — a third-person self-claim ("this
  // candidate") in the coach critique, previously invisible to the
  // first+second-person-only pronoun set.
  const untraceableText = buildDrill(
    " This candidate personally rebuilt the trading platform's core matching engine to sub-3ms.",
  );
  const untraceableResult = validateDrillArtifact(untraceableText, ctx);
  if (untraceableResult.ok) {
    return "validateDrillArtifact: a third-person untraceable self-claim was NOT flagged";
  }
  if (!untraceableResult.violations.some((v) => v.includes("Untraceable"))) {
    return `validateDrillArtifact: untraceable artifact rejected for the wrong reason: ${untraceableResult.violations.join("; ")}`;
  }
  return null;
}

function checkGap(): string | null {
  const cleanResult = validateGapArtifact([GAP_FIXTURE], { registry: REGISTRY, drifts: [] });
  if (!cleanResult.ok) {
    return `validateGapArtifact: clean synthetic gap row failed: ${cleanResult.violations.join("; ")}`;
  }

  // Adversarial: honest_gap not grounded in evidence_ids (minor finding —
  // previously honest_gap was never traced at all, only frame).
  const badGap: Gap = {
    ...GAP_FIXTURE,
    honest_gap: "Personally architected a proprietary quantum settlement network spanning 40 exchanges",
  };
  const badResult = validateGapArtifact([badGap], { registry: REGISTRY, drifts: [] });
  if (badResult.ok) {
    return "validateGapArtifact: an ungrounded honest_gap was NOT flagged";
  }
  if (!badResult.violations.some((v) => v.includes("honest_gap not grounded"))) {
    return `validateGapArtifact: ungrounded honest_gap rejected for the wrong reason: ${badResult.violations.join("; ")}`;
  }
  return null;
}

function buildTopics(writeSectionExtra: string): string {
  return [
    "## Topics to write",
    "",
    `- Treasury platform: credibly grounded topic. EVD-FFG1-001 https://example.com/notes${writeSectionExtra}`,
    "",
    "## Topics to read",
    "",
    "- Adjacent learning topic GAP-FFG1-001 https://example.com/learning",
    "- Second reading item https://example.com/reading",
    "",
    "Grounding: EVD-FFG1-001, GAP-FFG1-001",
  ].join("\n");
}

function checkTopics(): string | null {
  const ctx = { registry: REGISTRY, identity: IDENTITY, drifts: [], gaps: [GAP_FIXTURE] };
  const cleanResult = validateTopicsArtifact(buildTopics(""), ctx);
  if (!cleanResult.ok) {
    return `validateTopicsArtifact: clean synthetic topics digest failed: ${cleanResult.violations.join("; ")}`;
  }

  // Adversarial: confirmed F1 bypass — a third-person self-claim, standalone
  // prose in the write section.
  const untraceableText = [
    "## Topics to write",
    "",
    "- Treasury platform: credibly grounded topic. EVD-FFG1-001 https://example.com/notes",
    "",
    UNTRACEABLE_THIRD_PERSON_SENTENCE,
    "",
    "## Topics to read",
    "",
    "- Adjacent learning topic GAP-FFG1-001 https://example.com/learning",
    "- Second reading item https://example.com/reading",
    "",
    "Grounding: EVD-FFG1-001, GAP-FFG1-001",
  ].join("\n");
  const untraceableResult = validateTopicsArtifact(untraceableText, ctx);
  if (untraceableResult.ok) {
    return "validateTopicsArtifact: a third-person untraceable self-claim was NOT flagged";
  }
  if (!untraceableResult.violations.some((v) => v.includes("Untraceable"))) {
    return `validateTopicsArtifact: untraceable artifact rejected for the wrong reason: ${untraceableResult.violations.join("; ")}`;
  }
  return null;
}

function checkBroadRegistryQuantityBypass(): string | null {
  // Reproduces the Phase 3 review round 2 finding directly: the narrow
  // single-entry REGISTRY above is not sufficient to exercise the clause/
  // quantity layer at all (its sentence-level ids>=2 threshold rejects any
  // fabricated artifact trivially, masking a regression here). This check
  // runs the exact confirmed bypass artifact against BROAD_REGISTRY instead,
  // so a regression in extractQuantityPhrases' spelled-out-number handling
  // or clauseSupported's overlap threshold fails CI.
  const cleanSentence =
    "I own the enterprise CTRM strategy, the multi-vendor buy-vs-build hybrid target architecture across the physical trade lifecycle.";
  const cleanResult = validateResearchArtifact(cleanSentence, { registry: BROAD_REGISTRY, identity: IDENTITY });
  if (!cleanResult.ok) {
    return `broad-registry quantity check: clean claim failed: ${cleanResult.violations.join("; ")}`;
  }

  const bypassResult = validateResearchArtifact(SPELLED_OUT_NUMBER_BYPASS_SENTENCE, {
    registry: BROAD_REGISTRY,
    identity: IDENTITY,
  });
  if (bypassResult.ok) {
    return "broad-registry quantity check: the confirmed spelled-out-number bypass artifact was NOT flagged against a broad, multi-entry registry";
  }
  if (!bypassResult.violations.some((v) => v.includes("Untraceable"))) {
    return `broad-registry quantity check: bypass artifact rejected for the wrong reason: ${bypassResult.violations.join("; ")}`;
  }
  return null;
}

function checkAdversarialCorpus(): string | null {
  // R1 (Phase 3 truth-floor hardening round 3): packages/core/src/truth/
  // adversarial-corpus.ts is the single source for every confirmed
  // known-bypass artifact from the Phase 3 adversarial reviews. Running it
  // here means a regression in ANY of these — third-person self-claim,
  // spelled-out compound-number fabrication, clause graft, honesty
  // whitespace/zero-width evasion, decoy-Grounding line, duplicate heading —
  // fails CI even if the packages/core unit tests were somehow skipped. This
  // bounds the clause-overlap threshold residual with a permanent
  // regression barrier rather than tightening the threshold (owner
  // decision: bound with tests, do NOT tighten).
  const researchCtx = { registry: ADVERSARIAL_BROAD_REGISTRY, identity: ADVERSARIAL_IDENTITY };

  const thirdPersonResult = validateResearchArtifact(ADVERSARIAL_THIRD_PERSON_CLAIM, researchCtx);
  if (thirdPersonResult.ok) {
    return "adversarial corpus: third-person self-claim artifact was NOT flagged";
  }

  const spelledNumberResult = validateResearchArtifact(ADVERSARIAL_SPELLED_NUMBER_CLAIM, researchCtx);
  if (spelledNumberResult.ok) {
    return "adversarial corpus: spelled-out compound-number fabrication artifact was NOT flagged";
  }

  const clauseGraftResult = validateResearchArtifact(ADVERSARIAL_CLAUSE_GRAFT_CLAIM, researchCtx);
  if (clauseGraftResult.ok) {
    return "adversarial corpus: clause-graft fabrication artifact was NOT flagged";
  }

  for (const variant of ADVERSARIAL_HONESTY_EVASIONS) {
    const text = buildLetter(variant.text, 60);
    const result = validateCoverArtifact(text, {
      registry: ADVERSARIAL_RETIRED_REGISTRY,
      identity: ADVERSARIAL_IDENTITY,
      drifts: [],
    });
    if (result.ok || !result.violations.some((v) => v.includes("retired"))) {
      return `adversarial corpus: honesty evasion (${variant.label}) was NOT flagged`;
    }
  }

  const dupHeadingResult = validatePrepPackArtifact(buildAdversarialDuplicateHeadingPrepPack(), {
    registry: ADVERSARIAL_BROAD_REGISTRY,
    identity: ADVERSARIAL_IDENTITY,
    drifts: [],
    gaps: [ADVERSARIAL_GAP],
    kind: "interview",
  });
  if (dupHeadingResult.ok) {
    return "adversarial corpus: duplicate 'Gaps to rehearse' heading with fabricated content was NOT flagged";
  }

  const decoyGroundingResult = validateDrillArtifact(buildAdversarialDecoyGroundingDrill(), {
    registry: ADVERSARIAL_BROAD_REGISTRY,
    identity: ADVERSARIAL_IDENTITY,
    drifts: [],
    gaps: [],
  });
  if (decoyGroundingResult.ok) {
    return "adversarial corpus: decoy 'Grounding:' line inside '## My answer' was NOT flagged";
  }

  return null;
}

export function checkGeneratedArtifactTrace(): CheckResult {
  const failures = [
    checkCover(),
    checkResearch(),
    checkPrepPack(),
    checkDrill(),
    checkGap(),
    checkTopics(),
    checkBroadRegistryQuantityBypass(),
    checkAdversarialCorpus(),
  ].filter((f): f is string => f !== null);

  if (failures.length > 0) {
    return fail(failures.join(" | "));
  }

  return { name: CHECK_NAME, passed: true };
}
