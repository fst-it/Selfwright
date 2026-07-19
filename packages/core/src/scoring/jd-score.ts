/**
 * 7-dimension full-JD fit scorer.
 *
 * Extends the 6-dimension scan-time scorer with a 7th dimension:
 *   evidence_coverage (25%) — what fraction of JD ontology terms have EVD-* support.
 *
 * The scan-time 6 dimensions are adapted with different weights for full-JD mode:
 *   domain_match 20% · seniority 10% · evidence_coverage 25% · leadership 15% ·
 *   geo_fit 10% · company_type_fit 10% · keyword_density 10%
 *
 * Mirrors the 7-dimension rubric from 50-modes/score.md.
 */

import type { Archetype, EvidenceEntry, Ontology } from "../truth/index.js";
import { runPassB } from "./ats.js";
import { buildSynonymMap, scorePosting } from "./score.js";
import { norm, normalise, stripMarkdown } from "./text.js";
import type { ScoringVocabulary } from "./vocabulary.js";
import type {
  CvContent,
  DimensionResult,
  DimScore,
  FitGrade,
  JdDimensions,
  JdScoreResult,
  Posting,
} from "./types.js";

/**
 * Build a pseudo CvContent from the archetype and a raw keywords list
 * for the purposes of measuring keyword density (dim 7).
 */
function archetypeAsCv(arch: Archetype): CvContent {
  return {
    skills: arch.match_keywords,
    summary: arch.value_proposition ?? "",
    roles: [],
  };
}

/**
 * Keyword density: what fraction of JD ontology terms appear in the
 * archetype's match_keywords list (synonym-expanded).
 */
function keywordDensity(
  jdText: string,
  arch: Archetype,
  ontology: Ontology,
  registry: EvidenceEntry[],
): DimScore & { weight: string } {
  const passB = runPassB(jdText, archetypeAsCv(arch), ontology, registry);
  if (passB.jdTermsCount === 0)
    // No ontology terms in the JD — "no data" must not silently present as a perfect
    // match (same convention as ats.ts runPassB and priority.ts compAxis: 0.5 neutral).
    return { score: 0.5, note: "No JD ontology terms — score defaulted to 0.5 (neutral, no coverage signal)", weight: "10%" };
  const score = passB.covered.length / passB.jdTermsCount;
  return {
    score,
    note: `${passB.covered.length}/${passB.jdTermsCount} JD ontology terms found in archetype keywords`,
    weight: "10%",
  };
}

/**
 * Evidence coverage: what fraction of JD ontology terms have EVD-* backing.
 */
function evidenceCoverage(
  jdText: string,
  ontology: Ontology,
  registry: EvidenceEntry[],
): DimScore & { weight: string } {
  // Use a minimal CV so Pass B reports only the evidence-supported terms
  const emptyCv: CvContent = { roles: [] };
  const passB = runPassB(jdText, emptyCv, ontology, registry);
  if (passB.jdTermsCount === 0)
    // No ontology terms in the JD — "no data" must not silently present as a perfect
    // match (same convention as ats.ts runPassB and priority.ts compAxis: 0.5 neutral).
    return { score: 0.5, note: "No JD ontology terms — score defaulted to 0.5 (neutral, no coverage signal)", weight: "25%" };
  const truthfulCount = passB.missingTruthful.length;
  const total = passB.jdTermsCount;
  const score = truthfulCount / total;
  return {
    score,
    note: `${truthfulCount}/${total} JD terms have EVD-* support in the registry`,
    weight: "25%",
  };
}

interface JdScorerInputs {
  jdText: string;
  archetypes: Archetype[];
  ontology: Ontology;
  registry: EvidenceEntry[];
  posting?: Posting;
  vocabulary?: ScoringVocabulary;
}

/**
 * Score a full JD against all archetypes using the 7-dimension rubric.
 * Returns the best-match result with all 7 dimension scores.
 */
export function scoreJd(inputs: JdScorerInputs): JdScoreResult {
  const { jdText, archetypes, ontology, registry } = inputs;

  if (archetypes.length === 0)
    return nullJdResult("No archetypes loaded");

  // Derive a posting from the JD text for the scan-time scorer components.
  // When no structured posting is supplied (the common case for `score --jd
  // <file>` against a plain/markdown JD with no separately-extracted
  // title/location), seniority_match/leadership_match/geo_fit would otherwise
  // check an empty title/location string and come back uniformly degenerate
  // (~0) regardless of what the JD actually says -- even though the signal
  // (a seniority word, a city name) is very often present somewhere in the
  // JD body text itself. Falling back to jdText for both fields lets those
  // three dimensions search the whole document instead of nothing. This only
  // affects the no-posting default here; scorePosting()'s own title/location
  // matching logic is unchanged, so scan-time scoring (which always supplies
  // a real posting) is unaffected.
  const posting: Posting = inputs.posting ?? {
    title: jdText,
    company: "",
    location: jdText,
    description: jdText,
  };

  const synonymMap = buildSynonymMap(ontology);
  const evCoverage = evidenceCoverage(jdText, ontology, registry);

  let best: JdScoreResult | null = null;

  for (const arch of archetypes) {
    // Get the 6 scan-time dimensions for this archetype
    const scanResult = scorePosting(posting, [arch], synonymMap, inputs.vocabulary);

    // 7th dimension: keyword density for this archetype
    const kwDensity = keywordDensity(jdText, arch, ontology, registry);

    // Re-weight for 7-dim rubric:
    //   evidence_coverage 25% · title_family removed (posting may have no title) →
    //   domain_match 20% · seniority 10% · leadership 15% · geo_fit 10% · company_type 10% · kw_density 10%
    const d = scanResult.dimensions;
    const raw =
      0.20 * d.domain_match.score +
      0.10 * d.seniority_match.score +
      0.25 * evCoverage.score +
      0.15 * d.leadership_match.score +
      0.10 * d.geo_fit.score +
      0.10 * d.company_type_fit.score +
      0.10 * kwDensity.score;

    const fit_score = Math.round(raw * 50) / 10;

    const dims: JdDimensions = {
      domain_match:      { ...d.domain_match,      weight: "20%" },
      seniority_match:   { ...d.seniority_match,   weight: "10%" },
      evidence_coverage: evCoverage,
      leadership_match:  { ...d.leadership_match,  weight: "15%" },
      geo_fit:           { ...d.geo_fit,            weight: "10%" },
      company_type_fit:  { ...d.company_type_fit,  weight: "10%" },
      title_family:      { ...d.title_family,       weight: "0% (informational)" },
      keyword_density:   kwDensity,
    };

    const result: JdScoreResult = {
      archetype: arch.id,
      fit_score,
      grade: letterGrade(fit_score),
      why_surfaced: scanResult.why_surfaced,
      dimensions: dims,
    };

    if (best === null || result.fit_score > best.fit_score) best = result;
  }

  return best ?? nullJdResult("Scoring failed");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function letterGrade(score: number): FitGrade {
  if (score >= 4.5) return "A";
  if (score >= 4.0) return "B";
  if (score >= 3.0) return "C";
  if (score >= 2.0) return "D";
  return "F";
}

function nullJdResult(reason: string): JdScoreResult {
  const empty: DimensionResult = { score: 0, note: reason, weight: "0%" };
  return {
    archetype: null,
    fit_score: 0,
    grade: "F",
    why_surfaced: reason,
    dimensions: {
      title_family:      { ...empty, weight: "0% (informational)" },
      domain_match:      { ...empty, weight: "20%" },
      seniority_match:   { ...empty, weight: "10%" },
      evidence_coverage: { ...empty, weight: "25%" },
      leadership_match:  { ...empty, weight: "15%" },
      geo_fit:           { ...empty, weight: "10%" },
      company_type_fit:  { ...empty, weight: "10%" },
      keyword_density:   { ...empty, weight: "10%" },
    },
  };
}

// Expose for tests
export { norm as _norm, normalise as _normalise, stripMarkdown as _stripMarkdown };
