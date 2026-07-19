// Consistent JSON error envelope for every /api/* response (T5.9 design
// requirement #4): never leak stack traces or file paths, always { error: { code, message } }.
import { z } from "zod";

export const ApiErrorCodeSchema = z.enum([
  "UNAUTHORIZED",
  "FORBIDDEN_ORIGIN",
  "FORBIDDEN_CSRF",
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "HOOK_REJECTED",
  "INTERNAL_ERROR",
  // The file exists but is present-but-unparseable/schema-invalid (as opposed
  // to simply absent, which defaults cleanly) — settings.yml/scan-targets.yml.
  "DATA_CORRUPT",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
  }),
});
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>;
