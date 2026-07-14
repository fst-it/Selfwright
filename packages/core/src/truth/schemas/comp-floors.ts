import { z } from "zod";

export const CityFloorSchema = z.object({
  city: z.string().min(1),
  country: z.string().min(1),
  location_tier_points: z.number(),
  col_index: z.number().nullable().optional(),
  floor_a_eur: z.number(),
  floor_b_eur: z.number().nullable().optional(),
  regime_floor_a_eur: z.number().nullable().optional(),
  search: z.union([z.boolean(), z.literal("false")]).optional(),
  note: z.string().optional(),
});

export type CityFloor = z.infer<typeof CityFloorSchema>;

const CompFloorsMetaSchema = z.object({
  source: z.string().min(1),
  generated: z.string().min(1),
  amended: z.string().optional(),
  amsterdam_discretionary_baseline_eur: z.number(),
  review_cadence: z.string().min(1),
  location_tiers: z.string().min(1),
  note: z.string().optional(),
});

export const CompFloorsSchema = z.object({
  meta: CompFloorsMetaSchema,
  cities: z.array(CityFloorSchema).min(1),
});

export type CompFloors = z.infer<typeof CompFloorsSchema>;
