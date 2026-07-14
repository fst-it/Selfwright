export { expandTerm, relevance, selectEvidenceForTopic } from "./retrieval.js";
export { computeCoverageGaps, computeCoverageGapsForKeywords } from "./coverage.js";
export { selectNextDrillTopic } from "./drill-select.js";
export type {
  Relevance,
  RankedEvidence,
  CandidateGap,
  DrillKind,
  DrillHistoryEntry,
  DrillSelection,
  PrepPackKind,
} from "./types.js";
export {
  DebriefSchema,
  DebriefsFileSchema,
  deriveGapHintsFromDebriefs,
  findUndebriefedInterviews,
} from "./debrief.js";
export type {
  Debrief,
  DebriefsFile,
  GapHint,
  ApplicationSummary,
} from "./debrief.js";
