import type { Archetype, Ontology } from "../truth/index.js";
import { jaccard, norm, tokenWords, STOP_WORDS } from "./text.js";
import { DEFAULT_SCORING_VOCABULARY } from "./vocabulary.js";
import type { ScoringVocabulary } from "./vocabulary.js";
import type { DimScore, FitGrade, Posting, ScanTimeDimensions, ScanTimeResult } from "./types.js";

// ── Constant signal lists (mirrors career_plan/tools/lib/score.mjs) ───────────

const LEADERSHIP_WORDS = [
  "director", "head of", "vp", "vice president", "chief",
  "cdo", "cto", "coo", "global head", "lead", "principal",
];

const EXEC_WORDS = new Set([
  "director", "head of", "vp", "vice president", "chief", "cdo", "cto", "global head",
]);

// Generic sector words — not company names, safe to keep in the framework.
// The commodity-trading COMPANY names that used to sit alongside these are the
// owner's real targeting vocabulary and are externalized to
// ScoringVocabulary.commodityKeywords (see vocabulary.ts, ADR 0017).
const SECTOR_SIGNALS = [
  "trading", "commodit", "energy", "oil", "gas", "power", "ctrm", "etrm",
  "bank", "financial", "fintech", "capital markets", "asset management",
];

// ── Synonym map builder ───────────────────────────────────────────────────────

/**
 * Build a Map<normalisedSynonym, normalisedCanonical> from an Ontology object.
 * Used by the scan-time scorer to expand keyword matching.
 */
export function buildSynonymMap(ontology: Ontology): Map<string, string> {
  const map = new Map<string, string>();
  for (const [canonical, rawSynonyms] of Object.entries(ontology)) {
    const cLow = canonical.toLowerCase().replace(/^["']|["']$/g, "");
    const cNorm = norm(cLow);
    map.set(cNorm, cNorm);

    if (rawSynonyms == null) continue;
    const synonyms = Array.isArray(rawSynonyms) ? rawSynonyms : [rawSynonyms];
    for (const syn of synonyms) {
      if (typeof syn === "string") map.set(norm(syn), cNorm);
    }
  }
  return map;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Score a posting against all archetypes; return the best-match result.
 * Implements the 6-dimension scan-time rubric from career_plan/tools/lib/score.mjs.
 *
 * Weights: title_family 35% · domain_match 20% · geo_fit 15% ·
 *          seniority 10% · company_type 10% · leadership 10%
 */
export function scorePosting(
  posting: Posting,
  archetypes: Archetype[],
  synonymMap: Map<string, string> = new Map(),
  vocabulary: ScoringVocabulary = DEFAULT_SCORING_VOCABULARY,
): ScanTimeResult {
  if (archetypes.length === 0) {
    return nullResult("No archetypes loaded");
  }
  let best: ScanTimeResult | null = null;
  for (const arch of archetypes) {
    const r = scoreSingle(posting, arch, synonymMap, vocabulary);
    if (best === null || r.fit_score > best.fit_score) best = r;
  }
  return best ?? nullResult("Scoring failed");
}

// ── Single-archetype scorer ───────────────────────────────────────────────────

function scoreSingle(
  posting: Posting,
  arch: Archetype,
  synonymMap: Map<string, string>,
  vocabulary: ScoringVocabulary,
): ScanTimeResult {
  const title = posting.title;
  const company = posting.company;
  const location = posting.location;
  const desc = posting.description ?? "";
  const searchText = norm(`${title} ${desc}`);
  const titleLow = norm(title);
  const companyLow = norm(company);

  const matchKeywords = strList(arch.match_keywords);
  const relatedTitles = strList(arch.related_titles);
  const targetGeos = geoList(arch.search);
  const seniorityList = strList(arch.search?.seniority).map((s) => norm(s));

  const d1 = domainMatch(matchKeywords, searchText, synonymMap);
  let d2 = seniorityMatch(titleLow, seniorityList);
  const d3 = titleFamilyMatch(titleLow, relatedTitles);
  let d4 = leadershipMatch(titleLow);
  const d5 = geoFit(location, targetGeos);
  const d6 = companyTypeFit(companyLow, searchText, vocabulary.commodityKeywords);

  // Strong title match implies seniority + leadership
  if (d3.score >= 0.9) {
    if (d2.score < 0.8)
      d2 = { score: 0.8, note: d2.note + " [boosted: title family match implies seniority]" };
    if (d4.score < 0.7)
      d4 = { score: 0.7, note: d4.note + " [boosted: title family match implies leadership]" };
  }

  const raw =
    0.35 * d3.score +
    0.20 * d1.score +
    0.10 * d2.score +
    0.15 * d5.score +
    0.10 * d6.score +
    0.10 * d4.score;

  const fit_score = Math.round(raw * 50) / 10;

  const dimensions: ScanTimeDimensions = {
    title_family:     { score: d3.score, note: d3.note, weight: "35%" },
    domain_match:     { score: d1.score, note: d1.note, weight: "20%" },
    geo_fit:          { score: d5.score, note: d5.note, weight: "15%" },
    seniority_match:  { score: d2.score, note: d2.note, weight: "10%" },
    company_type_fit: { score: d6.score, note: d6.note, weight: "10%" },
    leadership_match: { score: d4.score, note: d4.note, weight: "10%" },
  };

  return {
    archetype: arch.id,
    fit_score,
    grade: letterGrade(fit_score),
    why_surfaced: buildWhySurfaced(d1, d2, d3, d4, d5, arch),
    dimensions,
  };
}

// ── Dimension scorers ─────────────────────────────────────────────────────────

function domainMatch(
  matchKeywords: string[],
  searchText: string,
  synonymMap: Map<string, string>,
): DimScore {
  if (matchKeywords.length === 0)
    return { score: 0, note: "No match_keywords defined" };
  let matched = 0;
  const found: string[] = [];
  for (const kw of matchKeywords) {
    const n = norm(kw);
    if (searchText.includes(n) || synonymHit(n, searchText, synonymMap)) {
      matched++;
      found.push(kw);
    }
  }
  const score = Math.min(1, matched / matchKeywords.length);
  const note =
    matched > 0
      ? `${matched}/${matchKeywords.length} domain keywords matched: ${found.slice(0, 5).join(", ")}${found.length > 5 ? "…" : ""}`
      : `0/${matchKeywords.length} domain keywords matched`;
  return { score, note };
}

function seniorityMatch(titleLow: string, seniorityList: string[]): DimScore {
  if (seniorityList.length === 0)
    return { score: 0.5, note: "No seniority list configured" };
  for (const s of seniorityList) {
    if (titleLow.includes(s))
      return { score: 1.0, note: `Seniority indicator "${s}" found in title` };
  }
  return { score: 0.3, note: "No seniority indicator found in title" };
}

function titleFamilyMatch(titleLow: string, relatedTitles: string[]): DimScore {
  if (relatedTitles.length === 0)
    return { score: 0, note: "No related_titles defined in archetype" };
  const postingWords = tokenWords(titleLow);
  let bestScore = 0;
  let bestTitle = "";
  for (const rt of relatedTitles) {
    const rtWords = tokenWords(rt.toLowerCase());
    const sim = jaccard(postingWords, rtWords);
    if (sim > bestScore) {
      bestScore = sim;
      bestTitle = rt;
    }
  }
  const boosted = Math.min(1, bestScore * 1.4);
  const note =
    bestScore > 0
      ? `Title best matches "${bestTitle}" (similarity: ${bestScore.toFixed(2)})`
      : "No title family match found";
  return { score: boosted, note };
}

function leadershipMatch(titleLow: string): DimScore {
  for (const lw of LEADERSHIP_WORDS) {
    if (titleLow.includes(lw)) {
      const isExec = EXEC_WORDS.has(lw);
      return { score: isExec ? 1.0 : 0.8, note: `Leadership indicator "${lw}" found in title` };
    }
  }
  return { score: 0.2, note: "No clear leadership indicator in title" };
}

function geoFit(location: string, targetGeos: string[]): DimScore {
  if (targetGeos.length === 0)
    return { score: 0.5, note: "No target geos configured" };
  const locLow = location.toLowerCase();
  for (const geo of targetGeos) {
    if (locLow.includes(geo.toLowerCase()))
      return { score: 1.0, note: `Location "${location}" matches target geo "${geo}"` };
  }
  if (locLow.includes("remote") || locLow.includes("hybrid"))
    return { score: 0.6, note: "Role is remote/hybrid — may suit target geos" };
  return { score: 0.0, note: `Location "${location}" not in target geo list` };
}

function companyTypeFit(companyLow: string, searchText: string, commodityKeywords: string[]): DimScore {
  const combined = `${companyLow} ${searchText}`;
  let matched = 0;
  const found: string[] = [];
  for (const sig of [...SECTOR_SIGNALS, ...commodityKeywords]) {
    if (combined.includes(sig)) {
      matched++;
      found.push(sig.trim());
    }
  }
  if (matched === 0)
    return { score: 0.3, note: "No sector signals detected in company/description" };
  const score = Math.min(1, 0.5 + matched * 0.15);
  return { score, note: `Sector signals: ${found.slice(0, 4).join(", ")}` };
}

// ── Why surfaced narrative ────────────────────────────────────────────────────

function buildWhySurfaced(
  d1: DimScore,
  d2: DimScore,
  d3: DimScore,
  d4: DimScore,
  d5: DimScore,
  arch: Archetype,
): string {
  const parts: string[] = [];
  if (d3.score >= 0.4) parts.push(d3.note);
  else if (d1.score >= 0.3) parts.push(d1.note);
  if (d5.score === 1.0) parts.push(d5.note);
  if (d2.score === 1.0 && parts.length < 2) parts.push(d2.note);
  else if (d4.score >= 0.8 && parts.length < 2) parts.push(d4.note);
  if (parts.length === 0)
    parts.push(`Partial keyword match to archetype "${arch.label ?? arch.id}".`);
  return parts.slice(0, 3).join(" ");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function letterGrade(score: number): FitGrade {
  if (score >= 4.5) return "A";
  if (score >= 4.0) return "B";
  if (score >= 3.0) return "C";
  if (score >= 2.0) return "D";
  return "F";
}

function synonymHit(
  kwNorm: string,
  text: string,
  synonymMap: Map<string, string>,
): boolean {
  for (const [synNorm, canonical] of synonymMap) {
    if (canonical === kwNorm && text.includes(synNorm)) return true;
  }
  return false;
}

function strList(val: string[] | undefined): string[] {
  if (!val) return [];
  return val.filter((v): v is string => typeof v === "string");
}

function geoList(search: Archetype["search"]): string[] {
  if (!search?.geos) return [];
  return search.geos.filter((g) => typeof g === "string" && g.length > 0);
}

function nullResult(reason: string): ScanTimeResult {
  return {
    archetype: null,
    fit_score: 0,
    grade: "F",
    why_surfaced: reason,
    dimensions: {
      title_family:     { score: 0, note: reason, weight: "35%" },
      domain_match:     { score: 0, note: reason, weight: "20%" },
      geo_fit:          { score: 0, note: reason, weight: "15%" },
      seniority_match:  { score: 0, note: reason, weight: "10%" },
      company_type_fit: { score: 0, note: reason, weight: "10%" },
      leadership_match: { score: 0, note: reason, weight: "10%" },
    },
  };
}

// Export tokenWords / STOP_WORDS for tests (re-export from text.ts is cleaner via index)
export { tokenWords, STOP_WORDS };
