import { CvOverlaySchema } from "@selfwright/core";
import type { CvOverlay } from "@selfwright/core";

/**
 * career_plan's real overlay shape for `inject_drifts` entries — either a bare
 * drift-id string (the old Selfwright-native stub, keyword-union only) or an
 * object `{ id, role, mode, replace_bullet }` (career_plan's actual fixture
 * shape, e.g. `20-applications/2026-06-globex-ctrm-architect/cv-overlay.json`).
 * `mode` there is a closed `"append" | "replace"` enum — narrower than the
 * canonical `DriftApplicationMode`, which adds `"keywords-only"`.
 */
interface LegacyDriftInjection {
  id?: unknown;
  role?: unknown;
  mode?: unknown;
  replace_bullet?: unknown;
}

function migrateDriftInjection(entry: unknown): unknown {
  if (typeof entry === "string") {
    // Old Selfwright-native stub: bare id, keyword-union-only semantics.
    return { id: entry, mode: "keywords-only" };
  }
  if (typeof entry !== "object" || entry === null) {
    // Not a recognized legacy shape — pass through unchanged and let
    // CvOverlaySchema.parse report the real validation error.
    return entry;
  }
  const legacy = entry as LegacyDriftInjection;
  if (legacy.mode === "replace") {
    return {
      id: legacy.id,
      mode: "replace",
      target: { role: legacy.role, bullet: legacy.replace_bullet },
    };
  }
  if (legacy.mode === "append") {
    return legacy.role !== undefined
      ? { id: legacy.id, mode: "inject", target: { role: legacy.role } }
      : { id: legacy.id, mode: "inject" };
  }
  // Unrecognized/missing mode — the conservative migration is keywords-only:
  // it cannot silently mutate bullet prose for a directive it doesn't understand.
  return { id: legacy.id, mode: "keywords-only" };
}

/**
 * Migrate a raw, parsed overlay JSON object from career_plan's legacy
 * `inject_drifts` shape to the canonical `drift_applications` shape, then
 * validate the result against `CvOverlaySchema`. Throws a Zod error if the
 * migrated overlay still doesn't conform (e.g. a legacy entry missing `id`).
 *
 * If `drift_applications` is already present, it is assumed canonical and
 * passed through unchanged; `inject_drifts` is ignored in that case.
 */
export function migrateCareerPlanOverlay(raw: unknown): CvOverlay {
  const obj = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const { inject_drifts: injectDrifts, drift_applications: driftApplications, ...rest } = obj;

  const migrated = driftApplications !== undefined
    ? driftApplications
    : Array.isArray(injectDrifts)
      ? injectDrifts.map(migrateDriftInjection)
      : undefined;

  return CvOverlaySchema.parse({
    ...rest,
    ...(migrated !== undefined ? { drift_applications: migrated } : {}),
  });
}
