// @selfwright/api-contract — the typed /api/* JSON contract shared by the Hono
// server (apps/web) and, from T5.10, the React cockpit. INTERNAL contract, not
// a public API (see docs/MANUAL.md).
export { hasControlChars } from "./validation.js";
export { ApiErrorCodeSchema, ApiErrorEnvelopeSchema } from "./errors.js";
export type { ApiErrorCode, ApiErrorEnvelope } from "./errors.js";
export { API_CONTRACT_VERSION, MetaResponseSchema } from "./meta.js";
export type { MetaResponse } from "./meta.js";
export {
  ApplicationRecordSchema,
  ApplicationsListResponseSchema,
  StatusUpdateRequestSchema,
  StatusUpdateResponseSchema,
} from "./applications.js";
export type {
  ApplicationRecordContract,
  ApplicationsListResponse,
  StatusUpdateRequest,
  StatusUpdateResponse,
} from "./applications.js";
export {
  QueueEntrySchema,
  QueueResponseSchema,
  PromoteQueueEntryRequestSchema,
  PromoteQueueEntryResponseSchema,
  DismissQueueEntryResponseSchema,
} from "./queue.js";
export type {
  QueueEntryContract,
  QueueResponse,
  PromoteQueueEntryRequest,
  PromoteQueueEntryResponse,
  DismissQueueEntryResponse,
} from "./queue.js";
export {
  DrillKindSchema,
  RankedEvidenceSchema,
  DrillSelectionSchema,
  CoachingResponseSchema,
  DebriefCreateRequestSchema,
  DebriefCreateResponseSchema,
} from "./coaching.js";
export type {
  RankedEvidenceContract,
  DrillSelectionContract,
  CoachingResponse,
  DebriefCreateRequest,
  DebriefCreateResponse,
} from "./coaching.js";
export { ContentResponseSchema } from "./content.js";
export type { ContentResponse } from "./content.js";
export { NorthStarSchema, ChannelOutcomeSchema, FitnessRunSchema, ReportingResponseSchema } from "./reporting.js";
export type { NorthStarContract, ChannelOutcomeContract, FitnessRunContract, ReportingResponse } from "./reporting.js";
export { OverviewResponseSchema } from "./overview.js";
export type { OverviewResponse } from "./overview.js";
export { InboxItemSchema, InboxResponseSchema } from "./inbox.js";
export type { InboxItemContract, InboxResponse } from "./inbox.js";
export { SettingsContractSchema, SettingsUpdateRequestSchema, SettingsUpdateResponseSchema } from "./settings.js";
export type { SettingsContract, SettingsUpdateResponse } from "./settings.js";
export {
  ScanTargetsContractSchema,
  ScanTargetSchema,
  ScanTargetsUpdateRequestSchema,
  ScanTargetsUpdateResponseSchema,
} from "./scan-targets.js";
export type {
  ScanTargetsContract,
  ScanTargetConfig,
  ScanTargetsUpdateResponse,
} from "./scan-targets.js";
