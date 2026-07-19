import { z } from "zod";
import { APPLICATION_STATUSES } from "@selfwright/core";
import { hasControlChars } from "./validation.js";

// Mirrors packages/core/src/services/types.ts ApplicationRecord. Duplicated as
// a zod schema (rather than imported) because ApplicationRecord is a plain TS
// interface, not validated at read time (ADR 0017 FF-INPUT: real data is
// parsed off disk without a static type) — the contract package is the first
// place this shape gets runtime validation.
export const ApplicationRecordSchema = z.object({
  id: z.string(),
  company: z.string(),
  role: z.string(),
  status: z.string(),
  channel: z.string().optional(),
  dates: z.object({
    discovered: z.string().optional(),
    promoted: z.string().optional(),
    applied: z.string().optional(),
    last_update: z.string().optional(),
  }),
  fit_score: z.number().nullable().optional(),
  ats_score: z.object({ overall: z.number().optional() }).nullable().optional(),
  // Nullable (not just optional): real applications.yml rows commonly store
  // an explicit `notes: null` (no notes yet) rather than omitting the key.
  notes: z.string().nullable().optional(),
});
export type ApplicationRecordContract = z.infer<typeof ApplicationRecordSchema>;

export const ApplicationsListResponseSchema = z.object({
  applications: z.array(ApplicationRecordSchema),
  /** SHA-256 hex digest of applications.yml's raw content, or null if the file is absent. */
  contentHash: z.string().nullable(),
});
export type ApplicationsListResponse = z.infer<typeof ApplicationsListResponseSchema>;

// Status update write — mirrors ADR 0019's StatusUpdateBody exactly (same
// vocabulary, same 500-char note cap, same control-char rejection, same
// optimistic-lock content hash), delivered as a JSON header-CSRF request
// instead of a form POST.
export const StatusUpdateRequestSchema = z.object({
  status: z.enum(APPLICATION_STATUSES),
  note: z
    .string()
    .max(500)
    .refine((v) => !hasControlChars(v), { message: "note contains control characters" })
    .optional(),
  contentHash: z.string().min(1).max(128),
});
export type StatusUpdateRequest = z.infer<typeof StatusUpdateRequestSchema>;

export const StatusUpdateResponseSchema = z.object({
  application: ApplicationRecordSchema,
});
export type StatusUpdateResponse = z.infer<typeof StatusUpdateResponseSchema>;
