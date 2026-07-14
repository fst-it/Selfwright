export { computeNorthStar } from "./north-star.js";
export { computeChannelOutcomes } from "./channel-outcomes.js";
export type { ChannelOutcome } from "./channel-outcomes.js";
export { score } from "./score.js";
export { ats } from "./ats.js";
export { tailor } from "./tailor.js";
export { cover, buildCoverSystemPrompt, buildCoverUserPrompt } from "./cover.js";
export { research, buildResearchPrompt } from "./research.js";
export { inbox } from "./inbox.js";
export { promoteQueueEntry } from "./queue-promote.js";
export { buildGapScanReport } from "./gap-scan.js";
export { drill, buildDrillSystemPrompt, buildDrillUserPrompt } from "./drill.js";
export { prepPack, buildPrepPackSystemPrompt, buildPrepPackUserPrompt } from "./prep-pack.js";
export { validateCoverArtifact, validateResearchArtifact, validatePrepPackArtifact, validateDrillArtifact, validateGapArtifact, validateTopicsArtifact } from "./generation-guard.js";
export type { GenerationGuardResult, CoverArtifactContext, ResearchArtifactContext, PrepPackArtifactContext, DrillArtifactContext, GapArtifactContext, TopicsArtifactContext } from "./generation-guard.js";
export { BANNED_AI_TELLS, scanAiTells } from "./ai-tells.js";
export type { AiTellEntry } from "./ai-tells.js";
export type { DrillContext, DrillResult } from "./drill.js";
export type { PrepPackContext, PrepPackResult } from "./prep-pack.js";
export { topics, buildTopicsSystemPrompt, buildTopicsUserPrompt } from "./topics.js";
export type { TopicsContext, TopicsResult } from "./topics.js";

export { APPLICATION_STATUSES, SUBMITTED_STATUSES, INTERVIEWED_STATUSES } from "./types.js";
export type {
  ApplicationStatus,
  ScoreInput,
  JdScoreResult,
  AtsInput,
  AtsResult,
  CvOverlay,
  EvidenceMap,
  TailoredCvContent,
  TailorError,
  TailorOpts,
  CoverContext,
  CoverResult,
  ResearchContext,
  ResearchResult,
  ApplicationRecord,
  QueueEntry,
  InboxItem,
  InboxData,
  InboxReport,
} from "./types.js";
// Re-export for consumers that import from the services barrel
export type { GapHint, Debrief, DebriefsFile } from "../coaching/index.js";
