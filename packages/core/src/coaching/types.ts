// ── Coaching bounded context — shared types ───────────────────────────────────
import type { EvidenceTag, Gap } from "../truth/index.js";

export interface Relevance {
  score: number;
  overlap: number;
  overlapTokens: string[];
  keywordHits: number;
}

export interface RankedEvidence {
  id: string;
  score: number;
  tag: EvidenceTag;
  why: string;
}

export interface CandidateGap {
  topic: string;
  coverage: "covered" | "partial" | "uncovered";
  /** EVD-* ids, up to 3, sorted by relevance score desc. */
  evidenceIds: string[];
  /** Max relevance score across the full registry (0 when registry is empty). */
  bestScore: number;
  existingGapId?: string;
  suggestedGapId?: string;
}

export type DrillKind = "gap" | "stretch" | "strength";

export interface DrillHistoryEntry {
  topicId: string;
  kind: DrillKind;
  at: string;
  questionRef?: string;
}

export interface DrillSelection {
  topicId: string;
  kind: DrillKind;
  /** Only set when kind === "gap". */
  gap?: Gap;
  evidenceBundle: RankedEvidence[];
}

export type PrepPackKind = "interview" | "networking" | "event";
