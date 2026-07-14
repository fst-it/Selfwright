import { z } from "zod";

const ArchetypeSearchSchema = z.object({
  geos: z.array(z.string()).optional(),
  seniority: z.array(z.string()).optional(),
  comp_floor_eur: z.unknown().optional(),
});

const ArchetypeCvSlantSchema = z.object({
  foreground_evidence: z.array(z.string()).optional(),
  suppress_evidence: z.array(z.string()).optional(),
  summary_emphasis: z.string().optional(),
  variant: z.string().optional(),
});

export const ArchetypeSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  related_titles: z.array(z.string()),
  match_keywords: z.array(z.string()),
  search: ArchetypeSearchSchema.optional(),
  cv_slant: ArchetypeCvSlantSchema.optional(),
  honesty_notes: z.string().optional(),
  value_proposition: z.string().optional(),
});

export type Archetype = z.infer<typeof ArchetypeSchema>;
