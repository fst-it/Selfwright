export { buildSynonymMap, scorePosting } from "./score.js";
export { norm } from "./text.js";
export { computeAts, flattenCv, runPassA, runPassB } from "./ats.js";
export { classifyIndustry, compAxis, computePriority, fitNorm, locationAxis } from "./priority.js";
export { scoreJd } from "./jd-score.js";
export { CvContentSchema } from "./types.js";
export { DEFAULT_SCORING_VOCABULARY, ScoringVocabularySchema, IndustryTierSchema } from "./vocabulary.js";
export type { ScoringVocabulary, IndustryTier } from "./vocabulary.js";
export type {
  AtsResult,
  DimScore,
  CompAxisOpts,
  CompAxisResult,
  CompRisk,
  CvContent,
  CvRole,
  DimensionResult,
  FitAxis,
  FitGrade,
  IndustryAxis,
  JdDimensions,
  JdScoreResult,
  LocationAxis,
  MissingTruthfulTerm,
  MissingUnsupportedTerm,
  PassACheck,
  PassAResult,
  PassBResult,
  Posting,
  PriorityResult,
  PriorityRole,
  ScanTimeDimensions,
  ScanTimeResult,
} from "./types.js";
