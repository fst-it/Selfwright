// Schema-only barrel (T5.10): re-exports just the pure, I/O-free config
// schemas/types — never the node:fs-based loaders (loadModelsConfig,
// loadScanTargets, loadSettings, all in index.ts's fuller barrel). Consumed
// by @selfwright/api-contract so a browser bundle (apps/web-ui) that only
// needs SettingsSchema for client-side response validation never has
// node:fs anywhere in its module graph.
//
// Splitting the pure schema modules from the loaders (models.ts/settings.ts/
// scan-targets.ts vs *-loader.ts) was necessary but not sufficient on its
// own: Rollup still binds every export re-exported by a barrel it includes
// at all, even ones nothing downstream uses — so index.ts's single barrel
// (which re-exports both halves together) still pulled node:fs into a
// browser build's module graph and failed. A dedicated subpath export
// (package.json "exports"."./schemas") that only ever contains the pure
// half sidesteps that: apps/web-ui's import graph never opens index.ts (or
// therefore the loader files) at all.
export { ModelRoleSchema, ModelsConfigSchema } from "./models.js";
export type { ModelRole, ModelsConfig } from "./models.js";
export { ScanTargetSchema, ScanTargetsConfigSchema } from "./scan-targets.js";
export type { ScanTargetConfig, ScanTargetsConfig } from "./scan-targets.js";
export {
  DEFAULT_QUEUE_AGING_WINDOW_DAYS,
  DEFAULT_FIT_SCORE_CUTOFF_REVIEW_SOON,
  DEFAULT_INTERVIEW_STALE_DAYS,
  DEFAULT_APPLIED_REVIEW_DAYS,
  DEFAULT_APPLIED_DECIDE_DAYS,
  SettingsSchema,
} from "./settings.js";
export type { Settings, LoadedSettings } from "./settings.js";
