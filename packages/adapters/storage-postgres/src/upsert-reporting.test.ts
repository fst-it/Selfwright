import { describe, it, expect, vi } from "vitest";
import { upsertApplication, upsertFitnessRun } from "./upsert-reporting.js";
import type { ApplicationRow, FitnessRunRow } from "./upsert-reporting.js";
import type { Sql } from "./types.js";

const APP_ROW: ApplicationRow = {
  id: "app-001",
  company: "TestCo",
  role: "Engineer",
  status: "applied",
  discovered: "2026-01-01",
  promoted: null,
  applied: "2026-01-05",
  last_update: "2026-01-05",
  fit_score: 0.85,
  ats_overall: 0.9,
};

const FITNESS_ROW: FitnessRunRow = {
  run_at: "2026-07-09T10:00:00.000Z",
  name: "FF-DATA-LEAK-1: data-leak gate",
  passed: true,
  skipped: false,
};

describe("upsertApplication", () => {
  it("calls sql with all application row fields", async () => {
    const mockSql = vi.fn().mockResolvedValue([]) as unknown as Sql;

    await upsertApplication(mockSql, APP_ROW);

    expect(mockSql).toHaveBeenCalledOnce();
  });

  it("does not throw for a row with all nullable fields set to null", async () => {
    const nullRow: ApplicationRow = {
      id: "app-002",
      company: "NullCo",
      role: "Contractor",
      status: "to_apply",
      discovered: null,
      promoted: null,
      applied: null,
      last_update: null,
      fit_score: null,
      ats_overall: null,
    };
    const mockSql = vi.fn().mockResolvedValue([]) as unknown as Sql;

    await expect(upsertApplication(mockSql, nullRow)).resolves.toBeUndefined();
    expect(mockSql).toHaveBeenCalledOnce();
  });
});

describe("upsertFitnessRun", () => {
  it("calls sql with all fitness run row fields", async () => {
    const mockSql = vi.fn().mockResolvedValue([]) as unknown as Sql;

    await upsertFitnessRun(mockSql, FITNESS_ROW);

    expect(mockSql).toHaveBeenCalledOnce();
  });

  it("does not throw for a skipped run row", async () => {
    const skippedRow: FitnessRunRow = {
      run_at: "2026-07-09T10:00:00.000Z",
      name: "FF-TRUTH-1b: production truth-trace",
      passed: false,
      skipped: true,
    };
    const mockSql = vi.fn().mockResolvedValue([]) as unknown as Sql;

    await expect(upsertFitnessRun(mockSql, skippedRow)).resolves.toBeUndefined();
    expect(mockSql).toHaveBeenCalledOnce();
  });
});
