import { z } from "zod";
import { TagLevelSchema } from "./common.js";

const GAP_ID_PATTERN = /^GAP-[A-Z0-9-]+$/;

/**
 * Schema for a structured gap entry (dormant in Task 1.1 — no gaps.yml exists yet).
 * Defined here to lock the contract for Phase 1.3 truth fitness functions.
 * Populate gaps.yml when a fitness function concretely needs structured gap rows.
 */
export const GapSchema = z.object({
  id: z.string().regex(GAP_ID_PATTERN),
  title: z.string().min(1),
  honest_gap: z.string().min(1),
  frame: z.string().min(1),
  tag: TagLevelSchema,
  evidence_ids: z.array(z.string()).default([]),
  company_specific: z.boolean().default(false),
});

export type Gap = z.infer<typeof GapSchema>;

export const GapsFileSchema = z.array(GapSchema);
export type GapsFile = z.infer<typeof GapsFileSchema>;
