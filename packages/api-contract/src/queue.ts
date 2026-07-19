import { z } from "zod";
import { ApplicationRecordSchema } from "./applications.js";

// Mirrors packages/core/src/scanning/types.ts QueueEntry.
export const QueueEntrySchema = z.object({
  id: z.string(),
  company: z.string(),
  derived_role: z.string().optional(),
  fit_score: z.number().nullable().optional(),
  comp_eur: z.number().nullable().optional(),
  source: z.string().optional(),
  queuedAt: z.string().optional(),
  lastSeenAt: z.string().optional(),
});
export type QueueEntryContract = z.infer<typeof QueueEntrySchema>;

export const QueueResponseSchema = z.object({
  /** Non-stale queue entries (T5.5 aging partition), full list — not capped like the SSR top-20. */
  active: z.array(QueueEntrySchema),
  staleCount: z.number().int().min(0),
  agingWindowDays: z.number().int().positive(),
  /** SHA-256 hex digest of queue.yml's raw content, or null if the file is absent (mirrors ApplicationsListResponseSchema.contentHash). */
  contentHash: z.string().nullable(),
});
export type QueueResponse = z.infer<typeof QueueResponseSchema>;

// ── Queue-triage write actions (T5.10, ADR 0024) ────────────────────────────

// Optimistic-lock request for promote — mirrors StatusUpdateRequestSchema's
// contentHash check (applications.ts) so a promote can't clobber a
// concurrent change to queue.yml.
export const PromoteQueueEntryRequestSchema = z.object({
  contentHash: z.string().min(1).max(128),
});
export type PromoteQueueEntryRequest = z.infer<typeof PromoteQueueEntryRequestSchema>;

export const PromoteQueueEntryResponseSchema = z.object({
  application: ApplicationRecordSchema,
});
export type PromoteQueueEntryResponse = z.infer<typeof PromoteQueueEntryResponseSchema>;

export const DismissQueueEntryResponseSchema = z.object({
  dismissed: QueueEntrySchema,
});
export type DismissQueueEntryResponse = z.infer<typeof DismissQueueEntryResponseSchema>;
