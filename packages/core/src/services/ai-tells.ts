// Banned AI-tell phrase list for Selfwright generated-artifact validators.
//
// Derived from ~/.claude/skills/human-voice/SKILL.md (canonical anti-AI-tell
// style gate). This is the published framework artifact and single source of
// truth for the banned-phrase gate that runs at artifact validation time.
//
// Selection criteria (from SKILL.md):
//   §1 Banned/rationed lexicon: verbs, nouns, adjectives, openers, closers
//   §2 Banned structures: negation pivot ("not just X but Y")
//   §3 Banned tones: reaction-steering adverbs ("Importantly,")
//
// Only phrases that are (a) deterministic string/regex matches, (b) unambiguous
// AI-writing tells in career-document contexts, and (c) unlikely to produce
// false positives on legitimate professional prose are included.
//
// Deliberate exclusions (kept out to avoid finance/engineering false positives):
//   leverage (finance FP), robust (engineering FP), crucial (too common),
//   landscape (literal-use FP).
//
// Scope note — negation pivot and all other checks apply to the full artifact
// text, including any JD prose quoted verbatim. An artifact must not reproduce
// AI-sounding JD language even inside quotation marks.

export interface AiTellEntry {
  /** Human-readable label, reported verbatim in validation violations */
  readonly label: string;
  /**
   * String: case-insensitive substring match against the lowercased artifact text.
   * RegExp: tested directly against the original text (case flag on the pattern itself).
   */
  readonly match: string | RegExp;
}

/**
 * Published list of banned AI-tell phrases (23 entries as of v0.6.0).
 * Derived from the human-voice skill (§1 lexicon, §2 structures, §3 tones).
 *
 * Every generated artifact that passes through any generation-guard validator
 * must contain zero matches — a single hit causes the validator to return
 * `ok: false` with an `AI-tell: "<label>"` violation message.
 */
export const BANNED_AI_TELLS: readonly AiTellEntry[] = [
  // ── §1 Banned verbs (SKILL.md §1) ─────────────────────────────────────────
  { label: "delve / delving", match: "delv" },
  { label: "revolutionize / revolutionizing", match: "revolutioniz" },
  // ── §1 Banned nouns (SKILL.md §1) ─────────────────────────────────────────
  { label: "tapestry (metaphorical)", match: "tapestry" },
  { label: "synergies", match: "synergies" },
  { label: "synergy (singular)", match: "synergy" },
  { label: "paradigm shift", match: "paradigm shift" },
  { label: "deep dive", match: "deep dive" },
  { label: "thought leader", match: "thought leader" },
  // ── §1 Banned adjective/adverb (SKILL.md §1) ──────────────────────────────
  { label: "seamlessly", match: "seamlessly" },
  // ── §1 Banned openers (SKILL.md §1) ───────────────────────────────────────
  { label: "In today's ...", match: "in today's " },
  { label: "In the ever-evolving ...", match: "in the ever-evolving " },
  { label: "It's important to note", match: "it's important to note" },
  { label: "It is worth noting", match: "it is worth noting" },
  { label: "At its core", match: "at its core" },
  { label: "Let's dive in", match: "let's dive in" },
  // ── §1 Banned closers (SKILL.md §1) ───────────────────────────────────────
  { label: "In conclusion", match: /\bin conclusion[,.:]/i },
  { label: "In summary", match: /\bin summary[,.:]/i },
  // ── §2 Banned structure: negation pivot (SKILL.md §2) ─────────────────────
  // "It's not just X, it's Y" / "Not X, but Y" — the single most diagnostic
  // AI construction per SKILL.md §2 ("Banned structures").
  { label: "negation pivot (not just ... but)", match: /\bnot just\b.{0,60}\bbut\b/is },
  // ── §3 Banned tone: reaction-steering adverbs (SKILL.md §3) ───────────────
  // The trailing comma is the tell — these adverbs almost exclusively appear
  // in sentence-opener position when followed by a comma ("Interestingly, I...").
  // The check is a plain substring match (no positional anchor to sentence-start);
  // false positives in career-document contexts are near-zero in practice.
  { label: "Interestingly,", match: "interestingly," },
  { label: "Notably,", match: "notably," },
  { label: "Importantly,", match: "importantly," },
  { label: "Undoubtedly,", match: "undoubtedly," },
  // ── §3 Tone: sycophancy / significance inflation (SKILL.md §3) ────────────
  { label: "testament to", match: "testament to" },
];

/**
 * Scan `text` for banned AI-tell phrases from `BANNED_AI_TELLS`.
 *
 * Returns an array of violation strings of the form `AI-tell: "<label>"`, one
 * per detected tell. Returns an empty array when the text is clean.
 *
 * String entries are matched case-insensitively (text is lowercased before
 * the substring check). RegExp entries are tested against the original text
 * using the flags on the pattern itself.
 */
export function scanAiTells(text: string): string[] {
  const lower = text.toLowerCase();
  const violations: string[] = [];
  for (const entry of BANNED_AI_TELLS) {
    let found: boolean;
    if (typeof entry.match === "string") {
      found = lower.includes(entry.match.toLowerCase());
    } else {
      found = entry.match.test(text);
    }
    if (found) {
      violations.push(`AI-tell: "${entry.label}"`);
    }
  }
  return violations;
}
