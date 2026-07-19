import type { CheckResult } from "./checks/shared.js";

export type FitnessHistoryRecord = {
  readonly runAt: string;
  readonly results: ReadonlyArray<{ readonly name: string; readonly passed: boolean; readonly skipped: boolean }>;
  readonly passed: number;
  readonly skipped: number;
  readonly failed: number;
};

/**
 * Pure builder for a fitness-history JSONL record. Extracted for testability;
 * note that fitness/ has no test infrastructure (no vitest.config), so this
 * function is covered only by the postgres adapter tests and the fitness runner
 * integration. Add a vitest config to fitness/ to unit-test this directly.
 */
export function buildFitnessHistoryRecord(
  results: readonly CheckResult[],
  runAt: string,
  passed: number,
  skipped: number,
  failed: number,
): FitnessHistoryRecord {
  return {
    runAt,
    results: results.map((r) => ({
      name: r.name,
      passed: r.passed,
      skipped: r.skipped ?? false,
    })),
    passed,
    skipped,
    failed,
  };
}
