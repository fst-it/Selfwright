// Split from the config schema (settings.ts) so a browser bundle that only
// needs a pure config *schema* never pulls in node:fs through this loader
// (T5.10 finding: apps/web-ui imports SettingsContractSchema transitively
// from @selfwright/api-contract -> @selfwright/shared-config; when the
// schema and this fs-based loader lived in one file, Vite/Rollup could not
// tree-shake the unused loadSettings() out of the client bundle, and the
// build failed trying to resolve node:fs in a browser target. Splitting pure
// schema from I/O loader into separate ES modules lets bundlers drop this
// whole file — and its node:fs import — when only the schema is used).
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import {
  SettingsSchema,
  DEFAULT_QUEUE_AGING_WINDOW_DAYS,
  DEFAULT_FIT_SCORE_CUTOFF_REVIEW_SOON,
  DEFAULT_INTERVIEW_STALE_DAYS,
  DEFAULT_APPLIED_REVIEW_DAYS,
  DEFAULT_APPLIED_DECIDE_DAYS,
  type LoadedSettings,
} from "./settings.js";
import { toMessage } from "./shared.js";

function defaults(): LoadedSettings {
  return {
    agingWindowDays: DEFAULT_QUEUE_AGING_WINDOW_DAYS,
    fitScoreCutoffReviewSoon: DEFAULT_FIT_SCORE_CUTOFF_REVIEW_SOON,
    interviewStaleDays: DEFAULT_INTERVIEW_STALE_DAYS,
    appliedReviewDays: DEFAULT_APPLIED_REVIEW_DAYS,
    appliedDecideDays: DEFAULT_APPLIED_DECIDE_DAYS,
    ntfyTopic: undefined,
    enabledDigests: undefined,
    quietHours: undefined,
    scheduleDay: "Sunday",
    scheduleHour: 9,
    scanVerify: false,
    aggregatorTitleFilter: undefined,
    aggregatorLocationFilter: undefined,
    coachingDefaultArchetype: undefined,
    debriefNudgeDays: 0,
    drillCadenceDays: 0,
    dashboardTheme: "system",
    dashboardLandingPage: "overview",
    dashboardTableDensity: "comfortable",
  };
}

/**
 * Read and validate config/settings.yml. Returns defaults when the file does
 * not exist (normal for new installs) or when the value is absent/invalid
 * (never-silent: writes a one-line warning to stderr in the invalid case).
 *
 * Designed so T5.11 can pass the path from the CLI/MCP startup path and feed
 * the result into the scan and inbox services.
 */
export function loadSettings(path: string): LoadedSettings {
  let raw: unknown;
  try {
    const text = readFileSync(path, "utf-8");
    raw = parse(text, { version: "1.2" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      // No settings file — use defaults silently.
      return defaults();
    }
    process.stderr.write(
      `[selfwright] settings.yml could not be read (${toMessage(e)}) — using defaults\n`,
    );
    return defaults();
  }

  const result = SettingsSchema.safeParse(raw);
  if (!result.success) {
    process.stderr.write(
      `[selfwright] settings.yml is invalid (${result.error.message}) — using defaults\n`,
    );
    return defaults();
  }

  const d = result.data;
  const days = d.queue?.aging_window_days;
  if (days !== undefined && (!Number.isInteger(days) || days <= 0)) {
    // This branch is unreachable via Zod (z.number().int().positive() already
    // rejects non-positive integers), but kept as a belt-and-suspenders guard.
    process.stderr.write(
      `[selfwright] settings.yml: queue.aging_window_days must be a positive integer — using default ${DEFAULT_QUEUE_AGING_WINDOW_DAYS}\n`,
    );
    return defaults();
  }

  return {
    agingWindowDays: d.queue?.aging_window_days ?? DEFAULT_QUEUE_AGING_WINDOW_DAYS,
    fitScoreCutoffReviewSoon:
      d.queue?.fit_score_cutoff_review_soon ?? DEFAULT_FIT_SCORE_CUTOFF_REVIEW_SOON,
    interviewStaleDays: d.inbox?.interview_stale_days ?? DEFAULT_INTERVIEW_STALE_DAYS,
    appliedReviewDays: d.inbox?.applied_review_days ?? DEFAULT_APPLIED_REVIEW_DAYS,
    appliedDecideDays: d.inbox?.applied_decide_days ?? DEFAULT_APPLIED_DECIDE_DAYS,
    ntfyTopic: d.notifications?.ntfy_topic,
    enabledDigests: d.notifications?.enabled_digests,
    quietHours: d.notifications?.quiet_hours,
    scheduleDay: d.scan?.schedule?.day ?? "Sunday",
    scheduleHour: d.scan?.schedule?.hour ?? 9,
    scanVerify: d.scan?.verify ?? false,
    aggregatorTitleFilter: d.scan?.aggregator_defaults?.title_filter,
    aggregatorLocationFilter: d.scan?.aggregator_defaults?.location_filter,
    coachingDefaultArchetype: d.coaching?.default_archetype,
    debriefNudgeDays: d.coaching?.debrief_nudge_days ?? 0,
    drillCadenceDays: d.coaching?.drill_cadence_days ?? 0,
    dashboardTheme: d.dashboard?.theme ?? "system",
    dashboardLandingPage: d.dashboard?.landing_page ?? "overview",
    dashboardTableDensity: d.dashboard?.table_density ?? "comfortable",
  };
}
