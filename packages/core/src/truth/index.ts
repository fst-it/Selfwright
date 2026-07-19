// ── Truth context public API ───────────────────────────────────────────────────
// Everything other bounded contexts may import from the truth context must go
// through this file. Direct imports into truth sub-files from outside are
// forbidden by FF-CONTEXT-1 (see fitness/src/checks/context-boundaries.ts).

// schemas/
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
} from "./schemas/index.js";
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
} from "./schemas/index.js";

// trace.ts
export {
  tokenize,
  entryTokens,
  traceClaims,
  splitSentences,
  extractQuantityPhrases,
  MIN_KEYWORD_OVERLAP,
} from "./trace.js";
export type { ClaimTrace, TraceResult } from "./trace.js";

// honesty.ts
export { scanHonestyBoundary } from "./honesty.js";
export type { HonestyViolation, HonestyResult } from "./honesty.js";

// errors.ts
export type { TruthError, TruthErrorKind } from "./errors.js";

// r19-guard.ts
export { guardSummary } from "./r19-guard.js";
export type { R19Result } from "./r19-guard.js";
