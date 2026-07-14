export { buildSynonymMap, scorePosting, computeAts, flattenCv, runPassA, runPassB, classifyIndustry, compAxis, computePriority, fitNorm, locationAxis, scoreJd, CvContentSchema, DEFAULT_SCORING_VOCABULARY, ScoringVocabularySchema, IndustryTierSchema } from "./scoring/index.js";
export type { AtsResult, CompAxisOpts, CompAxisResult, CompRisk, CvContent, CvRole, DimScore, DimensionResult, FitAxis, FitGrade, IndustryAxis, JdDimensions, JdScoreResult, LocationAxis, MissingTruthfulTerm, MissingUnsupportedTerm, PassACheck, PassAResult, PassBResult, Posting, PriorityResult, PriorityRole, ScanTimeDimensions, ScanTimeResult, ScoringVocabulary, IndustryTier } from "./scoring/index.js";

export { bandFor, blendScore, companyToken, computeDrift, filterActiveDrifts, slugifyCompany, validateDrift } from "./drifts/index.js";
export type { DriftComputeResult, DriftValidationResult } from "./drifts/index.js";

export type { LlmPort, LlmRequest, LlmResult, LlmUsage, Message } from "./ports/llm.js";
export type { StoragePort } from "./ports/storage.js";
export type { TruthPort } from "./ports/truth.js";

export { err, ok } from "./shared/result.js";
export type { Err, Ok, Result } from "./shared/result.js";

export {
  TagLevelSchema,
  EvidenceTagSchema,
  EvidenceEntrySchema,
  EvidenceRegistrySchema,
  tagLevels,
  IdentitySchema,
  CityFloorSchema,
  CompFloorsSchema,
  DriftEntrySchema,
  DriftLedgerSchema,
  DriftIndexSchema,
  computeRubricScore,
  rubricScoreMatchesFactors,
  ArchetypeSchema,
  OntologySchema,
  GapSchema,
  GapsFileSchema,
} from "./truth/index.js";

export type {
  TagLevel,
  EvidenceTag,
  EvidenceEntry,
  EvidenceRegistry,
  Identity,
  CityFloor,
  CompFloors,
  DriftEntry,
  DriftLedger,
  DriftIndex,
  Archetype,
  Ontology,
  Gap,
  GapsFile,
  TruthError,
  TruthErrorKind,
} from "./truth/index.js";

// tailoring
export { applyOverlay, CvOverlaySchema, DriftApplicationSchema } from "./tailoring/index.js";
export type {
  CvOverlay,
  EvidenceMap,
  TailoredCvContent,
  TailoredCvMeta,
  TailorError,
  DriftApplication,
  AppliedDrift,
} from "./tailoring/index.js";

// coaching
export {
  expandTerm,
  relevance,
  selectEvidenceForTopic,
  computeCoverageGaps,
  computeCoverageGapsForKeywords,
  selectNextDrillTopic,
  DebriefSchema,
  DebriefsFileSchema,
  deriveGapHintsFromDebriefs,
  findUndebriefedInterviews,
} from "./coaching/index.js";
export type {
  Relevance,
  RankedEvidence,
  CandidateGap,
  DrillKind,
  DrillHistoryEntry,
  DrillSelection,
  PrepPackKind,
  Debrief,
  DebriefsFile,
  GapHint,
  ApplicationSummary,
} from "./coaching/index.js";

// content
export { selectContentTopics, selectContentTopicsForApplication, deriveJdTopicKeywords } from "./content/index.js";
export type {
  ContentDirection,
  ContentTopicCandidate,
  ContentHistoryEntry,
} from "./content/index.js";

// services
export {
  computeNorthStar,
  computeChannelOutcomes,
  APPLICATION_STATUSES,
  SUBMITTED_STATUSES,
  INTERVIEWED_STATUSES,
} from "./services/index.js";
export type { ChannelOutcome, ApplicationStatus } from "./services/index.js";
export {
  score as scoreService,
  ats as atsService,
  tailor as tailorService,
  cover as coverService,
  research as researchService,
  inbox as inboxService,
  promoteQueueEntry,
  buildGapScanReport as gapScanService,
  drill as drillService,
  prepPack as prepPackService,
  topics as topicsService,
  buildCoverSystemPrompt,
  buildCoverUserPrompt,
  buildResearchPrompt,
  buildDrillSystemPrompt,
  buildDrillUserPrompt,
  buildPrepPackSystemPrompt,
  buildPrepPackUserPrompt,
  buildTopicsSystemPrompt,
  buildTopicsUserPrompt,
  validateCoverArtifact,
  validateResearchArtifact,
  validatePrepPackArtifact,
  validateDrillArtifact,
  validateGapArtifact,
  validateTopicsArtifact,
  BANNED_AI_TELLS,
  scanAiTells,
} from "./services/index.js";
export type {
  ScoreInput,
  AtsInput,
  TailorOpts,
  CoverContext,
  CoverResult,
  ResearchContext,
  ResearchResult,
  InboxData,
  InboxReport,
  InboxItem,
  ApplicationRecord,
  QueueEntry,
  GenerationGuardResult,
  CoverArtifactContext,
  ResearchArtifactContext,
  PrepPackArtifactContext,
  DrillArtifactContext,
  GapArtifactContext,
  TopicsArtifactContext,
  DrillContext,
  DrillResult,
  PrepPackContext,
  PrepPackResult,
  TopicsContext,
  TopicsResult,
  AiTellEntry,
} from "./services/index.js";
// GapHint/Debrief/DebriefsFile are exported from the coaching section above

// ports
export type { RenderPort, RenderRequest, RenderResult } from "./ports/render.js";
export type { ScanProvider, ScanFetchContext, RawFetchResult } from "./ports/scan-provider.js";
export type { MemoryPort, MemoryEntry, MemorySearchResult } from "./ports/memory.js";

// scanning
export {
  checkLiveness,
  isSeen,
  dedupeByCompanyRole,
  dedupeByCompanyRoleFuzzy,
  areSimilarTitles,
  toQueueEntry,
  hashUrl,
  evaluatePosting,
  runScan,
  buildManualEntry,
  isStaleEntry,
  partitionQueueByAge,
  backfillQueuedAt,
  DEFAULT_AGING_WINDOW_DAYS,
} from "./scanning/index.js";
export type {
  RawPosting,
  ScanTarget,
  LivenessOpts,
  LivenessStatus,
  LivenessVerdict,
  SeenEntry,
  ScanResult,
  RunScanInput,
  RunScanResult,
  RunScanStats,
  ManualAddInput,
  ManualAddResult,
  QueueAgePartition,
} from "./scanning/index.js";
