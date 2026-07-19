// FF-AISOUND: no banned AI-tell phrases in generated artifacts.
// Tier 1 (no SELFWRIGHT_DATA_DIR required) — synthetic fixtures only.
//
// Verifies that the deterministic banned-phrase gate works correctly:
//   (a) A clean cover artifact passes validateCoverArtifact with no AI-tell violations.
//   (b) An artifact seeded with a banned phrase fails with an AI-tell violation.
//
// This check is the CI guarantee that the scanAiTells mechanism (implemented
// in packages/core/src/services/ai-tells.ts and wired into all six
// generation-guard validators) correctly gates generated artifacts. It runs
// against validateCoverArtifact as the representative validator.
import { validateCoverArtifact, BANNED_AI_TELLS } from "@selfwright/core";
import type { EvidenceEntry, Identity } from "@selfwright/core";
import type { CheckResult } from "./shared.js";

const CHECK_NAME = "FF-AISOUND: no banned AI-tell phrases in generated artifacts";

// ── Synthetic registry + identity ────────────────────────────────────────────

const REGISTRY: EvidenceEntry[] = [
  {
    id: "EVD-FFAIS-001",
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

// ── Cover letter helpers ──────────────────────────────────────────────────────
//
// Every content word in FILLER_SENTENCE is a recognized stopword or <3 chars,
// so traceClaims skips it — pure padding that can never trip the truth-trace
// check. Same convention as generated-artifact-trace.ts.

const FILLER_SENTENCE = "I am not that or this.";
// TRACEABLE_SENTENCE is traceable against REGISTRY (keywords: ctrm, trading,
// platform, architecture, integration) and contains no AI tells.
const TRACEABLE_SENTENCE =
  "I led the CTRM trading platform integration and architecture work for the enterprise.";

function buildLetter(openingSentence: string, fillerCount: number): string {
  const filler = Array.from({ length: fillerCount }, () => FILLER_SENTENCE).join(" ");
  return `${openingSentence} ${filler}`;
}

// ── Fixture design ────────────────────────────────────────────────────────────
//
// CLEAN_LETTER: 375 words (15 + 60×6), within the 350–400 word window.
// DIRTY_LETTER: 378 words (18 + 60×6). "Let's dive in." (+3 words) seeds the
//   "let's dive in" banned phrase. Word count stays within 350–400.
//
// The dirty letter's only failing check must be the AI-tell — not truth-trace
// (TRACEABLE_SENTENCE covers it) nor word count (378 ≤ 400) nor honesty.

const CLEAN_LETTER = buildLetter(TRACEABLE_SENTENCE, 60);
// "Let's dive in." is an explicit §1 opener in the banned list.
const DIRTY_OPENING = `${TRACEABLE_SENTENCE} Let's dive in.`;
const DIRTY_LETTER = buildLetter(DIRTY_OPENING, 60);

const CTX = { registry: REGISTRY, identity: IDENTITY, drifts: [] as never[] };

export function checkFfAisound(): CheckResult {
  // Sanity: the banned-phrase list is non-empty (the framework artifact is present).
  if (BANNED_AI_TELLS.length === 0) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: "BANNED_AI_TELLS is empty — the ai-tells framework artifact is missing or not exported",
    };
  }

  // (a) Clean fixture: must pass validateCoverArtifact with no AI-tell violations.
  const cleanResult = validateCoverArtifact(CLEAN_LETTER, CTX);
  if (!cleanResult.ok) {
    return {
      name: CHECK_NAME,
      passed: false,
      details:
        `Clean synthetic cover artifact failed validation unexpectedly: ` +
        cleanResult.violations.join("; "),
    };
  }
  if (cleanResult.violations.some((v) => v.startsWith("AI-tell:"))) {
    return {
      name: CHECK_NAME,
      passed: false,
      details:
        `Clean synthetic cover artifact triggered AI-tell violation(s): ` +
        cleanResult.violations.filter((v) => v.startsWith("AI-tell:")).join("; "),
    };
  }

  // (b) Dirty fixture: must FAIL validateCoverArtifact with an AI-tell violation.
  const dirtyResult = validateCoverArtifact(DIRTY_LETTER, CTX);
  if (dirtyResult.ok) {
    return {
      name: CHECK_NAME,
      passed: false,
      details:
        `Dirty synthetic cover artifact (seeded with "Let's dive in") was NOT rejected — ` +
        `banned-phrase gate is not wired into validateCoverArtifact`,
    };
  }
  if (!dirtyResult.violations.some((v) => v.startsWith("AI-tell:"))) {
    return {
      name: CHECK_NAME,
      passed: false,
      details:
        `Dirty artifact was rejected, but not for an AI-tell reason. ` +
        `Actual violation(s): ${dirtyResult.violations.join("; ")}`,
    };
  }

  return { name: CHECK_NAME, passed: true };
}
