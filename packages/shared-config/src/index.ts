// Barrel re-export. Split into pure schema modules (models.ts,
// scan-targets.ts, settings.ts — zero I/O) and their node:fs-based loader
// counterparts (models-loader.ts, scan-targets-loader.ts, settings-loader.ts)
// so a bundler consuming only a schema (e.g. apps/web-ui's browser bundle,
// via @selfwright/api-contract re-exporting SettingsSchema) can tree-shake
// the loaders — and node:fs — out entirely (T5.10). Every export below has
// the same name and behavior it had before the split; this is a pure
// reorganization of file layout, not a behavior change.
export { ModelRoleSchema, ModelsConfigSchema } from "./models.js";
export type { ModelRole, ModelsConfig } from "./models.js";
export { loadModelsConfig } from "./models-loader.js";

export { KNOWN_PROVIDERS, ScanTargetSchema, ScanTargetsConfigSchema } from "./scan-targets.js";
export type { KnownProvider, ScanTargetConfig, ScanTargetsConfig } from "./scan-targets.js";
export { loadScanTargets } from "./scan-targets-loader.js";

export {
  DEFAULT_QUEUE_AGING_WINDOW_DAYS,
  DEFAULT_FIT_SCORE_CUTOFF_REVIEW_SOON,
  DEFAULT_INTERVIEW_STALE_DAYS,
  DEFAULT_APPLIED_REVIEW_DAYS,
  DEFAULT_APPLIED_DECIDE_DAYS,
  SettingsSchema,
} from "./settings.js";
export type { Settings, LoadedSettings } from "./settings.js";
export { loadSettings } from "./settings-loader.js";
