import { z } from "zod";
// Imports from the schema-only subpath (not the package's main barrel) so
// this contract stays safe for browser bundles — see the rationale in
// api-contract/src/settings.ts.
import { ScanTargetSchema, ScanTargetsConfigSchema } from "@selfwright/shared-config/schemas";

// GET /api/scan-targets — validated pipeline/scan-targets.yml document. Empty
// targets array when the file is absent or invalid.
export { ScanTargetsConfigSchema as ScanTargetsContractSchema };
export type { ScanTargetsConfig as ScanTargetsContract } from "@selfwright/shared-config/schemas";

// Re-export ScanTargetSchema for SettingsPage UI import convenience.
export { ScanTargetSchema };
export type { ScanTargetConfig } from "@selfwright/shared-config/schemas";

// PUT /api/scan-targets request body: full document replacement, validated by
// the same ScanTargetsConfigSchema used on disk.
export const ScanTargetsUpdateRequestSchema = ScanTargetsConfigSchema;

export const ScanTargetsUpdateResponseSchema = z.object({
  targets: z.array(ScanTargetSchema),
});
export type ScanTargetsUpdateResponse = z.infer<typeof ScanTargetsUpdateResponseSchema>;
