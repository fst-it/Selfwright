// ── Coaching: evidence retrieval and relevance scoring ────────────────────────
import { tokenize, entryTokens, tagLevels } from "../truth/index.js";
import type { EvidenceEntry, EvidenceTag, Ontology } from "../truth/index.js";
import type { Relevance, RankedEvidence } from "./types.js";

function tagWeight(tag: EvidenceTag): number {
  const levels = tagLevels(tag);
  let max = 0;
  for (const level of levels) {
    const w = level === "hard" ? 1.0 : level === "soft" ? 0.5 : 0.25; // claim → 0.25
    if (w > max) max = w;
  }
  return max;
}

/**
 * One-hop, bidirectional ontology expansion — NOT transitive.
 * Returns the input term plus any synonyms reachable in one step.
 * Deduplicates case-insensitively, preserving the first occurrence's casing.
 */
export function expandTerm(term: string, ontology?: Ontology): string[] {
  if (!ontology) return [term];

  const seen = new Map<string, string>(); // lowercase → first-seen form
  const result: string[] = [];

  function addIfNew(t: string): void {
    const lower = t.toLowerCase();
    if (!seen.has(lower)) {
      seen.set(lower, t);
      result.push(t);
    }
  }

  addIfNew(term);
  const lower = term.toLowerCase();

  // Forward lookup: ontology[lower]
  const direct = ontology[lower];
  if (direct !== undefined && direct !== null) {
    if (typeof direct === "string") {
      addIfNew(direct);
    } else {
      for (const s of direct) addIfNew(s);
    }
  }

  // Reverse lookup: any key whose value-list contains the term (case-insensitive)
  for (const [k, v] of Object.entries(ontology)) {
    if (v === null) continue;
    const values = typeof v === "string" ? [v] : v;
    if (values.some((s) => s.toLowerCase() === lower)) {
      addIfNew(k);
      for (const s of values) addIfNew(s);
    }
  }

  return result;
}

/**
 * Score an evidence entry against a set of query terms.
 * Re-uses the same tokenizer as traceClaims so coaching never ranks
 * evidence the truth floor would later reject as untraceable.
 */
export function relevance(
  queryTerms: string[],
  entry: EvidenceEntry,
  ontology?: Ontology,
): Relevance {
  // Token overlap
  const queryTokens = new Set<string>();
  for (const t of queryTerms) {
    for (const tok of tokenize(t)) queryTokens.add(tok);
  }
  const et = entryTokens(entry);

  const overlapArr: string[] = [];
  for (const tok of queryTokens) {
    if (et.has(tok)) overlapArr.push(tok);
  }
  overlapArr.sort();
  const overlap = overlapArr.length;

  // Keyword hits: count of ontology-expanded query terms (and their individual tokens)
  // that case-insensitively exact-match some string in entry.keywords.
  // Including individual tokens allows "treasury settlement" to match keywords
  // ["treasury", "settlement"] when each word is separately curated in the entry.
  const expandedLower = new Set<string>();
  for (const t of queryTerms) {
    for (const expanded of expandTerm(t, ontology)) {
      expandedLower.add(expanded.toLowerCase());
      for (const tok of tokenize(expanded)) expandedLower.add(tok);
    }
  }
  let keywordHits = 0;
  for (const expandedTerm of expandedLower) {
    if (entry.keywords.some((kw) => kw.toLowerCase() === expandedTerm)) {
      keywordHits++;
    }
  }

  const score = overlap + 2 * keywordHits + tagWeight(entry.tag);
  return { score, overlap, overlapTokens: overlapArr, keywordHits };
}

/**
 * Select and rank evidence entries for a topic (string) or set of topics (string[]).
 * Filters out zero-overlap entries; deterministic sort: score desc, id asc.
 */
export function selectEvidenceForTopic(
  input: string | string[],
  registry: EvidenceEntry[],
  ontology?: Ontology,
  cap = 5,
): RankedEvidence[] {
  const terms = Array.isArray(input)
    ? input.flatMap((k) => expandTerm(k, ontology))
    : expandTerm(input, ontology);

  const scored: Array<{ entry: EvidenceEntry; r: Relevance }> = [];
  for (const entry of registry) {
    const r = relevance(terms, entry, ontology);
    if (r.overlap === 0) continue; // zero lexical footing → irrelevant
    scored.push({ entry, r });
  }

  scored.sort((a, b) => {
    const diff = b.r.score - a.r.score;
    if (diff !== 0) return diff;
    return a.entry.id < b.entry.id ? -1 : 1; // deterministic tie-break
  });

  return scored.slice(0, cap).map(({ entry, r }) => ({
    id: entry.id,
    score: r.score,
    tag: entry.tag,
    why:
      r.overlapTokens.join(", ") + (r.keywordHits > 0 ? " [keyword match]" : ""),
  }));
}
