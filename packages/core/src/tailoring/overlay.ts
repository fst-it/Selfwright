import { z } from "zod";

// ── Drift application (governed operation) ─────────────────────────────────────
//
// Replaces the earlier `inject_drifts: string[]` stub. That stub only unioned
// drift keywords into skills; it never replaced or injected bullet prose, and
// its bare-string wire form crashed (`[object Object]`) the moment a real
// overlay carried the richer `{ id, role, mode, replace_bullet }` shape.
// `drift_applications` is object-only — no string form — so overlays are
// self-describing about which bullet a drift targets and how.

export const DriftApplicationModeSchema = z.enum(["replace", "inject", "keywords-only"]);
export type DriftApplicationMode = z.infer<typeof DriftApplicationModeSchema>;

export const DriftApplicationSchema = z
  .object({
    id: z.string().regex(/^DRIFT-[A-Z0-9-]+$/),
    mode: DriftApplicationModeSchema,
    target: z
      .object({
        role: z.string(),
        bullet: z.number().int().nonnegative().optional(),
      })
      .optional(),
    allow_high_risk: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if ((v.mode === "replace" || v.mode === "inject") && v.target === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `mode "${v.mode}" requires target.role` });
    }
    if (v.mode === "replace" && v.target?.bullet === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `mode "replace" requires target.bullet` });
    }
  });

export type DriftApplication = z.infer<typeof DriftApplicationSchema>;

/**
 * Provenance record for a drift actually applied to a tailored CV.
 * Defined here (a leaf module) rather than in tailor.ts/drift-apply.ts to
 * avoid an import cycle: both of those modules need this type.
 */
export interface AppliedDrift {
  id: string;
  mode: DriftApplicationMode;
  role?: string;
  bullet?: number;
  claim: string;
  band: "safe" | "caution" | "high-risk";
}

export const CvOverlaySchema = z
  .object({
    archetype: z.string().optional(),
    headline: z.string().optional(),
    summary: z.string().optional(),
    skills: z.array(z.string()).optional(),
    citizenship: z.string().optional(),
    suppress_evidence: z.array(z.string()).optional(),
    role_order: z.array(z.string()).optional(),
    bullet_order: z.record(z.array(z.number())).optional(),
    include_evidence: z.array(z.string()).optional(),
    drift_applications: z.array(DriftApplicationSchema).optional(),
    // Maps alias names to canonical role-order keys, e.g. { "gpdl": "Acme Corp|product data" }.
    // Supports pipe-separated "Company|title-fragment" syntax for disambiguation.
    company_aliases: z.record(z.string()).optional(),
  })
  .passthrough();

export type CvOverlay = z.infer<typeof CvOverlaySchema>;
