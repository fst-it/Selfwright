import { z } from "zod";
import { DebriefSchema, GapSchema, EvidenceTagSchema } from "@selfwright/core";
import { hasControlChars } from "./validation.js";

export const DrillKindSchema = z.enum(["gap", "stretch", "strength"]);

// Mirrors packages/core/src/coaching/types.ts RankedEvidence.
export const RankedEvidenceSchema = z.object({
  id: z.string(),
  score: z.number(),
  tag: EvidenceTagSchema,
  why: z.string(),
});
export type RankedEvidenceContract = z.infer<typeof RankedEvidenceSchema>;

// Mirrors packages/core/src/coaching/types.ts DrillSelection.
export const DrillSelectionSchema = z.object({
  topicId: z.string(),
  kind: DrillKindSchema,
  gap: GapSchema.optional(),
  evidenceBundle: z.array(RankedEvidenceSchema),
});
export type DrillSelectionContract = z.infer<typeof DrillSelectionSchema>;

export const CoachingResponseSchema = z.object({
  debriefs: z.array(DebriefSchema),
  hasArchetype: z.boolean(),
  nextDrill: DrillSelectionSchema.nullable(),
  drillFiles: z.array(z.string()),
  prepPacks: z.array(z.string()),
});
export type CoachingResponse = z.infer<typeof CoachingResponseSchema>;

const debriefListItem = z
  .string()
  .max(200)
  .refine((v) => !hasControlChars(v), { message: "contains control characters" });

// Debrief create write — same field set/limits as ADR 0019's DebriefFormBody
// (application_id, date, round?, asked?/wobbled?/went_well? capped at <=20
// items of <=200 chars, notes <=2000 chars, no control characters anywhere),
// delivered as JSON arrays instead of newline-separated textarea strings.
export const DebriefCreateRequestSchema = z.object({
  application_id: z.string().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  round: z
    .string()
    .max(200)
    .refine((v) => !hasControlChars(v), { message: "round contains control characters" })
    .optional(),
  asked: z.array(debriefListItem).max(20).optional(),
  wobbled: z.array(debriefListItem).max(20).optional(),
  went_well: z.array(debriefListItem).max(20).optional(),
  notes: z
    .string()
    .max(2000)
    .refine((v) => !hasControlChars(v), { message: "notes contains control characters" })
    .optional(),
});
export type DebriefCreateRequest = z.infer<typeof DebriefCreateRequestSchema>;

export const DebriefCreateResponseSchema = z.object({
  debrief: DebriefSchema,
});
export type DebriefCreateResponse = z.infer<typeof DebriefCreateResponseSchema>;
