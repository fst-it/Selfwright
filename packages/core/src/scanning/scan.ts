import type { Archetype } from "../truth/index.js";
import { scorePosting } from "../scoring/index.js";
import type { ScoringVocabulary } from "../scoring/index.js";
import { checkLiveness } from "./liveness.js";
import type { LivenessOpts } from "./liveness.js";
import type { RawPosting, ScanResult } from "./types.js";

/**
 * Score-time evaluation of one fetched posting: liveness + scan-time fit
 * (reuses scorePosting — the existing scan-time rubric — no new scoring logic).
 */
export function evaluatePosting(
  posting: RawPosting,
  archetypes: Archetype[],
  synonymMap: Map<string, string>,
  livenessOpts: LivenessOpts = {},
  vocabulary?: ScoringVocabulary,
): ScanResult {
  const scored = scorePosting(
    {
      title: posting.title,
      company: posting.company,
      location: posting.location,
      ...(posting.description !== undefined ? { description: posting.description } : {}),
    },
    archetypes,
    synonymMap,
    vocabulary,
  );

  // Structured ATS API providers (Greenhouse, Lever, Ashby, Workday,
  // SmartRecruiters, BambooHR) return only active postings — no description
  // field is available, and applying content heuristics to an empty string
  // would wrongly classify every ATS posting as "expired". Trust the source.
  if (posting.sourceKind === "structured") {
    return {
      posting,
      liveness: { status: "live", reason: "structured ATS API source — live by construction" },
      archetype: scored.archetype,
      fitScore: scored.fit_score,
      grade: scored.grade,
    };
  }

  // A posting carrying its own observed HTTP status/finalUrl (single-page
  // fetchers like the generic provider) feeds that into checkLiveness even
  // when the caller didn't explicitly pass it — this is what makes a 403/404
  // on a specific posting URL classify correctly instead of silently
  // falling back to text-pattern-only classification.
  const effectiveOpts: LivenessOpts = {
    ...(posting.httpStatus !== undefined ? { httpStatus: posting.httpStatus } : {}),
    ...(posting.finalUrl !== undefined ? { finalUrl: posting.finalUrl } : {}),
    ...livenessOpts,
  };
  const liveness = checkLiveness(posting.description ?? "", effectiveOpts);
  return {
    posting,
    liveness,
    archetype: scored.archetype,
    fitScore: scored.fit_score,
    grade: scored.grade,
  };
}
