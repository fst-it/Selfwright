import type { RawPosting, SeenEntry } from "./types.js";

export function isSeen(url: string, seen: SeenEntry[]): boolean {
  return seen.some((entry) => entry.url === url);
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

// Seniority qualifiers and filler words are stripped so that
// "Senior Engineer" and "Sr. Engineer" collapse to the same token set.
const TITLE_STOP_WORDS = new Set([
  "a", "an", "the", "of", "in", "at", "for", "by", "and", "or", "with", "to",
  "senior", "sr", "junior", "jr", "principal", "lead", "staff", "associate",
  "head", "global", "regional", "vp", "director",
]);

function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !TITLE_STOP_WORDS.has(t)),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1.0;
  const intersection = [...a].filter((t) => b.has(t)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 1.0 : intersection / union;
}

// Two titles are considered similar when the Jaccard similarity of their
// stopword-filtered tokens meets or exceeds this threshold.
const FUZZY_THRESHOLD = 0.5;

export function areSimilarTitles(t1: string, t2: string): boolean {
  return jaccardSimilarity(titleTokens(t1), titleTokens(t2)) >= FUZZY_THRESHOLD;
}

// Exact-normalized match (v1 baseline — kept for backward compatibility and FF-SCAN-2).
export function dedupeByCompanyRole(postings: RawPosting[]): RawPosting[] {
  const seenKeys = new Set<string>();
  const result: RawPosting[] = [];
  for (const posting of postings) {
    const key = `${normalize(posting.company)}|${normalize(posting.title)}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    result.push(posting);
  }
  return result;
}

// Fuzzy dedup: ported from career-ops' role-matcher.mjs (MIT). A posting is a
// duplicate if a posting with the same normalized company name AND a similar title
// (Jaccard ≥ 0.5 on stopword-filtered tokens) has already been included.
// This catches "Senior Engineer" ≈ "Sr. Engineer" that exact matching misses.
export function dedupeByCompanyRoleFuzzy(postings: RawPosting[]): RawPosting[] {
  const included: RawPosting[] = [];
  for (const posting of postings) {
    const co = normalize(posting.company);
    const isDup = included.some(
      (p) => normalize(p.company) === co && areSimilarTitles(p.title, posting.title),
    );
    if (!isDup) included.push(posting);
  }
  return included;
}
