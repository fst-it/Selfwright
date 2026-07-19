import { z } from "zod";

/**
 * Exhaustive list of provider ids known to the scanner. Kept here (not in
 * packages/core or the CLI) so the schema can use z.enum for strict
 * validation while avoiding a circular dependency on the adapter layer.
 * Update this list when a new provider is added to SCAN_PROVIDERS in the CLI.
 */
export const KNOWN_PROVIDERS = [
  "adzuna",
  "arbeitnow",
  "ashby",
  "bamboohr",
  "breezy",
  "generic",
  "greenhouse",
  "himalayas",
  "lever",
  "oracle",
  "personio",
  "recruitee",
  "remoteok",
  "remotive",
  "smartrecruiters",
  "weworkremotely",
  "workable",
  "workday",
  "workday-browser",
] as const;

export type KnownProvider = typeof KNOWN_PROVIDERS[number];

export const ScanTargetSchema = z
  .object({
    company: z.string(),
    /** One of the registered scanner provider ids. */
    provider: z.enum(KNOWN_PROVIDERS),
    /**
     * Public HTTPS URL for the company's careers or job-posting page.
     * Must be a valid absolute URL. Validated as a URL to prevent
     * private-IP SSRF via the PUT /api/scan-targets write path.
     */
    careersUrl: z.string().url().optional(),
    /**
     * Explicit API URL overriding provider auto-detection.
     * Must be a valid absolute URL for the same reason as careersUrl.
     */
    api: z.string().url().optional(),
    country: z.string().optional(),
    titleFilter: z.array(z.string()).optional(),
    locationFilter: z.array(z.string()).optional(),
    skipTiers: z.array(z.string()).optional(),
    /** When true, this target is skipped by the scanner with a stderr note. */
    disabled: z.boolean().optional(),
  })
  .strict();
export type ScanTargetConfig = z.infer<typeof ScanTargetSchema>;

export const ScanTargetsConfigSchema = z
  .object({
    targets: z.array(ScanTargetSchema),
  })
  .strict();
export type ScanTargetsConfig = z.infer<typeof ScanTargetsConfigSchema>;
