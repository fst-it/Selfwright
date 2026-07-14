import type { DriftEntry } from "./schemas/index.js";
import type { EvidenceEntry } from "./schemas/index.js";

export interface HonestyViolation {
  phrase: string;
  source: "evd-retired" | "drift-retired";
}

export interface HonestyResult {
  violations: HonestyViolation[];
  ok: boolean;
}

function extractRetiredPhrases(registry: EvidenceEntry[]): string[] {
  const phrases: string[] = [];
  for (const entry of registry) {
    if (!entry.retired) continue;
    for (const raw of entry.retired) {
      // "autonomous trading agents — do not use anywhere" → extract phrase before em-dash
      const parts = raw.split("—");
      const phrase = (parts[0] ?? "").trim().toLowerCase();
      if (phrase) phrases.push(phrase);
    }
  }
  return phrases;
}

function retiredDriftKeywords(drifts: DriftEntry[]): string[] {
  const keywords: string[] = [];
  for (const drift of drifts) {
    if (drift.status !== "retired") continue;
    for (const kw of drift.keywords) {
      keywords.push(kw.toLowerCase());
    }
  }
  return keywords;
}

// Zero-width/invisible Unicode characters (zero-width space/joiners, BOM,
// soft hyphen, word joiner) that can be inserted between two words to defeat
// a plain substring match without changing how the text visually renders.
// Mapped to a space (not stripped to empty) so a phrase that used one of
// these characters AS its only word separator still normalizes to a real
// gap between words, rather than merging into one unmatched token.
const INVISIBLE_RE = /[\u200B\u200C\u200D\uFEFF\u00AD\u2060]/g;

/**
 * Collapse whitespace runs (spaces, tabs, newlines — including a markdown
 * line-wrap) to a single space and strip invisible Unicode separators, so a
 * retired phrase or drift keyword can't be evaded by reformatting it across
 * a double space, a line break, or a zero-width character (Phase 3 review,
 * F3) while a normal single-spaced occurrence still matches exactly as
 * before.
 */
function normalizeForMatch(s: string): string {
  return s
    .replace(INVISIBLE_RE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function scanHonestyBoundary(
  text: string,
  drifts: DriftEntry[],
  registry: EvidenceEntry[],
): HonestyResult {
  const normalizedText = normalizeForMatch(text);
  const violations: HonestyViolation[] = [];

  for (const phrase of extractRetiredPhrases(registry)) {
    const normalizedPhrase = normalizeForMatch(phrase);
    if (normalizedPhrase && normalizedText.includes(normalizedPhrase)) {
      violations.push({ phrase, source: "evd-retired" });
    }
  }

  for (const kw of retiredDriftKeywords(drifts)) {
    const normalizedKw = normalizeForMatch(kw);
    if (normalizedKw && normalizedText.includes(normalizedKw)) {
      violations.push({ phrase: kw, source: "drift-retired" });
    }
  }

  return { violations, ok: violations.length === 0 };
}
