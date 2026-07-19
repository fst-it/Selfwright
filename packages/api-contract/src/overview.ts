import { z } from "zod";
import { NorthStarSchema, FitnessRunSchema } from "./reporting.js";

export const OverviewResponseSchema = z.object({
  northStar: NorthStarSchema,
  fitnessHistory: z.array(FitnessRunSchema),
  inbox: z.object({
    decideNow: z.number().int().min(0),
    reviewSoon: z.number().int().min(0),
    fyi: z.number().int().min(0),
  }),
  digestCount: z.number().int().min(0),
});
export type OverviewResponse = z.infer<typeof OverviewResponseSchema>;
