// ── Coaching: gap-coverage detection ─────────────────────────────────────────
import { tokenize, MIN_KEYWORD_OVERLAP } from "../truth/index.js";
import { expandTerm, relevance } from "./retrieval.js";
import type { EvidenceEntry, Ontology, Archetype, Gap } from "../truth/index.js";
import type { CandidateGap } from "./types.js";

/** Build a suggested GAP-* id from a topic string. Never writes; purely informational. */
function buildSuggestedGapId(topic: string, existingIds: Set<string>): string {
  // "GAP-" + topic → uppercase → non-alphanumeric runs → "-" → trim → truncate to 24 chars
  const slug = ("GAP-" + topic)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

  if (!existingIds.has(slug)) return slug;
  // Collision suffix: -2, -3, ...
  for (let suffix = 2; ; suffix++) {
    const candidate = slug.slice(0, 21) + "-" + String(suffix); // keep total <= 24
    if (!existingIds.has(candidate)) return candidate;
  }
}

export function computeCoverageGapsForKeywords(
  topics: string[],
  registry: EvidenceEntry[],
  ontology?: Ontology,
  gaps: Gap[] = [],
): CandidateGap[] {
  const gapIdSet = new Set(gaps.map((g) => g.id));

  return topics.map((topic): CandidateGap => {
    const terms = expandTerm(topic, ontology);

    // Score every registry entry
    const scored = registry.map((entry) => ({
      entry,
      r: relevance(terms, entry, ontology),
    }));

    // Coverage tier
    const hasKeywordHit = scored.some((s) => s.r.keywordHits > 0);
    const maxOverlap = scored.reduce(
      (acc, s) => (s.r.overlap > acc ? s.r.overlap : acc),
      0,
    );

    let coverage: CandidateGap["coverage"];
    if (hasKeywordHit) {
      coverage = "covered";
    } else if (maxOverlap >= MIN_KEYWORD_OVERLAP) {
      coverage = "partial";
    } else {
      coverage = "uncovered";
    }

    // Evidence ids (up to 3)
    let evidenceSource: typeof scored;
    if (coverage === "covered") {
      evidenceSource = scored.filter((s) => s.r.keywordHits > 0);
    } else if (coverage === "partial") {
      evidenceSource = scored.filter((s) => s.r.overlap >= 1);
    } else {
      evidenceSource = [];
    }
    const evidenceIds = evidenceSource
      .slice()
      .sort((a, b) => {
        const diff = b.r.score - a.r.score;
        return diff !== 0 ? diff : a.entry.id < b.entry.id ? -1 : 1;
      })
      .slice(0, 3)
      .map((s) => s.entry.id);

    const bestScore =
      scored.length > 0
        ? scored.reduce((acc, s) => (s.r.score > acc ? s.r.score : acc), 0)
        : 0;

    // Existing gap link: title token-overlap >= 2, or substring match
    const topicTokens = tokenize(topic);
    const existingGap = gaps.find((g) => {
      const titleTokens = tokenize(g.title);
      let overlap = 0;
      for (const tok of topicTokens) {
        if (titleTokens.has(tok)) overlap++;
      }
      if (overlap >= 2) return true;
      const tl = topic.toLowerCase().trim();
      const gl = g.title.toLowerCase();
      // Proper-substring check only (exclude equal strings — equality is caught
      // by token overlap >= 2 above; reflexive includes() would suppress the
      // suggestedGapId collision suffix for topics whose generated id already exists).
      return tl !== gl && (tl.includes(gl) || gl.includes(tl));
    });
    const existingGapId = existingGap?.id;

    const suggestedGapId =
      coverage !== "covered" && existingGapId === undefined
        ? buildSuggestedGapId(topic, gapIdSet)
        : undefined;

    return {
      topic,
      coverage,
      evidenceIds,
      bestScore,
      ...(existingGapId !== undefined ? { existingGapId } : {}),
      ...(suggestedGapId !== undefined ? { suggestedGapId } : {}),
    };
  });
}

export function computeCoverageGaps(
  archetype: Archetype,
  registry: EvidenceEntry[],
  ontology?: Ontology,
  gaps?: Gap[],
): CandidateGap[] {
  return computeCoverageGapsForKeywords(
    archetype.match_keywords,
    registry,
    ontology,
    gaps ?? [],
  );
}
