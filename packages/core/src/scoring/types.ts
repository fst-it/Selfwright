import { z } from "zod";

// ── CV content shape (matches cv-content.json from career_plan build chain) ───

const CvContactSchema = z.object({
  location: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  linkedin: z.string().optional(),
});

const CvRoleSchema = z.object({
  company: z.string(),
  title: z.string(),
  period: z.string(),
  location: z.string(),
  lead: z.string().optional(),
  bullets: z.array(z.string()).optional(),
});

const CvEarlierCareerSchema = z.object({
  org: z.string(),
  rest: z.string(),
});

const CvOverlaySchema = z.object({
  variant: z.string().optional(),
  summary: z.string().optional(),
  skills: z.array(z.string()).optional(),
  bullets: z.array(z.string()).optional(),
});

export const CvContentSchema = z.object({
  name: z.string().optional(),
  headline: z.string().optional(),
  summary: z.string().optional(),
  citizenship: z.string().optional(),
  variant: z.string().optional(),
  skills: z.array(z.string()).optional(),
  roles: z.array(CvRoleSchema).optional(),
  earlier_career: z.array(CvEarlierCareerSchema).optional(),
  education: z.array(z.string()).optional(),
  certifications: z.array(z.string()).optional(),
  languages: z.string().optional(),
  contact: CvContactSchema.optional(),
  overlay: CvOverlaySchema.optional(),
});

export type CvContent = z.infer<typeof CvContentSchema>;
export type CvRole = z.infer<typeof CvRoleSchema>;

// ── Scan-time posting ────────────────────────────────────────────────────────

export interface Posting {
  title: string;
  company: string;
  location: string;
  description?: string;
}

// ── Scoring result types ─────────────────────────────────────────────────────

export type FitGrade = "A" | "B" | "C" | "D" | "F";

/** Internal dimension score returned by individual scorers (no weight yet). */
export interface DimScore {
  score: number;
  note: string;
}

/** Final dimension result that includes the weight annotation in top-level results. */
export interface DimensionResult extends DimScore {
  weight: string;
}

export interface ScanTimeDimensions {
  title_family: DimensionResult;
  domain_match: DimensionResult;
  geo_fit: DimensionResult;
  seniority_match: DimensionResult;
  company_type_fit: DimensionResult;
  leadership_match: DimensionResult;
}

export interface ScanTimeResult {
  archetype: string | null;
  fit_score: number;
  grade: FitGrade;
  why_surfaced: string;
  dimensions: ScanTimeDimensions;
}

export interface JdDimensions extends ScanTimeDimensions {
  evidence_coverage: DimensionResult;
  keyword_density: DimensionResult;
}

export interface JdScoreResult {
  archetype: string | null;
  fit_score: number;
  grade: FitGrade;
  why_surfaced: string;
  dimensions: JdDimensions;
}

// ── ATS result types ─────────────────────────────────────────────────────────

export interface PassACheck {
  name: string;
  pass: boolean;
  score?: number;
  detail: string;
}

export interface PassAResult {
  score: number;
  checks: PassACheck[];
}

export interface MissingTruthfulTerm {
  term: string;
  evidenceIds: string[];
}

export interface MissingUnsupportedTerm {
  term: string;
}

export interface PassBResult {
  score: number;
  jdTermsCount: number;
  covered: string[];
  missingTruthful: MissingTruthfulTerm[];
  missingUnsupported: MissingUnsupportedTerm[];
  note?: string;
}

export interface AtsResult {
  passA: PassAResult;
  passB: PassBResult;
  overall: number;
  threshold: number;
  passes: boolean;
}

// ── Priority result types ────────────────────────────────────────────────────

export type CompRisk = "no_floor_data" | "undisclosed" | "marginal" | "below" | null;

export interface IndustryAxis {
  bucket: string;
  points: number;
  norm: number;
}

export interface LocationAxis {
  points: number;
  norm: number;
  country: string | null;
  in_scope: boolean;
}

export interface FitAxis {
  fit_score: number | null;
  norm: number;
}

export interface CompAxisResult {
  comp_eur: number | null;
  norm: number;
  floor_a_used: number | null;
  risk: CompRisk;
}

export interface PriorityResult {
  priority_score: number;
  anchor: boolean;
  scored_city: string | null;
  comp_risk: CompRisk;
  axes: {
    industry: IndustryAxis;
    location: LocationAxis;
    fit: FitAxis;
    comp: CompAxisResult;
  };
}

export interface PriorityRole {
  company: string;
  scored_city: string;
  fit_score: number | null;
  comp_eur: number | null;
}

export interface CompAxisOpts {
  useRegime?: boolean;
}
