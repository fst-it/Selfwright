import { z } from "zod";
import { TagLevelSchema } from "./common.js";
import type { TagLevel } from "./common.js";

/**
 * Evidence `tag` is either:
 *   - a single level applied to the whole entry  → "soft"
 *   - a per-facet map of arbitrary sub-claims     → { build: "soft", metrics: "soft" }
 * Facet keys are open (value/lead/direct/functional/build/metrics observed in registry),
 * so the map schema uses an open record instead of a fixed-key object.
 */
export const EvidenceTagSchema = z.union([
  TagLevelSchema,
  z
    .record(z.string().min(1), TagLevelSchema)
    .refine((m) => Object.keys(m).length > 0, {
      message: "tag facet map must have at least one facet",
    }),
]);
export type EvidenceTag = z.infer<typeof EvidenceTagSchema>;

/** Return the distinct TagLevel values present in a tag (scalar or facet-map). */
export function tagLevels(tag: EvidenceTag): TagLevel[] {
  if (typeof tag === "string") return [tag];
  return [...new Set(Object.values(tag))];
}

const EVD_ID_PATTERN = /^EVD-[A-Z0-9-]+$/;

/**
 * A single evidence entry in the registry (EVD-*).
 * Uses .strict() so that any unknown key discovered during migration
 * surfaces as a validation error rather than being silently dropped.
 */
export const EvidenceEntrySchema = z
  .object({
    id: z.string().regex(EVD_ID_PATTERN),
    org: z.string().min(1),
    claim: z.string().min(1),
    detail: z.string().optional(),
    tag: EvidenceTagSchema,
    metric: z.string().optional(),
    keywords: z.array(z.string()).default([]),
    defense: z.string().optional(),
    honesty: z.string().optional(),
    retired: z.array(z.string()).optional(),
    tech_stack: z.string().optional(),
    data_model_and_lifecycle: z.string().optional(),
    roadmap: z.string().optional(),
    usage_note: z.string().optional(),
  })
  .strict();

export type EvidenceEntry = z.infer<typeof EvidenceEntrySchema>;

export const EvidenceRegistrySchema = z.array(EvidenceEntrySchema);
export type EvidenceRegistry = z.infer<typeof EvidenceRegistrySchema>;
