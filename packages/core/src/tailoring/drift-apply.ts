import { err, ok } from "../shared/result.js";
import type { Result } from "../shared/result.js";
import type { CvRole } from "../scoring/index.js";
import type { DriftEntry } from "../truth/index.js";
import type { AppliedDrift, DriftApplication } from "./overlay.js";

export interface CvRoleWithBullets extends CvRole {
  bullets: string[];
}

export interface DriftApplyError {
  kind: "VALIDATION_ERROR";
  message: string;
}

export interface DriftApplyPolicy {
  autoApplyBands: Array<"safe" | "caution" | "high-risk">;
}

const DEFAULT_POLICY: DriftApplyPolicy = { autoApplyBands: ["safe", "caution"] };

export interface DriftApplyResult {
  roles: CvRoleWithBullets[];
  skills: string[];
  applied: AppliedDrift[];
}

/**
 * Apply governed `drift_applications` directives to roles/skills.
 *
 * Pure: never mutates its inputs, always returns fresh arrays when it applies
 * anything. Callers must pass `roles` with `target.bullet`-indexable, original
 * (pre-suppress/reorder) bullet arrays — see tailor.ts, which runs this before
 * `processRoleBullets`.
 */
export function applyDriftApplications(
  roles: CvRoleWithBullets[],
  skills: string[],
  applications: DriftApplication[],
  driftRegistry: DriftEntry[],
  resolveRole: (name: string) => number,
  policy: DriftApplyPolicy = DEFAULT_POLICY,
): Result<DriftApplyResult, DriftApplyError> {
  if (applications.length === 0) {
    return ok({ roles, skills, applied: [] });
  }

  const driftMap = new Map(driftRegistry.map((d) => [d.id, d] as const));
  const unknown = applications.filter((a) => !driftMap.has(a.id)).map((a) => a.id);
  if (unknown.length > 0) {
    return err({
      kind: "VALIDATION_ERROR",
      message: `Unknown drift ID(s) in drift_applications: ${unknown.join(", ")}`,
    });
  }

  const nextRoles = roles.map((r) => ({ ...r, bullets: [...r.bullets] }));
  const skillSet = new Set(skills);
  const applied: AppliedDrift[] = [];

  for (const application of applications) {
    const drift = driftMap.get(application.id);
    // Unreachable (ids were validated above); narrows `drift` for TS.
    if (drift === undefined) continue;
    // Non-active drifts (proposed/promoted/retired) are silently skipped —
    // referencing them is not an error, they just don't apply.
    if (drift.status !== "active") continue;

    const band = drift.confidence.band;
    if (!policy.autoApplyBands.includes(band) && !application.allow_high_risk) {
      return err({
        kind: "VALIDATION_ERROR",
        message: `Drift ${drift.id} is band "${band}" and requires allow_high_risk: true to apply`,
      });
    }

    for (const kw of drift.keywords) skillSet.add(kw);

    const record: AppliedDrift = {
      id: drift.id,
      mode: application.mode,
      claim: drift.claim,
      band,
    };

    if (application.mode !== "keywords-only") {
      const targetRoleName = application.target?.role;
      let roleIdx = targetRoleName !== undefined ? resolveRole(targetRoleName) : -1;
      // No resolvable target named on the directive → fall back to the
      // drift's own org, which is always a defensible anchor.
      if (roleIdx === -1) roleIdx = resolveRole(drift.org);

      const role = roleIdx !== -1 ? nextRoles[roleIdx] : undefined;
      if (role === undefined) {
        return err({
          kind: "VALIDATION_ERROR",
          message: `Drift ${drift.id}: could not resolve target role "${targetRoleName ?? drift.org}"`,
        });
      }

      if (application.mode === "replace") {
        const bulletIdx = application.target?.bullet;
        if (bulletIdx === undefined || bulletIdx < 0 || bulletIdx >= role.bullets.length) {
          return err({
            kind: "VALIDATION_ERROR",
            message: `Drift ${drift.id}: target.bullet ${String(bulletIdx)} out of range for role "${role.company}" (${role.bullets.length} bullets)`,
          });
        }
        role.bullets[bulletIdx] = drift.claim;
        record.bullet = bulletIdx;
      } else {
        // inject
        const bulletIdx = application.target?.bullet;
        if (bulletIdx !== undefined && bulletIdx >= 0 && bulletIdx <= role.bullets.length) {
          role.bullets.splice(bulletIdx, 0, drift.claim);
          record.bullet = bulletIdx;
        } else {
          role.bullets.push(drift.claim);
          record.bullet = role.bullets.length - 1;
        }
      }

      record.role = role.company;
    }

    applied.push(record);
  }

  return ok({ roles: nextRoles, skills: [...skillSet], applied });
}
