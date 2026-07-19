import { z } from "zod";

// Bumped whenever a request/response schema in this package changes shape in
// a way a consumer (the T5.10 React cockpit) needs to know about. Independent
// of the platform SemVer (package.json "version" / CHANGELOG) — this is the
// wire-contract version, not the product release.
export const API_CONTRACT_VERSION = "1.0.0";

export const MetaResponseSchema = z.object({
  contractVersion: z.string(),
  platformVersion: z.string(),
  status: z.literal("ok"),
  /** The caller's CSRF token for this session, or null when unauthenticated. */
  csrfToken: z.string().nullable(),
});
export type MetaResponse = z.infer<typeof MetaResponseSchema>;
