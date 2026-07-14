import type { ApplicationRecord } from "./types.js";
import { SUBMITTED_STATUSES, INTERVIEWED_STATUSES } from "./types.js";

// A malformed row (null/non-object — the "null-YAML-row" class, ADR 0017 FF-INPUT) is
// simply not counted rather than crashing the whole computation, matching the "isolate
// row failures" convention already used at the sync-db/CLI callers of this data.
function isValidApplication(a: unknown): a is ApplicationRecord {
  return a !== null && typeof a === "object" && typeof (a as { status?: unknown }).status === "string";
}

// Parameter is `unknown`, not `ApplicationRecord[]`: real callers parse this off disk
// (parseYaml) without a validated static type, so the declared array-element type can't
// be trusted at the boundary (the "null-YAML-row" class, ADR 0017 FF-INPUT).
export function computeNorthStar(applications: unknown): {
  submitted: number;
  interviews: number;
  ratePerTen: number | null;
} {
  if (!Array.isArray(applications)) {
    throw new TypeError("computeNorthStar: applications must be an array");
  }
  const valid = applications.filter(isValidApplication);
  const submitted = valid.filter((a) => SUBMITTED_STATUSES.has(a.status)).length;
  const interviews = valid.filter((a) => INTERVIEWED_STATUSES.has(a.status)).length;
  const ratePerTen =
    submitted === 0 ? null : Math.round((interviews / submitted) * 10 * 100) / 100;
  return { submitted, interviews, ratePerTen };
}
