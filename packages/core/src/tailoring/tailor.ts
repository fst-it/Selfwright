import { err, ok } from "../shared/result.js";
import type { Result } from "../shared/result.js";
import type { CvContent, CvRole } from "../scoring/index.js";
import { traceClaims, guardSummary } from "../truth/index.js";
import type { EvidenceEntry, Identity, DriftEntry } from "../truth/index.js";
import type { AppliedDrift, CvOverlay } from "./overlay.js";
import type { EvidenceMap } from "./evidence-map.js";
import { applyDriftApplications } from "./drift-apply.js";
import type { CvRoleWithBullets } from "./drift-apply.js";

export interface TailorError {
  kind: "VALIDATION_ERROR";
  message: string;
}

export interface TailoredCvMeta {
  archetype: string | null;
  overlay_applied: string;
  generated_at: string;
  suppressed_evidence: string[];
  included_evidence: string[];
  applied_drifts?: AppliedDrift[];
  truth_warnings?: string[];
}

export interface TailoredCvContent extends CvContent {
  _tailor_meta: TailoredCvMeta;
}

export interface ApplyOverlayOpts {
  registry?: EvidenceEntry[];
  identity?: Identity;
  drifts?: DriftEntry[];
}

/**
 * Resolve a role_order name to its index in the roles array.
 *
 * Supports:
 * - Exact company name match: "Globex" → first role with that company
 * - Pipe-separated disambiguation: "Acme Corp|architect" → first role where
 *   company="Acme Corp" AND title contains "architect"
 * - Alias resolution via optional aliases map: "gpdl" → "Acme Corp|product data"
 */
function resolveRoleOrderName(
  name: string,
  roles: CvRole[],
  aliases?: Record<string, string>,
): number {
  const nameLower = name.toLowerCase();
  const resolved = (aliases?.[nameLower] ?? name).toLowerCase();

  // Pipe-separated "company|title-fragment" syntax for disambiguation
  const pipeIdx = resolved.indexOf("|");
  if (pipeIdx !== -1) {
    const company = resolved.slice(0, pipeIdx);
    const titleFrag = resolved.slice(pipeIdx + 1);
    return roles.findIndex(
      (r) =>
        r.company.toLowerCase() === company &&
        r.title.toLowerCase().includes(titleFrag),
    );
  }

  return roles.findIndex((r) => r.company.toLowerCase() === resolved);
}

export function applyOverlay(
  cv: CvContent,
  overlay: CvOverlay,
  evidenceMap: EvidenceMap,
  registryIds?: Set<string>,
  opts?: ApplyOverlayOpts,
): Result<TailoredCvContent, TailorError> {
  const suppressSet = new Set(overlay.suppress_evidence ?? []);
  const includeSet = new Set(overlay.include_evidence ?? []);

  // Validate EVD-* IDs against registryIds if provided
  if (registryIds !== undefined) {
    const allOverlayIds = [
      ...(overlay.suppress_evidence ?? []),
      ...(overlay.include_evidence ?? []),
    ];
    const unknown = allOverlayIds.filter((id) => !registryIds.has(id));
    if (unknown.length > 0) {
      return err({
        kind: "VALIDATION_ERROR",
        message: `Unknown evidence ID(s) in overlay: ${unknown.join(", ")}`,
      });
    }
  }

  // A-2: Validate overlay free-text fields before use.
  // overlay.summary and overlay.headline accept arbitrary strings — require
  // that they trace to evidence entries, not introduce new ungrounded claims.
  //
  // overlay.summary is exactly the "CV summary text" guardSummary's own
  // docstring is written for, so route it through guardSummary (identity's
  // roles_timeline folded in as grounding, on top of traceClaims) whenever
  // identity is available — the same check overlay.headline already gets
  // below. Fall back to a bare traceClaims when identity is absent so
  // registry-only callers keep their existing (slightly weaker) behavior
  // rather than silently skipping validation.
  if (overlay.summary && opts?.registry && opts.registry.length > 0) {
    const summaryCheck = opts.identity
      ? guardSummary(overlay.summary, opts.identity, opts.registry)
      : traceClaims(overlay.summary, opts.registry);
    const untraceable = "ungrounded" in summaryCheck ? summaryCheck.ungrounded : summaryCheck.untraceable;
    if (!summaryCheck.ok) {
      return err({
        kind: "VALIDATION_ERROR",
        message: `overlay.summary contains untraceable claims: ${untraceable.join("; ")}`,
      });
    }
  }

  if (overlay.headline && opts?.registry && opts.registry.length > 0 && opts.identity) {
    const guard = guardSummary(overlay.headline, opts.identity, opts.registry);
    if (!guard.ok) {
      return err({
        kind: "VALIDATION_ERROR",
        message: `overlay.headline is not grounded in the evidence registry: ${guard.ungrounded.join("; ")}`,
      });
    }
  }

  // Deep-copy roles with bullets guaranteed present, then apply governed
  // drift_applications *before* suppress/reorder/emphasis processing so
  // target.bullet indexes original positions.
  const baseRoles: CvRoleWithBullets[] = (cv.roles ?? []).map((role) => ({
    ...role,
    bullets: [...(role.bullets ?? [])],
  }));

  const baseSkills =
    overlay.skills && overlay.skills.length > 0 ? overlay.skills : (cv.skills ?? []);

  const driftResult = applyDriftApplications(
    baseRoles,
    baseSkills,
    overlay.drift_applications ?? [],
    opts?.drifts ?? [],
    (name) => resolveRoleOrderName(name, baseRoles, overlay.company_aliases),
  );
  if (!driftResult.ok) return driftResult;

  const originalRoles: CvRole[] = driftResult.value.roles;

  function getBulletEvidence(roleIdx: number, bulletIdx: number): string[] {
    return (
      evidenceMap.roles[String(roleIdx)]?.bullets?.[String(bulletIdx)]
        ?.evidence ?? []
    );
  }

  function isBulletSuppressed(roleIdx: number, bulletIdx: number): boolean {
    const ids = getBulletEvidence(roleIdx, bulletIdx);
    if (ids.length === 0) return false;
    return ids.every((id) => suppressSet.has(id));
  }

  function isBulletDeemphasized(roleIdx: number, bulletIdx: number): boolean {
    if (includeSet.size === 0) return false;
    const ids = getBulletEvidence(roleIdx, bulletIdx);
    if (ids.length === 0) return true;
    return !ids.some((id) => includeSet.has(id));
  }

  function processRoleBullets(role: CvRole, roleIdx: number): string[] {
    const originalBullets = role.bullets ?? [];
    if (originalBullets.length === 0) return [];

    const bulletOrderMap = overlay.bullet_order ?? {};
    const roleName = role.company.toLowerCase();

    const explicitOrder =
      bulletOrderMap[role.company] ??
      bulletOrderMap[roleName] ??
      bulletOrderMap[String(roleIdx)];

    if (explicitOrder !== undefined) {
      const ordered = explicitOrder
        .filter(
          (idx) =>
            idx >= 0 &&
            idx < originalBullets.length &&
            !isBulletSuppressed(roleIdx, idx),
        )
        .map((idx) => originalBullets[idx] as string);
      if (ordered.length > 0) return ordered;
      return originalBullets;
    }

    const emphasized: string[] = [];
    const deemphasized: string[] = [];

    for (let i = 0; i < originalBullets.length; i++) {
      const bullet = originalBullets[i] as string;
      if (isBulletSuppressed(roleIdx, i)) continue;
      if (isBulletDeemphasized(roleIdx, i)) {
        deemphasized.push(bullet);
      } else {
        emphasized.push(bullet);
      }
    }

    const result = [...emphasized, ...deemphasized];
    if (result.length === 0) return originalBullets;
    return result;
  }

  const processedBullets = originalRoles.map((role, idx) =>
    processRoleBullets(role, idx),
  );

  function reorderRoles(
    roleOrder?: string[],
    aliases?: Record<string, string>,
  ): CvRoleWithBullets[] {
    if (!roleOrder || roleOrder.length === 0) {
      return originalRoles.map((role, idx) => ({
        ...role,
        bullets: processedBullets[idx] ?? [],
      }));
    }

    const placed = new Set<number>();
    const ordered: CvRoleWithBullets[] = [];

    for (const name of roleOrder) {
      const idx = resolveRoleOrderName(name, originalRoles, aliases);
      if (idx === -1 || placed.has(idx)) continue;
      placed.add(idx);
      const role = originalRoles[idx];
      if (role !== undefined) {
        ordered.push({ ...role, bullets: processedBullets[idx] ?? [] });
      }
    }

    for (let i = 0; i < originalRoles.length; i++) {
      if (!placed.has(i)) {
        const role = originalRoles[i];
        if (role !== undefined) {
          ordered.push({ ...role, bullets: processedBullets[i] ?? [] });
        }
      }
    }

    return ordered;
  }

  const reorderedRoles = reorderRoles(overlay.role_order, overlay.company_aliases);

  const headline = overlay.headline?.trim() || cv.headline;
  const summary = overlay.summary?.trim() || cv.summary;
  const citizenship = overlay.citizenship?.trim() || cv.citizenship;

  const skills = driftResult.value.skills;

  const meta: TailoredCvMeta = {
    archetype: overlay.archetype ?? null,
    overlay_applied: new Date().toISOString(),
    generated_at: new Date().toISOString(),
    suppressed_evidence: [...suppressSet],
    included_evidence: [...includeSet],
  };

  if (driftResult.value.applied.length > 0) {
    meta.applied_drifts = driftResult.value.applied;
  }

  const tailored: TailoredCvContent = {
    ...cv,
    headline,
    summary,
    skills,
    citizenship,
    roles: reorderedRoles,
    _tailor_meta: meta,
  };

  return ok(tailored);
}

export { resolveRoleOrderName as _resolveRoleOrderName };
