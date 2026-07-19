import { applyOverlay } from "../tailoring/index.js";
import type { Result } from "../shared/result.js";
import type { CvContent } from "../scoring/index.js";
import { scanHonestyBoundary } from "../truth/index.js";
import type { EvidenceEntry, Identity, DriftEntry } from "../truth/index.js";
import type { CvOverlay, EvidenceMap, TailoredCvContent } from "../tailoring/index.js";
import type { TailorError } from "../tailoring/index.js";

export interface TailorOpts {
  registry?: EvidenceEntry[];
  identity?: Identity;
  drifts?: DriftEntry[];
}

export function tailor(
  cv: CvContent,
  overlay: CvOverlay,
  evidenceMap: EvidenceMap,
  registryIds?: Set<string>,
  opts?: TailorOpts,
): Result<TailoredCvContent, TailorError> {
  const result = applyOverlay(cv, overlay, evidenceMap, registryIds, opts);
  if (!result.ok) return result;

  // C-4: Post-validate the tailored output for honesty boundary violations.
  // Advisory: adds truth_warnings to meta but does not block the result.
  // Scans the summary AND every applied-drift claim — a replaced/injected
  // bullet is as much an outward claim as the summary is.
  if (opts?.registry && opts.registry.length > 0 && opts.identity) {
    const appliedClaims = (result.value._tailor_meta.applied_drifts ?? []).map((d) => d.claim);
    const text = [result.value.summary ?? "", ...appliedClaims].join(" ");
    const honesty = scanHonestyBoundary(text, opts.drifts ?? [], opts.registry);
    if (!honesty.ok) {
      result.value._tailor_meta.truth_warnings = honesty.violations.map(
        (v) => `retired ${v.source}: "${v.phrase}"`,
      );
    }
  }

  return result;
}
