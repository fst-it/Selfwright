export { CvOverlaySchema, DriftApplicationModeSchema, DriftApplicationSchema } from "./overlay.js";
export type { CvOverlay, DriftApplicationMode, DriftApplication, AppliedDrift } from "./overlay.js";

export { EvidenceMapSchema } from "./evidence-map.js";
export type { EvidenceMap, RoleEvidence, BulletEvidence } from "./evidence-map.js";

export { applyDriftApplications } from "./drift-apply.js";
export type { CvRoleWithBullets, DriftApplyError, DriftApplyPolicy, DriftApplyResult } from "./drift-apply.js";

export { applyOverlay } from "./tailor.js";
export type { TailoredCvContent, TailoredCvMeta, TailorError, ApplyOverlayOpts } from "./tailor.js";
