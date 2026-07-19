// ── Coaching: drill topic selection ──────────────────────────────────────────
import { computeCoverageGaps } from "./coverage.js";
import { selectEvidenceForTopic } from "./retrieval.js";
import type { EvidenceEntry, Ontology, Archetype, Gap } from "../truth/index.js";
import type { CandidateGap, DrillHistoryEntry, DrillKind, DrillSelection } from "./types.js";

interface Candidate {
  id: string;
  kind: DrillKind;
  base: number;
}

/** Count of distinct topicIds in history entries AFTER the last occurrence of `id`. */
function computeAgo(id: string, history: DrillHistoryEntry[]): number {
  let lastIdx = -1;
  for (let i = 0; i < history.length; i++) {
    const entry = history[i];
    if (entry !== undefined && entry.topicId === id) lastIdx = i;
  }
  if (lastIdx === -1) return Infinity;
  const distinctSince = new Set<string>();
  for (let i = lastIdx + 1; i < history.length; i++) {
    const entry = history[i];
    if (entry !== undefined) distinctSince.add(entry.topicId);
  }
  return distinctSince.size;
}

/**
 * Select the next drill topic given history, loaded gaps, archetype, and evidence registry.
 *
 * Pool composition: every gap row (kind="gap", base 3), every partial-coverage topic
 * (kind="stretch", base 2), every covered topic (kind="strength", base 1).
 *
 * Priority = base × (1 − 0.5^ago), where ago counts distinct topics drilled since this
 * one last appeared (Infinity → capped at 6 so freshness ≈ 0.984, effectively fully fresh).
 * The immediately-previous topic is hard-excluded (no back-to-back repeats), unless
 * excluding it would empty the pool entirely.
 *
 * Throws only when the pool is completely empty (no gaps AND archetype has no match_keywords).
 */
export function selectNextDrillTopic(
  history: DrillHistoryEntry[],
  gaps: Gap[],
  archetype: Archetype,
  registry: EvidenceEntry[],
  ontology?: Ontology,
): DrillSelection {
  const coverage: CandidateGap[] = computeCoverageGaps(archetype, registry, ontology, gaps);

  // Build candidate pool
  const candidates: Candidate[] = [
    ...gaps.map((g): Candidate => ({ id: g.id, kind: "gap", base: 3.0 })),
    ...coverage
      .filter((c) => c.coverage === "partial")
      .map((c): Candidate => ({ id: c.topic, kind: "stretch", base: 2.0 })),
    ...coverage
      .filter((c) => c.coverage === "covered")
      .map((c): Candidate => ({ id: c.topic, kind: "strength", base: 1.0 })),
  ];

  if (candidates.length === 0) {
    throw new Error(
      "selectNextDrillTopic: no drill candidates available — archetype has no match_keywords and no gaps are loaded",
    );
  }

  // Hard-exclude the immediately-previous topic (no back-to-back repeat),
  // unless doing so would empty the pool.
  const mostRecentEntry = history.length > 0 ? history[history.length - 1] : undefined;
  const mostRecentId = mostRecentEntry?.topicId;
  const filtered =
    mostRecentId !== undefined
      ? candidates.filter((c) => c.id !== mostRecentId)
      : candidates;
  const effectivePool = filtered.length > 0 ? filtered : candidates;

  // Compute priority for each candidate
  const KIND_ORDER: Record<DrillKind, number> = { gap: 0, stretch: 1, strength: 2 };

  let winner: Candidate | undefined;
  let winnerPriority = -Infinity;

  for (const c of effectivePool) {
    const ago = computeAgo(c.id, history);
    const exponent = ago === Infinity ? 6 : ago;
    const freshness = 1 - Math.pow(0.5, exponent);
    const priority = c.base * freshness;

    if (
      winner === undefined ||
      priority > winnerPriority ||
      (priority === winnerPriority &&
        (KIND_ORDER[c.kind] < KIND_ORDER[winner.kind] ||
          (c.kind === winner.kind && c.id < winner.id)))
    ) {
      winner = c;
      winnerPriority = priority;
    }
  }

  // winner is always defined here since effectivePool is non-empty
  const w = winner as Candidate;

  if (w.kind === "gap") {
    const foundGap = gaps.find((g) => g.id === w.id);
    if (foundGap !== undefined) {
      return {
        topicId: w.id,
        kind: w.kind,
        gap: foundGap,
        evidenceBundle: selectEvidenceForTopic(
          [foundGap.title, foundGap.honest_gap],
          registry,
          ontology,
        ),
      };
    }
  }

  return {
    topicId: w.id,
    kind: w.kind,
    evidenceBundle: selectEvidenceForTopic(w.id, registry, ontology),
  };
}
