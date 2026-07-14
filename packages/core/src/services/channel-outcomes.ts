import type { ApplicationRecord } from "./types.js";
import { SUBMITTED_STATUSES, INTERVIEWED_STATUSES } from "./types.js";

// Mirrors the same guard used in north-star.ts (ADR 0017 FF-INPUT).
function isValidApplication(a: unknown): a is ApplicationRecord {
  return a !== null && typeof a === "object" && typeof (a as { status?: unknown }).status === "string";
}

export interface ChannelOutcome {
  channel: string;
  submitted: number;
  interviews: number;
  /** null only when submitted === 0; in practice each bucket is non-empty by construction */
  rate: number | null;
}

// Parameter is `unknown`, not `ApplicationRecord[]`: real callers parse this off disk
// (parseYaml) without a validated static type (ADR 0017 FF-INPUT).
// Only submitted-tier rows are bucketed; ready/evaluating/skipped rows are excluded.
// Rows without a `channel` field (or with a non-string value) are bucketed as "unknown".
export function computeChannelOutcomes(applications: unknown): ChannelOutcome[] {
  if (!Array.isArray(applications)) {
    throw new TypeError("computeChannelOutcomes: applications must be an array");
  }
  const valid = applications.filter(isValidApplication);
  const submittedRows = valid.filter((a) => SUBMITTED_STATUSES.has(a.status));

  const buckets = new Map<string, { submitted: number; interviews: number }>();
  for (const app of submittedRows) {
    const channel = typeof app.channel === "string" ? app.channel : "unknown";
    const bucket = buckets.get(channel) ?? { submitted: 0, interviews: 0 };
    bucket.submitted += 1;
    if (INTERVIEWED_STATUSES.has(app.status)) {
      bucket.interviews += 1;
    }
    buckets.set(channel, bucket);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([channel, { submitted, interviews }]) => ({
      channel,
      submitted,
      interviews,
      rate: submitted === 0 ? null : Math.round((interviews / submitted) * 100) / 100,
    }));
}
