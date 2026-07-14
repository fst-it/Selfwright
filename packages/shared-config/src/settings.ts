import { z } from "zod";

// ── Settings (T5.5 — settings.yml, T5.11 extensions) ─────────────────────────

export const DEFAULT_QUEUE_AGING_WINDOW_DAYS = 30;
export const DEFAULT_FIT_SCORE_CUTOFF_REVIEW_SOON = 3.5;
export const DEFAULT_INTERVIEW_STALE_DAYS = 7;
export const DEFAULT_APPLIED_REVIEW_DAYS = 14;
export const DEFAULT_APPLIED_DECIDE_DAYS = 21;

/**
 * Schema for config/settings.yml. Uses `.strict()` at every level to reject
 * unknown keys — unknown keys in settings.yml are always either a typo or a
 * key removed from the schema; accepting them silently hides both cases.
 *
 * ABSOLUTE BOUNDARY (T5.11): the truth floor, honesty walls, data-leak gates,
 * and fitness-function thresholds are NOT configurable via settings.yml. Only
 * operational preferences (UI, schedule, notifications) and tiering/display
 * thresholds live here. See docs/MANUAL.md §6.6 for the full boundary spec.
 *
 * Add new settings here and bump the minor version comment when extending.
 * Every new key must be optional (no required fields — missing file = all
 * defaults, never-crash convention).
 */
export const SettingsSchema = z
  .object({
    queue: z
      .object({
        /**
         * Days after which a queue entry whose scan-refresh timestamp is older
         * than this window is considered stale and hidden from default views.
         * Must be a positive integer. Default: 30.
         */
        aging_window_days: z.number().int().positive().optional(),
        /**
         * Minimum fit-score for a queue entry to appear in review-soon (inbox
         * tier 2). Default: 3.5. Range [0, 5].
         */
        fit_score_cutoff_review_soon: z.number().min(0).max(5).optional(),
      })
      .strict()
      .optional(),

    inbox: z
      .object({
        /**
         * Days since last update before an interview/offer application is
         * considered stale (moves from review-soon to decide-now). Default: 7.
         */
        interview_stale_days: z.number().int().positive().optional(),
        /**
         * Days since applied before a pending application is surfaced in
         * review-soon. Default: 14.
         */
        applied_review_days: z.number().int().positive().optional(),
        /**
         * Days since applied before a pending application escalates to
         * decide-now. Default: 21.
         */
        applied_decide_days: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),

    notifications: z
      .object({
        /**
         * Full ntfy topic URL override. When set, selfwright notify() uses this
         * URL instead of the NTFY_URL environment variable.
         */
        ntfy_topic: z.string().optional(),
        /**
         * List of digest types that trigger push notifications. When absent,
         * all notify() calls proceed (subject to ntfy_topic / NTFY_URL). When
         * present, notify() is suppressed for digest kinds not in this list.
         */
        enabled_digests: z.array(z.string()).optional(),
        /**
         * Quiet-hours window: push notifications are suppressed when the local
         * hour is within [start, end) (24-hour clock, inclusive start, exclusive
         * end). Example: { start: 22, end: 7 } suppresses 10 pm – 7 am.
         */
        quiet_hours: z
          .object({
            start: z.number().int().min(0).max(23),
            end: z.number().int().min(0).max(23),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),

    scan: z
      .object({
        schedule: z
          .object({
            /**
             * Day of week for the weekly scan task. Default: "Sunday".
             * Effective on next install-scheduled-tasks.ps1 reinstall.
             */
            day: z
              .enum([
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
              ])
              .optional(),
            /**
             * Hour of day (0–23) for the scan and inbox tasks. Default: 9.
             * Effective on next install-scheduled-tasks.ps1 reinstall.
             */
            hour: z.number().int().min(0).max(23).optional(),
          })
          .strict()
          .optional(),
        /**
         * Enable browser re-verification of uncertain postings (ADR 0012).
         * Default: false. Effective on next install-scheduled-tasks.ps1
         * reinstall. Requires `npx playwright install chromium` once.
         */
        verify: z.boolean().optional(),
        /**
         * Default filters applied to aggregator targets (adzuna, arbeitnow)
         * that do not specify their own titleFilter/locationFilter. Overridden
         * per-target in scan-targets.yml.
         */
        aggregator_defaults: z
          .object({
            title_filter: z.array(z.string()).optional(),
            location_filter: z.array(z.string()).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),

    coaching: z
      .object({
        /**
         * Default archetype id used by `selfwright inbox` when --archetype is
         * not supplied on the command line.
         */
        default_archetype: z.string().optional(),
        /**
         * Days since last interview update within which the debrief nudge is
         * active. 0 = always nudge (backward-compatible default).
         */
        debrief_nudge_days: z.number().int().min(0).optional(),
        /**
         * Minimum days between drill suggestions in the inbox FYI tier.
         * 0 = no cadence suppression (backward-compatible default).
         */
        drill_cadence_days: z.number().int().min(0).optional(),
      })
      .strict()
      .optional(),

    dashboard: z
      .object({
        /**
         * Cockpit colour scheme. "system" follows the OS preference. Default:
         * "system".
         */
        theme: z.enum(["light", "dark", "system"]).optional(),
        /**
         * Route the cockpit lands on after login. Default: "overview".
         */
        landing_page: z
          .enum([
            "overview",
            "inbox",
            "pipeline",
            "queue",
            "coaching",
            "content",
            "reporting",
            "settings",
          ])
          .optional(),
        /**
         * Table row density. Default: "comfortable".
         */
        table_density: z.enum(["compact", "comfortable"]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type Settings = z.infer<typeof SettingsSchema>;

/**
 * Resolved settings with all defaults applied. Returned by loadSettings() so
 * consumers never need to branch on undefined — every field is always present
 * after loading. Fields with undefined values (ntfyTopic, quietHours, etc.)
 * represent "not configured" rather than missing.
 */
export interface LoadedSettings {
  // queue
  agingWindowDays: number;
  fitScoreCutoffReviewSoon: number;
  // inbox
  interviewStaleDays: number;
  appliedReviewDays: number;
  appliedDecideDays: number;
  // notifications
  ntfyTopic: string | undefined;
  enabledDigests: string[] | undefined;
  quietHours: { start: number; end: number } | undefined;
  // scan
  scheduleDay: string;
  scheduleHour: number;
  scanVerify: boolean;
  aggregatorTitleFilter: string[] | undefined;
  aggregatorLocationFilter: string[] | undefined;
  // coaching
  coachingDefaultArchetype: string | undefined;
  debriefNudgeDays: number;
  drillCadenceDays: number;
  // dashboard
  dashboardTheme: "light" | "dark" | "system";
  dashboardLandingPage: string;
  dashboardTableDensity: "compact" | "comfortable";
}
