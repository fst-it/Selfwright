import type { EvidenceEntry } from "./schemas/index.js";

export interface ClaimTrace {
  sentence: string;
  evidenceIds: string[];
}

export interface TraceResult {
  traceable: ClaimTrace[];
  untraceable: string[];
  ok: boolean;
}

const STOP_WORDS = new Set([
  "the","a","an","is","are","was","were","in","on","at","to","of","and","or","for",
  "with","as","by","from","that","this","have","had","will","would","can","could",
  "not","i","my","we","our","their","its","be","been","has","his","her","they",
]);

// Sentences with fewer than this many content words are skipped unless they
// contain numeric content (metric claims like "Raised $22M" must not be invisible).
const MIN_SENTENCE_CONTENT_WORDS = 4;
export const MIN_KEYWORD_OVERLAP = 2;

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w)),
  );
}

export function entryTokens(entry: EvidenceEntry): Set<string> {
  return tokenize(
    [entry.claim, entry.detail ?? "", ...entry.keywords].join(" "),
  );
}

function matchingIds(sentence: string, registry: EvidenceEntry[]): string[] {
  const sentTokens = tokenize(sentence);
  const ids: string[] = [];
  for (const entry of registry) {
    const evdTokens = entryTokens(entry);
    let overlap = 0;
    for (const w of sentTokens) {
      if (evdTokens.has(w)) overlap++;
    }
    if (overlap >= MIN_KEYWORD_OVERLAP) ids.push(entry.id);
  }
  return ids;
}

// ── Quantitative-claim extraction (Phase 3 review, F2) ───────────────────────
//
// tokenize() drops tokens under 3 chars and has no notion of a number's scale
// (300 vs $300M), so a fabricated figure riding alongside real keyword
// overlap ("sub-second" vs the real "under 30-minute latency") was invisible
// to matchingIds(). extractQuantityPhrases pulls every money/percent/duration
// assertion out of raw text (not the tokenizer) into a canonical form robust
// to formatting ($55M / "55 million" / "$55m" all normalize identically), so
// a claim's asserted numbers can be checked against the specific evidence
// entry's own claim/detail text rather than riding on unrelated word overlap.
const SCALE_WORD_MULT: Record<string, number> = {
  h: 1e2, hundred: 1e2,
  k: 1e3, thousand: 1e3,
  m: 1e6, million: 1e6,
  b: 1e9, billion: 1e9,
  t: 1e12, trillion: 1e12,
};

// Spelled-out cardinals two..ten (Phase 3 review round 2, F2 residual gap).
// "one"/"a"/"an" are deliberately excluded from the bare-cardinal fallback
// below — they are common English articles/pronouns ("one of the reasons"),
// and including them would flag ordinary prose as a quantity assertion. They
// ARE recognized ahead of a scale word ("a billion", "one million") since
// that combination is unambiguously a magnitude claim.
const WORD_CARDINALS: Record<string, number> = {
  a: 1, an: 1, one: 1,
  two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const BARE_CARDINAL_RE = /\b(two|three|four|five|six|seven|eight|nine|ten)\b/gi;

// Compound cardinals twenty..ninety-nine (Phase 3 truth-floor hardening, R3
// residual gap). WORD_CARDINALS/BARE_CARDINAL_RE above only recognized
// spelled cardinals up to "ten" (plus a following scale word), so "twenty
// billion dollars" or "forty countries" produced zero quantity phrases and
// rode through untraced exactly like the pre-fix "two billion" gap. Tens
// words (twenty..ninety), optionally combined with a ones word via a hyphen
// or space ("twenty-one" / "twenty one"), are handled the same two ways as
// the two..ten case: as a magnitude prefix before a scale word, and bare.
const TENS_CARDINALS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const ONES_CARDINALS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9,
};
function compoundCardinalValue(tensWord: string, onesWord: string | undefined): number {
  const tens = TENS_CARDINALS[tensWord.toLowerCase()] ?? 0;
  const ones = onesWord ? (ONES_CARDINALS[onesWord.toLowerCase()] ?? 0) : 0;
  return tens + ones;
}
// The optional ones component is captured, not just consumed, so its value
// can be added to the tens value. The trailing (?!-) blocks a bare tens word
// immediately followed by a hyphen that wasn't itself consumed as a
// recognized ones word — e.g. "twenty-first"/"forty-fifth" (an ordinal, not
// a cardinal quantity claim) — from matching as a bare "twenty"/"forty".
const COMPOUND_TENS_SRC =
  "(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\\s](one|two|three|four|five|six|seven|eight|nine))?";
const COMPOUND_TENS_SCALE_RE = new RegExp(
  `\\b${COMPOUND_TENS_SRC}\\s+(hundred|thousand|million|billion|trillion)\\b`,
  "gi",
);
const BARE_COMPOUND_TENS_RE = new RegExp(`\\b${COMPOUND_TENS_SRC}\\b(?!-)`, "gi");

function moneyCanonical(numStr: string, suffix: string | undefined): string | null {
  const n = Number(numStr.replace(/,/g, ""));
  if (Number.isNaN(n)) return null;
  const scale = suffix ? (SCALE_WORD_MULT[suffix.toLowerCase()] ?? 1) : 1;
  return `money:${n * scale}`;
}

function timeCanonical(numStr: string, unit: string): string | null {
  const n = Number(numStr.replace(/,/g, ""));
  if (Number.isNaN(n)) return null;
  const unitMap: Record<string, string> = {
    ms: "millisecond", millisecond: "millisecond", milliseconds: "millisecond",
    microsecond: "microsecond", microseconds: "microsecond",
    sec: "second", secs: "second", second: "second", seconds: "second",
    min: "minute", mins: "minute", minute: "minute", minutes: "minute",
    hr: "hour", hrs: "hour", hour: "hour", hours: "hour",
    day: "day", days: "day", month: "month", months: "month", year: "year", years: "year",
  };
  const normUnit = unitMap[unit.toLowerCase()] ?? unit.toLowerCase();
  return `time:${n}:${normUnit}`;
}

function percentCanonical(numStr: string): string | null {
  const n = Number(numStr.replace(/,/g, ""));
  if (Number.isNaN(n)) return null;
  return `percent:${n}`;
}

/**
 * Extract canonical quantity phrases (money, percent, time-duration, and
 * no-digit magnitude descriptors like "sub-second"/"real-time") from raw
 * text. Each match is masked out before the next pattern runs, so a figure
 * is never double-counted, and the final fallback captures any bare number
 * (including those under 3 chars, which tokenize() would otherwise drop).
 */
export function extractQuantityPhrases(rawText: string): string[] {
  const phrases: string[] = [];
  const mask = (whole: string): string => " ".repeat(whole.length);

  // Mask EVD-*/GAP-* id citations first — a claim's own evidence reference
  // (e.g. "documented in EVD-010") is not a quantity assertion, and its
  // trailing digits must not be mistaken for one.
  let text = rawText.replace(/\b(?:EVD|GAP)-[A-Za-z0-9-]+\b/g, mask);

  // Spelled-out cardinal + scale word ("two billion", "a billion") is
  // rewritten to digit + scale word BEFORE the digit-based money regexes
  // run, so "two billion dollars" is checked exactly like "$2B" — this
  // closes the residual F2 gap where a spelled-out figure produced zero
  // quantity phrases and the numeric-corroboration check never fired.
  text = text.replace(
    /\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(hundred|thousand|million|billion|trillion)\b/gi,
    (_whole: string, word: string, scale: string) => `${WORD_CARDINALS[word.toLowerCase()]} ${scale}`,
  );

  // Compound tens ("twenty".."ninety", optionally "-one".."-nine") + scale
  // word ("twenty billion dollars") — rewritten to digit + scale word before
  // the digit-based money regexes run, same mechanism as the single-cardinal
  // case just above.
  text = text.replace(
    COMPOUND_TENS_SCALE_RE,
    (_whole: string, tensWord: string, onesWord: string | undefined, scale: string) =>
      `${compoundCardinalValue(tensWord, onesWord)} ${scale}`,
  );

  text = text.replace(
    /\$\s?(\d[\d,]*(?:\.\d+)?)\s?(h|hundred|k|thousand|m|million|b|billion|t|trillion)?\b/gi,
    (whole: string, num: string, suf: string | undefined) => {
      const c = moneyCanonical(num, suf);
      if (c) phrases.push(c);
      return mask(whole);
    },
  );
  text = text.replace(
    /\b(\d[\d,]*(?:\.\d+)?)\s?(hundred|thousand|million|billion|trillion)\b/gi,
    (whole: string, num: string, suf: string) => {
      const c = moneyCanonical(num, suf);
      if (c) phrases.push(c);
      return mask(whole);
    },
  );
  text = text.replace(
    /\b(\d[\d,]*(?:\.\d+)?)\s?(?:%|percent)\b/gi,
    (whole: string, num: string) => {
      const c = percentCanonical(num);
      if (c) phrases.push(c);
      return mask(whole);
    },
  );
  text = text.replace(
    /\b(\d[\d,]*(?:\.\d+)?)[-\s]?(milliseconds?|ms|microseconds?|seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|months?|years?)\b/gi,
    (whole: string, num: string, unit: string) => {
      const c = timeCanonical(num, unit);
      if (c) phrases.push(c);
      return mask(whole);
    },
  );
  text = text.replace(
    /\b(sub-second|sub-minute|sub-hour|real-time|near-real-time|instantaneous|instant)\b/gi,
    (whole: string) => {
      phrases.push(`magnitude:${whole.toLowerCase()}`);
      return mask(whole);
    },
  );
  text = text.replace(/\b\d[\d,]*(?:\.\d+)?\b/g, (whole: string) => {
    phrases.push(`num:${whole.replace(/,/g, "")}`);
    return mask(whole);
  });

  // Bare compound tens ("twenty".."ninety", optionally "-one".."-nine"), not
  // part of a scale phrase (already consumed above) — e.g. "forty countries",
  // "twenty-one patents". Must run BEFORE the two..ten fallback below and
  // mask its matches out of `text` (reassigning, unlike that fallback) — a
  // space-separated compound ("twenty three") would otherwise double-count:
  // num:23 here AND num:3 again from the two..ten fallback matching the bare
  // "three".
  text = text.replace(
    BARE_COMPOUND_TENS_RE,
    (whole: string, tensWord: string, onesWord: string | undefined) => {
      phrases.push(`num:${compoundCardinalValue(tensWord, onesWord)}`);
      return mask(whole);
    },
  );

  // Bare spelled-out cardinal two..ten, not part of a scale phrase (already
  // consumed above) — e.g. "three undisclosed patents". Deliberately
  // excludes "one"/"a"/"an" (see WORD_CARDINALS comment) to avoid flagging
  // ordinary prose that merely contains those words.
  text.replace(BARE_CARDINAL_RE, (whole: string) => {
    phrases.push(`num:${WORD_CARDINALS[whole.toLowerCase()]}`);
    return mask(whole);
  });

  return phrases;
}

// ── Clause-level grafted-claim detection (Phase 3 review, F2) ────────────────
//
// matchingIds() scores an entire sentence as one bag of words, so a
// fabricated clause grafted onto a real one ("Leads enterprise architecture
// at Acme Corp and personally built a proprietary blockchain settlement
// network...") rides through on the real clause's overlap. Splitting on
// coordinating conjunctions and scoring each clause's own vocabulary against
// the registry catches a clause that shares zero vocabulary with any entry
// (a wholesale graft) without penalizing a real compound sentence whose
// second clause is a short continuation of the same claim (too few content
// words to be an independent assertion) — see MIN_SENTENCE_CONTENT_WORDS.
function splitClauses(sentence: string): string[] {
  return sentence
    .split(/\s+(?:and|but)\s+|;/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function clauseSupported(clause: string, registry: EvidenceEntry[]): boolean {
  const words = tokenize(clause);
  // A short, digit-free clause is treated as a continuation of the
  // surrounding claim (e.g. "...and architecture work for the enterprise"),
  // not an independent assertion that must clear the bar on its own.
  if (words.size < MIN_SENTENCE_CONTENT_WORDS && !/\d/.test(clause)) return true;

  // Threshold matches matchingIds()'s sentence-level MIN_KEYWORD_OVERLAP
  // (Phase 3 review round 2): against the real ~30-entry registry's broad,
  // overlapping tech vocabulary, a ≥1-word bar let almost any clause find
  // ONE incidentally-shared word ("built", "system", "trading") with some
  // entry, silently validating a fabricated clause. ≥2 shared words is the
  // same bar a clause would have to clear as a standalone sentence.
  const overlappingEntries: EvidenceEntry[] = [];
  for (const entry of registry) {
    const evdTokens = entryTokens(entry);
    let overlap = 0;
    for (const w of words) {
      if (evdTokens.has(w)) overlap++;
    }
    if (overlap >= MIN_KEYWORD_OVERLAP) overlappingEntries.push(entry);
  }
  // No entry meets the overlap bar: an orphaned clause introducing an
  // unrelated fact, not a paraphrase of one the sentence already matched.
  if (overlappingEntries.length === 0) return false;

  const clauseQuantities = extractQuantityPhrases(clause);
  if (clauseQuantities.length === 0) return true;

  // Every number/magnitude the clause asserts must be corroborated by the
  // matched entries' own claim/detail text — a shared topic (e.g. "latency")
  // does not license a different figure than the one the evidence records.
  const evidenceQuantities = new Set(
    overlappingEntries.flatMap((e) =>
      extractQuantityPhrases([e.claim, e.detail ?? ""].join(" ")),
    ),
  );
  return clauseQuantities.every((q) => evidenceQuantities.has(q));
}

// Protects a decimal point (e.g. "$2.5M") from being treated as a sentence
// terminator — the naive [^.!?]+[.!?]* split otherwise fragments "$2.5M" into
// "$2." and "5M ...", making the number itself untokenizable.
const DECIMAL_GUARD = "\u0000";

export function splitSentences(text: string): string[] {
  const guarded = text.replace(/(\d)\.(\d)/g, `$1${DECIMAL_GUARD}$2`);
  return (guarded.match(/[^.!?]+[.!?]*/g) ?? [])
    .map((s) => s.split(DECIMAL_GUARD).join(".").trim())
    .filter(Boolean);
}

export function traceClaims(text: string, registry: EvidenceEntry[]): TraceResult {
  const sentences = splitSentences(text);
  const traceable: ClaimTrace[] = [];
  const untraceable: string[] = [];

  for (const sentence of sentences) {
    const words = tokenize(sentence);
    // Short sentences are skipped unless they contain numeric content (metric claims).
    // "Raised $22M" or "Grew 40%" would otherwise be invisible to truth-trace.
    if (words.size < MIN_SENTENCE_CONTENT_WORDS && !/\d/.test(sentence)) continue;
    const ids = matchingIds(sentence, registry);
    const clauses = splitClauses(sentence);
    const supported = ids.length > 0 && clauses.every((c) => clauseSupported(c, registry));
    if (supported) {
      traceable.push({ sentence, evidenceIds: ids });
    } else {
      untraceable.push(sentence);
    }
  }

  return { traceable, untraceable, ok: untraceable.length === 0 };
}
