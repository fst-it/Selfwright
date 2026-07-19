// ── Content: topic selection ───────────────────────────────────────────────
import {
  computeCoverageGaps,
  computeCoverageGapsForKeywords,
  selectEvidenceForTopic,
} from "../coaching/index.js";
import { norm } from "../scoring/index.js";
import type { EvidenceEntry, Ontology, Archetype, Gap } from "../truth/index.js";
import type { ContentTopicCandidate, ContentHistoryEntry, ContentDirection } from "./types.js";

// ── Freshness helpers (mirror drill-select.ts exactly) ────────────────────

/** Count of distinct topics in history AFTER the last occurrence of `topic`. */
function computeAgo(topic: string, history: ContentHistoryEntry[]): number {
  let lastIdx = -1;
  for (let i = 0; i < history.length; i++) {
    const entry = history[i];
    if (entry !== undefined && entry.topic === topic) lastIdx = i;
  }
  if (lastIdx === -1) return Infinity;
  const distinctSince = new Set<string>();
  for (let i = lastIdx + 1; i < history.length; i++) {
    const entry = history[i];
    if (entry !== undefined) distinctSince.add(entry.topic);
  }
  return distinctSince.size;
}

// ── Internal candidate representation ─────────────────────────────────────

interface InternalCandidate {
  topic: string;
  direction: ContentDirection;
  kind: ContentTopicCandidate["kind"];
  base: number;
  bestScore: number;
  gapId?: string;
}

function sortScoredCandidates(
  arr: Array<{ c: InternalCandidate; priority: number }>,
): void {
  // Primary: priority desc. Secondary: bestScore desc. Tertiary: topic asc.
  // Fully deterministic — no RNG, no Date.now dependency.
  arr.sort((a, b) => {
    const pd = b.priority - a.priority;
    if (pd !== 0) return pd;
    const sd = b.c.bestScore - a.c.bestScore;
    if (sd !== 0) return sd;
    return a.c.topic < b.c.topic ? -1 : a.c.topic > b.c.topic ? 1 : 0;
  });
}

function toCandidate(
  { c, priority }: { c: InternalCandidate; priority: number },
  registry: EvidenceEntry[],
  ontology?: Ontology,
): ContentTopicCandidate {
  return {
    topic: c.topic,
    direction: c.direction,
    kind: c.kind,
    score: priority,
    // Write candidates get full evidence bundle; read candidates get whatever
    // partial evidence selectEvidenceForTopic finds (may be empty for truly
    // uncovered topics — this is expected and valid).
    evidenceBundle: selectEvidenceForTopic(c.topic, registry, ontology, 5),
    ...(c.gapId !== undefined ? { gapId: c.gapId } : {}),
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Select content topics for a periodic digest.
 *
 * Direction mapping:
 *   write → covered topics (kind "strength", base 1): the owner can credibly
 *            write about these, backed by evidence.
 *   read  → gaps.yml rows (kind "gap", base 3) + uncovered topics (kind
 *            "uncovered", base 2) + partial topics (kind "stretch", base 2).
 *
 * Freshness: mirrors drill-select.ts's multiplicative decay exactly —
 *   priority = base × (1 − 0.5^ago) where ago counts distinct topics suggested
 *   since this topic last appeared in history (Infinity → capped at 6 ≈ 0.984).
 *   The most-recent topic in history is hard-excluded (no back-to-back repeat).
 *
 * Cap split: up to 5 write + up to 3 read, total bounded by cap (default 8).
 * Both directions are always represented when candidates exist.
 */
export function selectContentTopics(
  archetype: Archetype,
  registry: EvidenceEntry[],
  gaps: Gap[],
  history: ContentHistoryEntry[],
  ontology?: Ontology,
  cap = 8,
): ContentTopicCandidate[] {
  const coverage = computeCoverageGaps(archetype, registry, ontology, gaps);

  const writePool: InternalCandidate[] = coverage
    .filter((c) => c.coverage === "covered")
    .map((c): InternalCandidate => ({
      topic: c.topic,
      direction: "write",
      kind: "strength",
      base: 1.0,
      bestScore: c.bestScore,
    }));

  // GAP rows: highest-priority read candidates (base 3, mirroring drill-select weight).
  // Built first so uncovered/partial rows can skip anything that already links to one of
  // these gap ids — otherwise a coverage row whose existingGapId points at a gap already in
  // the pool duplicates a read slot for the same underlying gap (T3.3 finding 5).
  const gapPool: InternalCandidate[] = gaps.map((g): InternalCandidate => ({
    topic: g.title,
    direction: "read",
    kind: "gap",
    base: 3.0,
    bestScore: 0, // gap rows don't carry a bestScore from coverage computation
    gapId: g.id,
  }));
  const gapIdsInPool = new Set(gapPool.map((c) => c.gapId));

  const readPool: InternalCandidate[] = [
    ...gapPool,
    // Uncovered archetype topics (base 2)
    ...coverage
      .filter((c) => c.coverage === "uncovered" && (c.existingGapId === undefined || !gapIdsInPool.has(c.existingGapId)))
      .map((c): InternalCandidate => ({
        topic: c.topic,
        direction: "read",
        kind: "uncovered",
        base: 2.0,
        bestScore: c.bestScore,
        ...(c.existingGapId !== undefined ? { gapId: c.existingGapId } : {}),
      })),
    // Partial-coverage archetype topics (base 2)
    ...coverage
      .filter((c) => c.coverage === "partial" && (c.existingGapId === undefined || !gapIdsInPool.has(c.existingGapId)))
      .map((c): InternalCandidate => ({
        topic: c.topic,
        direction: "read",
        kind: "stretch",
        base: 2.0,
        bestScore: c.bestScore,
        ...(c.existingGapId !== undefined ? { gapId: c.existingGapId } : {}),
      })),
  ];

  // Hard-exclude most-recent topic to prevent back-to-back repeats.
  const mostRecentTopic = history.length > 0 ? history[history.length - 1]?.topic : undefined;

  function applyFreshnessAndFilter(
    pool: InternalCandidate[],
  ): Array<{ c: InternalCandidate; priority: number }> {
    const filtered =
      mostRecentTopic !== undefined
        ? pool.filter((c) => c.topic !== mostRecentTopic)
        : pool;
    const effectivePool = filtered.length > 0 ? filtered : pool;

    return effectivePool.map((c) => {
      const ago = computeAgo(c.topic, history);
      const exponent = ago === Infinity ? 6 : ago;
      const freshness = 1 - Math.pow(0.5, exponent);
      return { c, priority: c.base * freshness };
    });
  }

  const scoredWrite = applyFreshnessAndFilter(writePool);
  const scoredRead = applyFreshnessAndFilter(readPool);

  sortScoredCandidates(scoredWrite);
  sortScoredCandidates(scoredRead);

  // Cap split: up to 5 write + up to 3 read; total bounded by cap.
  const topWrite = scoredWrite.slice(0, Math.min(5, cap));
  const topRead = scoredRead.slice(0, Math.min(3, Math.max(0, cap - topWrite.length)));

  return [
    ...topWrite.map((x) => toCandidate(x, registry, ontology)),
    ...topRead.map((x) => toCandidate(x, registry, ontology)),
  ];
}

/**
 * Derive JD-driven topic keywords for application-mode content topics.
 *
 * Application mode used to pass the entire JD text in as a single array
 * element to selectContentTopicsForApplication, so the write candidate's
 * `.topic` was the verbatim JD text and topic diversity collapsed to at most
 * one write candidate (T3.3 finding 4). This computes the union of every
 * archetype's match_keywords that actually appear in the JD text, using the
 * same normalize + substring match scorePosting's domainMatch dimension
 * uses (see scoring/score.ts) — so JD↔keyword matching stays defined in one
 * place. Deduped case-insensitively (first-seen casing wins), sorted
 * deterministically. An empty result is valid and expected when the JD text
 * doesn't mention any archetype keyword — callers must not fall back to
 * passing the raw JD text.
 */
export function deriveJdTopicKeywords(jdText: string, archetypes: Archetype[]): string[] {
  const jdNorm = norm(jdText);
  const seen = new Map<string, string>(); // lowercase key -> first-seen casing
  for (const arch of archetypes) {
    for (const kw of arch.match_keywords) {
      const kwNorm = norm(kw);
      if (kwNorm.length === 0) continue;
      if (!jdNorm.includes(kwNorm)) continue;
      const key = kw.toLowerCase();
      if (!seen.has(key)) seen.set(key, kw);
    }
  }
  return [...seen.values()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Select content topics for a specific job-description context.
 *
 * Same direction mapping as selectContentTopics but driven by JD keywords
 * rather than archetype. No history or freshness decay — results are fully
 * deterministic per JD input (same keywords → same ranked list).
 */
export function selectContentTopicsForApplication(
  jdKeywords: string[],
  registry: EvidenceEntry[],
  gaps: Gap[],
  ontology?: Ontology,
  cap = 6,
): ContentTopicCandidate[] {
  const coverage = computeCoverageGapsForKeywords(jdKeywords, registry, ontology, gaps);

  const writePool: InternalCandidate[] = coverage
    .filter((c) => c.coverage === "covered")
    .map((c): InternalCandidate => ({
      topic: c.topic,
      direction: "write",
      kind: "strength",
      base: 1.0,
      bestScore: c.bestScore,
    }));

  // Built first (see selectContentTopics above) so uncovered/partial rows whose
  // existingGapId already has a gap-kind candidate in the pool can be skipped — otherwise
  // they duplicate a read slot for the same underlying gap (T3.3 finding 5).
  const gapPool: InternalCandidate[] = gaps.map((g): InternalCandidate => ({
    topic: g.title,
    direction: "read",
    kind: "gap",
    base: 3.0,
    bestScore: 0,
    gapId: g.id,
  }));
  const gapIdsInPool = new Set(gapPool.map((c) => c.gapId));

  const readPool: InternalCandidate[] = [
    ...gapPool,
    ...coverage
      .filter((c) => c.coverage === "uncovered" && (c.existingGapId === undefined || !gapIdsInPool.has(c.existingGapId)))
      .map((c): InternalCandidate => ({
        topic: c.topic,
        direction: "read",
        kind: "uncovered",
        base: 2.0,
        bestScore: c.bestScore,
        ...(c.existingGapId !== undefined ? { gapId: c.existingGapId } : {}),
      })),
    ...coverage
      .filter((c) => c.coverage === "partial" && (c.existingGapId === undefined || !gapIdsInPool.has(c.existingGapId)))
      .map((c): InternalCandidate => ({
        topic: c.topic,
        direction: "read",
        kind: "stretch",
        base: 2.0,
        bestScore: c.bestScore,
        ...(c.existingGapId !== undefined ? { gapId: c.existingGapId } : {}),
      })),
  ];

  // No history: all topics are fully fresh (Infinity → exponent 6 → ≈ 0.984).
  const FULL_FRESHNESS = 1 - Math.pow(0.5, 6);

  const scoredWrite = writePool.map((c) => ({ c, priority: c.base * FULL_FRESHNESS }));
  const scoredRead = readPool.map((c) => ({ c, priority: c.base * FULL_FRESHNESS }));

  sortScoredCandidates(scoredWrite);
  sortScoredCandidates(scoredRead);

  // Cap split: up to 5 write + up to 3 read; total bounded by cap.
  const topWrite = scoredWrite.slice(0, Math.min(5, cap));
  const topRead = scoredRead.slice(0, Math.min(3, Math.max(0, cap - topWrite.length)));

  return [
    ...topWrite.map((x) => toCandidate(x, registry, ontology)),
    ...topRead.map((x) => toCandidate(x, registry, ontology)),
  ];
}
