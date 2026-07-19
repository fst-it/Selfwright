import type { CompFloors } from "../truth/index.js";
import { DEFAULT_SCORING_VOCABULARY } from "./vocabulary.js";
import type { ScoringVocabulary } from "./vocabulary.js";
import type {
  CompAxisOpts,
  CompAxisResult,
  IndustryAxis,
  LocationAxis,
  PriorityResult,
  PriorityRole,
} from "./types.js";

// ── Industry buckets ──────────────────────────────────────────────────────────
//
// The industry-tier rules (anchor companies, per-tier keyword lists) are the
// owner's real targeting vocabulary — externalized to ScoringVocabulary
// (vocabulary.ts) per ADR 0017. Callers pass their data-layer vocabulary;
// DEFAULT_SCORING_VOCABULARY (synthetic) is used when none is supplied.

export function classifyIndustry(
  company: string,
  vocabulary: ScoringVocabulary = DEFAULT_SCORING_VOCABULARY,
): IndustryAxis {
  const c = company.toLowerCase();
  for (const tier of vocabulary.industryTiers) {
    for (const kw of tier.keywords) {
      if (c.includes(kw))
        return { bucket: tier.bucket, points: tier.points, norm: clamp01(tier.points / 5) };
    }
  }
  return { bucket: "it_services_or_other", points: 1, norm: clamp01(1 / 5) };
}

// ── Location axis ─────────────────────────────────────────────────────────────

function findCity(city: string, floors: CompFloors): CompFloors["cities"][number] | null {
  const target = city.toLowerCase().trim();
  if (!target) return null;
  return (
    floors.cities.find((c) => c.city.toLowerCase() === target) ??
    floors.cities.find(
      (c) =>
        target.includes(c.city.toLowerCase()) ||
        c.city.toLowerCase().includes(target),
    ) ??
    null
  );
}

export function locationAxis(city: string, floors: CompFloors): LocationAxis {
  const rec = findCity(city, floors);
  if (!rec)
    return { points: 0, norm: 0, country: null, in_scope: false };
  const points = rec.location_tier_points || 0;
  return {
    points,
    norm: clamp01(points / 6),
    country: rec.country,
    in_scope: points > 0,
  };
}

// ── Comp axis ─────────────────────────────────────────────────────────────────

export function compAxis(
  compEur: number | null | undefined,
  city: string,
  floors: CompFloors,
  opts: CompAxisOpts = {},
): CompAxisResult {
  const rec = findCity(city, floors);
  if (!rec)
    return { norm: 0.5, risk: "no_floor_data", floor_a_used: null, comp_eur: compEur ?? null };

  const floorA =
    opts.useRegime && rec.regime_floor_a_eur != null
      ? rec.regime_floor_a_eur
      : rec.floor_a_eur;
  const floorB = rec.floor_b_eur ?? Math.round(floorA * 1.175);

  if (compEur == null || Number.isNaN(compEur))
    return { norm: 0.5, risk: "undisclosed", floor_a_used: floorA, comp_eur: null };

  const comp = compEur;
  if (comp >= floorB)
    return { norm: 1.0, risk: null, floor_a_used: floorA, comp_eur: comp };
  if (comp >= floorA) {
    const t = (comp - floorA) / Math.max(1, floorB - floorA);
    return { norm: round2(0.7 + 0.29 * t), risk: null, floor_a_used: floorA, comp_eur: comp };
  }
  if (comp >= 0.9 * floorA)
    return { norm: 0.5, risk: "marginal", floor_a_used: floorA, comp_eur: comp };
  return { norm: 0.2, risk: "below", floor_a_used: floorA, comp_eur: comp };
}

export function fitNorm(fitScore: number | null | undefined): number {
  const f = Number(fitScore);
  if (Number.isNaN(f)) return 0;
  return clamp01(f / 5);
}

// ── Composite ─────────────────────────────────────────────────────────────────
// DORMANT SEAM (T4.1b): debrief-derived gap hints could be used here in a
// future iteration to boost priority for roles that surface known wobble topics.
// Not wired in Phase 4 — deliberate scope cut per ADR 0013.

export function computePriority(
  role: PriorityRole,
  floors: CompFloors,
  opts: CompAxisOpts = {},
  vocabulary: ScoringVocabulary = DEFAULT_SCORING_VOCABULARY,
): PriorityResult {
  const ind = classifyIndustry(role.company, vocabulary);
  const loc = locationAxis(role.scored_city, floors);
  const fit = fitNorm(role.fit_score);
  const comp = compAxis(role.comp_eur, role.scored_city, floors, opts);

  const priority_score = round2(ind.norm + loc.norm + fit + comp.norm);
  const companyLow = role.company.toLowerCase();

  const isAnchor = vocabulary.anchors.some((a) => companyLow.includes(a));

  return {
    priority_score,
    anchor: isAnchor,
    scored_city: role.scored_city || null,
    comp_risk: comp.risk,
    axes: {
      industry: ind,
      location: { points: loc.points, norm: round2(loc.norm), country: loc.country, in_scope: loc.in_scope },
      fit: { fit_score: role.fit_score ?? null, norm: round2(fit) },
      comp: { comp_eur: comp.comp_eur, norm: comp.norm, floor_a_used: comp.floor_a_used, risk: comp.risk },
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
