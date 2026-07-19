import { z } from "zod";

export const NorthStarSchema = z.object({
  submitted: z.number().int().min(0),
  interviews: z.number().int().min(0),
  ratePerTen: z.number().nullable(),
});
export type NorthStarContract = z.infer<typeof NorthStarSchema>;

// Mirrors packages/core/src/services/channel-outcomes.ts ChannelOutcome.
export const ChannelOutcomeSchema = z.object({
  channel: z.string(),
  submitted: z.number().int().min(0),
  interviews: z.number().int().min(0),
  rate: z.number().nullable(),
});
export type ChannelOutcomeContract = z.infer<typeof ChannelOutcomeSchema>;

export const FitnessRunSchema = z.object({
  runAt: z.string(),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  skipped: z.number().int().min(0),
});
export type FitnessRunContract = z.infer<typeof FitnessRunSchema>;

export const ReportingResponseSchema = z.object({
  northStar: NorthStarSchema,
  channelOutcomes: z.array(ChannelOutcomeSchema),
  byStatus: z.record(z.string(), z.number().int().min(0)),
  fitnessHistory: z.array(FitnessRunSchema),
});
export type ReportingResponse = z.infer<typeof ReportingResponseSchema>;
