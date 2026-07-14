import { z } from "zod";
// Imports from the schema-only subpath (not the package's main barrel,
// which also re-exports node:fs-based config loaders) so this package stays
// safe to bundle into apps/web-ui's browser build (T5.10) — see
// packages/shared-config/src/schemas.ts for the full rationale.
import { SettingsSchema } from "@selfwright/shared-config/schemas";

// GET /api/settings returns the raw (validated) settings.yml document shape —
// not the "resolved with defaults" LoadedSettings convenience type used
// internally by the CLI/scan services. Re-exported (not redefined) so the
// contract always matches shared-config's schema growth (T5.11 additive
// extension) with zero duplication.
export { SettingsSchema as SettingsContractSchema };
export type { Settings as SettingsContract } from "@selfwright/shared-config/schemas";

// PUT /api/settings request body: a full settings.yml replacement document,
// validated by the exact same schema as the file on disk.
export const SettingsUpdateRequestSchema = SettingsSchema;

export const SettingsUpdateResponseSchema = z.object({
  settings: SettingsSchema,
});
export type SettingsUpdateResponse = z.infer<typeof SettingsUpdateResponseSchema>;
