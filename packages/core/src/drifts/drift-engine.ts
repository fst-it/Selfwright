/**
 * Drift engine — pure functions for scoring, validating, and identifying drifts.
 *
 * Mirrors career_plan/tools/lib/drift.mjs. All functions are pure (no I/O).
 * The Zod schema layer (DriftEntrySchema, computeRubricScore) lives in
 * packages/core/src/truth/schemas/drift.ts — imported here to avoid duplication.
 */

import type { DriftEntry } from "../truth/index.js";
import { computeRubricScore } from "../truth/index.js";

// ── Company slug / token ──────────────────────────────────────────────────────

export function slugifyCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function companyToken(slug: string): string {
  return slug.toUpperCase();
}

// ── Scoring ───────────────────────────────────────────────────────────────────

export function blendScore(rubricScoreVal: number, aiAdjustment: number): number {
  const adj = clampRange(aiAdjustment, -1, 1);
  return round1(clampRange(rubricScoreVal + adj, 0, 10));
}

export function bandFor(score: number): "safe" | "caution" | "high-risk" {
  if (score >= 8.0) return "safe";
  if (score >= 5.0) return "caution";
  return "high-risk";
}

export interface DriftComputeResult {
  rubric_score: number;
  score: number;
  band: "safe" | "caution" | "high-risk";
}

export function computeDrift(entry: DriftEntry): DriftComputeResult {
  const rubric = computeRubricScore(entry.confidence.factors);
  const score = blendScore(rubric, entry.confidence.ai_adjustment);
  return { rubric_score: rubric, score, band: bandFor(score) };
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface DriftValidationResult {
  ok: boolean;
  errors: string[];
}

interface ValidateOpts {
  slug?: string;
}

/**
 * Validate a drift entry's cross-field invariants beyond what Zod schema checks.
 * Returns { ok, errors[] }.
 *
 * The Zod schema handles field types/formats. This validator checks:
 * - computed rubric_score matches stored (within tolerance)
 * - computed score matches stored (within tolerance)
 * - ID prefix matches ledger slug when slug is provided
 * - promoted status requires promoted_to; retired requires retired_reason
 */
export function validateDrift(entry: DriftEntry, opts: ValidateOpts = {}): DriftValidationResult {
  const errors: string[] = [];
  const id = entry.id;

  // Recompute and compare stored vs computed scores
  const computed = computeDrift(entry);
  if (Math.abs(entry.confidence.rubric_score - computed.rubric_score) > 0.05) {
    errors.push(
      `${id}: stored rubric_score ${entry.confidence.rubric_score} ≠ recomputed ${computed.rubric_score}`,
    );
  }
  if (Math.abs(entry.confidence.score - computed.score) > 0.05) {
    errors.push(
      `${id}: stored score ${entry.confidence.score} ≠ recomputed ${computed.score}`,
    );
  }

  // Status lifecycle invariants
  if (entry.status === "promoted" && !entry.promoted_to) {
    errors.push(`${id}: status=promoted requires promoted_to (an EVD- id)`);
  }
  if (entry.status === "retired" && !entry.retired_reason) {
    errors.push(`${id}: status=retired requires retired_reason`);
  }

  // ID must have the correct company prefix when ledger slug is provided
  if (opts.slug) {
    const prefix = `DRIFT-${companyToken(slugifyCompany(opts.slug))}-`;
    if (!id.startsWith(prefix)) {
      errors.push(`${id}: id must start with "${prefix}" for ledger slug "${opts.slug}"`);
    }
  }

  return { ok: errors.length === 0, errors };
}

// ── Filtering ─────────────────────────────────────────────────────────────────

export function filterActiveDrifts(drifts: DriftEntry[]): DriftEntry[] {
  return drifts.filter((d) => d.status === "active");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clampRange(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
