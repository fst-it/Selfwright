import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadSettings,
  DEFAULT_QUEUE_AGING_WINDOW_DAYS,
  DEFAULT_FIT_SCORE_CUTOFF_REVIEW_SOON,
  DEFAULT_INTERVIEW_STALE_DAYS,
  DEFAULT_APPLIED_REVIEW_DAYS,
  DEFAULT_APPLIED_DECIDE_DAYS,
} from "../index.js";
import { SettingsSchema } from "../settings.js";

describe("loadSettings", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sw-settings-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns default aging window when file does not exist", () => {
    const result = loadSettings(join(tmpDir, "nonexistent.yml"));
    expect(result.agingWindowDays).toBe(DEFAULT_QUEUE_AGING_WINDOW_DAYS);
    expect(result.agingWindowDays).toBe(30);
  });

  it("reads queue.aging_window_days from a valid settings.yml", () => {
    writeFileSync(join(tmpDir, "settings.yml"), "queue:\n  aging_window_days: 14\n");
    const result = loadSettings(join(tmpDir, "settings.yml"));
    expect(result.agingWindowDays).toBe(14);
  });

  it("returns default when queue section is absent", () => {
    writeFileSync(join(tmpDir, "settings.yml"), "{}\n");
    const result = loadSettings(join(tmpDir, "settings.yml"));
    expect(result.agingWindowDays).toBe(DEFAULT_QUEUE_AGING_WINDOW_DAYS);
  });

  it("returns default and writes to stderr when aging_window_days is not a positive integer", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    writeFileSync(join(tmpDir, "settings.yml"), "queue:\n  aging_window_days: 0\n");
    const result = loadSettings(join(tmpDir, "settings.yml"));
    expect(result.agingWindowDays).toBe(DEFAULT_QUEUE_AGING_WINDOW_DAYS);
    expect(stderrSpy).toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it("returns default and writes to stderr when aging_window_days is negative", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    writeFileSync(join(tmpDir, "settings.yml"), "queue:\n  aging_window_days: -5\n");
    const result = loadSettings(join(tmpDir, "settings.yml"));
    expect(result.agingWindowDays).toBe(DEFAULT_QUEUE_AGING_WINDOW_DAYS);
    expect(stderrSpy).toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it("returns default and writes to stderr when settings.yml is malformed YAML", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    writeFileSync(join(tmpDir, "settings.yml"), "queue: [\n  broken yaml");
    const result = loadSettings(join(tmpDir, "settings.yml"));
    expect(result.agingWindowDays).toBe(DEFAULT_QUEUE_AGING_WINDOW_DAYS);
    // stderr written for parse error
    expect(stderrSpy).toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it("DEFAULT_QUEUE_AGING_WINDOW_DAYS is 30", () => {
    expect(DEFAULT_QUEUE_AGING_WINDOW_DAYS).toBe(30);
  });

  it("returns default inbox staleness thresholds when inbox section is absent", () => {
    writeFileSync(join(tmpDir, "settings.yml"), "{}\n");
    const result = loadSettings(join(tmpDir, "settings.yml"));
    expect(result.interviewStaleDays).toBe(DEFAULT_INTERVIEW_STALE_DAYS);
    expect(result.appliedReviewDays).toBe(DEFAULT_APPLIED_REVIEW_DAYS);
    expect(result.appliedDecideDays).toBe(DEFAULT_APPLIED_DECIDE_DAYS);
  });

  it("reads inbox staleness thresholds from a valid settings.yml", () => {
    writeFileSync(
      join(tmpDir, "settings.yml"),
      "inbox:\n  interview_stale_days: 5\n  applied_review_days: 10\n  applied_decide_days: 15\n",
    );
    const result = loadSettings(join(tmpDir, "settings.yml"));
    expect(result.interviewStaleDays).toBe(5);
    expect(result.appliedReviewDays).toBe(10);
    expect(result.appliedDecideDays).toBe(15);
  });

  it("reads fit_score_cutoff_review_soon from a valid settings.yml", () => {
    writeFileSync(join(tmpDir, "settings.yml"), "queue:\n  fit_score_cutoff_review_soon: 4.0\n");
    const result = loadSettings(join(tmpDir, "settings.yml"));
    expect(result.fitScoreCutoffReviewSoon).toBe(4.0);
  });

  it("returns default fit score cutoff when absent", () => {
    writeFileSync(join(tmpDir, "settings.yml"), "{}\n");
    const result = loadSettings(join(tmpDir, "settings.yml"));
    expect(result.fitScoreCutoffReviewSoon).toBe(DEFAULT_FIT_SCORE_CUTOFF_REVIEW_SOON);
  });

  it("reads coaching settings from a valid settings.yml", () => {
    writeFileSync(
      join(tmpDir, "settings.yml"),
      "coaching:\n  default_archetype: data-engineering\n  debrief_nudge_days: 14\n  drill_cadence_days: 3\n",
    );
    const result = loadSettings(join(tmpDir, "settings.yml"));
    expect(result.coachingDefaultArchetype).toBe("data-engineering");
    expect(result.debriefNudgeDays).toBe(14);
    expect(result.drillCadenceDays).toBe(3);
  });

  it("reads dashboard settings from a valid settings.yml", () => {
    writeFileSync(
      join(tmpDir, "settings.yml"),
      "dashboard:\n  theme: dark\n  landing_page: inbox\n  table_density: compact\n",
    );
    const result = loadSettings(join(tmpDir, "settings.yml"));
    expect(result.dashboardTheme).toBe("dark");
    expect(result.dashboardLandingPage).toBe("inbox");
    expect(result.dashboardTableDensity).toBe("compact");
  });

  it("returns default dashboard values when dashboard section is absent", () => {
    writeFileSync(join(tmpDir, "settings.yml"), "{}\n");
    const result = loadSettings(join(tmpDir, "settings.yml"));
    expect(result.dashboardTheme).toBe("system");
    expect(result.dashboardLandingPage).toBe("overview");
    expect(result.dashboardTableDensity).toBe("comfortable");
  });

  it("returns default scan schedule when scan section is absent", () => {
    writeFileSync(join(tmpDir, "settings.yml"), "{}\n");
    const result = loadSettings(join(tmpDir, "settings.yml"));
    expect(result.scheduleDay).toBe("Sunday");
    expect(result.scheduleHour).toBe(9);
    expect(result.scanVerify).toBe(false);
  });
});

describe("SettingsSchema strict mode", () => {
  it("rejects unknown top-level keys", () => {
    expect(SettingsSchema.safeParse({ unknownKey: true }).success).toBe(false);
  });

  it("rejects unknown keys inside queue", () => {
    expect(
      SettingsSchema.safeParse({ queue: { aging_window_days: 14, badKey: 1 } }).success,
    ).toBe(false);
  });

  it("rejects unknown keys inside inbox", () => {
    expect(
      SettingsSchema.safeParse({ inbox: { interview_stale_days: 7, badKey: 1 } }).success,
    ).toBe(false);
  });

  it("accepts a full valid settings document", () => {
    const result = SettingsSchema.safeParse({
      queue: { aging_window_days: 30, fit_score_cutoff_review_soon: 3.5 },
      inbox: { interview_stale_days: 7, applied_review_days: 14, applied_decide_days: 21 },
      notifications: { ntfy_topic: "https://ntfy.sh/selfwright", enabled_digests: ["scan"] },
      scan: {
        schedule: { day: "Monday", hour: 8 },
        verify: true,
        aggregator_defaults: { title_filter: ["Engineer"], location_filter: ["London"] },
      },
      coaching: { default_archetype: "data-eng", debrief_nudge_days: 7, drill_cadence_days: 3 },
      dashboard: { theme: "dark", landing_page: "inbox", table_density: "compact" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty document (all defaults)", () => {
    expect(SettingsSchema.safeParse({}).success).toBe(true);
  });
});
