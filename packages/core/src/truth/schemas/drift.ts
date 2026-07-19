import { z } from "zod";
import { EvidenceTagSchema } from "./evidence.js";

const EVD_ID_PATTERN = /^EVD-[A-Z0-9-]+$/;
const DRIFT_ID_PATTERN = /^DRIFT-[A-Z0-9-]+$/;

const DriftFactorsSchema = z.object({
  verifiability_backstop: z.number().min(0).max(1),
  distance_from_truth: z.number().min(0).max(1),
  blast_radius: z.number().min(0).max(1),
  external_checkability: z.number().min(0).max(1),
  cross_app_consistency: z.number().min(0).max(1),
  specificity_detectability: z.number().min(0).max(1),
});

const DriftConfidenceSchema = z.object({
  score: z.number().min(0).max(10),
  band: z.enum(["safe", "caution", "high-risk"]),
  rubric_version: z.string().optional(),
  factors: DriftFactorsSchema,
  rubric_score: z.number().min(0).max(10),
  ai_adjustment: z.number().min(-1).max(1),
  ai_reasoning: z.string().min(1),
});

const DriftRiskSchema = z.object({
  risk: z.string().min(1),
  severity: z.enum(["low", "medium", "high"]),
  mitigation: z.string().min(1),
});

export const DriftEntrySchema = z.object({
  id: z.string().regex(DRIFT_ID_PATTERN),
  org: z.string().min(1),
  claim: z.string().min(1),
  detail: z.string().optional(),
  deviates_from: z.object({
    evidence_ids: z
      .array(z.string().regex(EVD_ID_PATTERN))
      .min(1),
    kind: z.enum(["reframe", "embellishment", "net-new-defensible"]),
    note: z.string().optional(),
  }),
  tag: EvidenceTagSchema,
  keywords: z.array(z.string()).default([]),
  defense: z.string().optional(),
  honesty: z.string().optional(),
  confidence: DriftConfidenceSchema,
  risks: z.array(DriftRiskSchema).min(1),
  status: z.enum(["proposed", "active", "promoted", "retired"]),
  applications: z.array(z.string()).default([]),
  drift_family: z.string().optional(),
  created: z.string().optional(),
  last_update: z.string().optional(),
  promoted_to: z.string().regex(EVD_ID_PATTERN).nullable().optional(),
  retired_reason: z.string().nullable().optional(),
});

export type DriftEntry = z.infer<typeof DriftEntrySchema>;

export const DriftLedgerSchema = z.object({
  company: z.string().min(1),
  company_slug: z.string().min(1),
  drifts: z.array(DriftEntrySchema),
});

export type DriftLedger = z.infer<typeof DriftLedgerSchema>;

const DriftIndexCompanySchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  file: z.string().min(1),
  drift_count: z.number().int().min(0),
  active: z.number().int().min(0),
  min_confidence: z.number().min(0).max(10).optional(),
});

export const DriftIndexSchema = z.object({
  rubric_version: z.string().min(1),
  companies: z.array(DriftIndexCompanySchema),
});

export type DriftIndex = z.infer<typeof DriftIndexSchema>;

/**
 * Recompute the deterministic rubric score from factors.
 * Mirrors the logic in career_plan/tools/lib/drift.mjs rubricScore().
 */
export function computeRubricScore(
  factors: z.infer<typeof DriftFactorsSchema>,
): number {
  const weights = {
    verifiability_backstop: 0.25,
    distance_from_truth: 0.2,
    blast_radius: 0.2,
    external_checkability: 0.15,
    cross_app_consistency: 0.1,
    specificity_detectability: 0.1,
  } as const;

  let sum = 0;
  for (const [k, w] of Object.entries(weights)) {
    const v = factors[k as keyof typeof weights];
    sum += Math.max(0, Math.min(1, v)) * w;
  }
  return Math.round(Math.max(0, Math.min(1, sum)) * 100) / 10;
}

/**
 * Validate that the stored rubric_score matches the recomputed value (within 0.05 tolerance).
 * Used by the drift fitness function and the schema-level cross-field check.
 */
export function rubricScoreMatchesFactors(entry: DriftEntry): boolean {
  const recomputed = computeRubricScore(entry.confidence.factors);
  return Math.abs(recomputed - entry.confidence.rubric_score) <= 0.05;
}
