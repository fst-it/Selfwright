// ── Content bounded context — shared types ─────────────────────────────────
import type { RankedEvidence } from "../coaching/index.js";

export type ContentDirection = "write" | "read";

export interface ContentTopicCandidate {
  topic: string;
  direction: ContentDirection;
  kind: "strength" | "stretch" | "gap" | "uncovered";
  /** Priority score (base × freshness); tie-broken by bestScore then topic alpha. */
  score: number;
  evidenceBundle: RankedEvidence[];
  /** Set for read candidates linked to an existing or suggested GAP-* id. */
  gapId?: string;
}

export interface ContentHistoryEntry {
  topic: string;
  direction: ContentDirection;
  at: string;
}
