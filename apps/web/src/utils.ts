import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ApplicationRecord } from "@selfwright/core";
import type { FitnessRunContract } from "@selfwright/api-contract";

/** Read a file as text, returning null on any error (missing, permission, etc.). */
export async function tryReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Read reports/fitness-history.jsonl relative to repoRoot. Used by the
 * /api/overview and /api/reporting endpoints (the sole consumers since the
 * T5.10 clean cutover deleted the SSR routes that once duplicated this
 * parsing logic independently).
 */
export async function loadFitnessHistory(repoRoot: string): Promise<FitnessRunContract[]> {
  const histPath = join(repoRoot, "reports", "fitness-history.jsonl");
  const raw = await tryReadFile(histPath);
  if (raw === null) return [];
  const runs: FitnessRunContract[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "runAt" in parsed &&
        "passed" in parsed &&
        "failed" in parsed &&
        "skipped" in parsed
      ) {
        const p = parsed as Record<string, unknown>;
        if (
          typeof p["runAt"] === "string" &&
          typeof p["passed"] === "number" &&
          typeof p["failed"] === "number" &&
          typeof p["skipped"] === "number"
        ) {
          runs.push({
            runAt: p["runAt"],
            passed: p["passed"],
            failed: p["failed"],
            skipped: p["skipped"],
          });
        }
      }
    } catch {
      // skip malformed lines
    }
  }
  return runs;
}

/**
 * Filter a raw YAML-parsed array to only valid (non-null, object) application entries.
 * Blank `- ` list items parse to null in YAML; this prevents them from crashing
 * computeNorthStar / inboxService.
 */
export function filterValidApplications(parsed: unknown[]): ApplicationRecord[] {
  return parsed.filter(
    (a): a is ApplicationRecord => a !== null && typeof a === "object",
  );
}
