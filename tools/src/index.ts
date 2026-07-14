export { appendUsageRecord, buildUsageRecord } from "./metrics.js";
export type { UsageRecord } from "./metrics.js";
export {
  BASE_PII_PATTERNS,
  escapeRegex,
  findDataPathViolations,
  findPiiViolationsInContent,
  isNamedEntityScannableFile,
  isScannableFile,
  loadConfidentialPatterns,
} from "./data-leak-gate.js";
export { checkTextForPii } from "./check-text-for-pii.js";
export type { PiiTextCheckResult } from "./check-text-for-pii.js";
export { isValidApplicationEntry, isValidFitnessRecord } from "./sync-db-helpers.js";
