export { checkLiveness } from "./liveness.js";
export type { LivenessOpts } from "./liveness.js";
export { isSeen, dedupeByCompanyRole, dedupeByCompanyRoleFuzzy, areSimilarTitles } from "./dedup.js";
export { toQueueEntry, hashUrl } from "./queue-entry.js";
export { evaluatePosting } from "./scan.js";
export { runScan } from "./orchestrate.js";
export type { RunScanInput, RunScanResult, RunScanStats } from "./orchestrate.js";
export { buildManualEntry } from "./queue-add.js";
export type { ManualAddInput, ManualAddResult } from "./queue-add.js";
export { isStaleEntry, partitionQueueByAge, backfillQueuedAt, DEFAULT_AGING_WINDOW_DAYS } from "./queue-aging.js";
export type { QueueAgePartition } from "./queue-aging.js";
export type {
  RawPosting,
  ScanTarget,
  LivenessStatus,
  LivenessVerdict,
  SeenEntry,
  ScanResult,
  QueueEntry,
} from "./types.js";
