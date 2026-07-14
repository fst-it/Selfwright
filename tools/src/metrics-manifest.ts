import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { KNOWN_PROVIDERS } from "@selfwright/shared-config";
import { z } from "zod";

// ── Schema ───────────────────────────────────────────────────────────────────

export const MetricsManifestSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.string().min(1),
  fitnessChecks: z.object({
    ci: z.number().int().positive(),
    total: z.number().int().positive(),
  }),
  scanProviders: z.number().int().positive(),
  tests: z.number().int().positive(),
  generatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  commit: z.string().min(1),
});

export type MetricsManifest = z.infer<typeof MetricsManifestSchema>;

// ── Derivation helpers ────────────────────────────────────────────────────────

/** Returns the count of known scan providers from the KNOWN_PROVIDERS registry. */
export function deriveScanProviders(): number {
  return KNOWN_PROVIDERS.length;
}

/**
 * Derives fitnessChecks counts by statically reading fitness/src/runner.ts
 * and counting check function calls in each tier section.
 *
 * This avoids importing the runner (which has a main() side-effect) and avoids
 * a circular dependency (fitness → tools; tools cannot → fitness).
 */
export function deriveFitnessChecks(repoRoot: string): { ci: number; total: number } {
  const runnerPath = resolve(repoRoot, "fitness/src/runner.ts");
  const src = readFileSync(runnerPath, "utf-8");

  // Tier markers that appear in the results array (not the top comments).
  const tier1Marker = "// ── Tier 1: Always runs in CI";
  const tier2Marker = "// ── Tier 2: Local-only";

  const t1Start = src.indexOf(tier1Marker);
  const t2Start = src.indexOf(tier2Marker);
  if (t1Start === -1 || t2Start === -1) {
    throw new Error(
      `fitness/src/runner.ts: tier markers not found. ` +
        `Expected "${tier1Marker}" and "${tier2Marker}".`,
    );
  }

  // Count check*( function calls (not import statements, which use { }).
  const countFnCalls = (s: string): number => (s.match(/\bcheck\w+\(/g) ?? []).length;

  const ci = countFnCalls(src.slice(t1Start, t2Start));

  // Limit tier-2 section to the closing ]; of the results array.
  const tier2Raw = src.slice(t2Start);
  const resultsEnd = tier2Raw.indexOf("];");
  const tier2Src = resultsEnd >= 0 ? tier2Raw.slice(0, resultsEnd + 2) : tier2Raw;
  const tier2Count = countFnCalls(tier2Src);

  return { ci, total: ci + tier2Count };
}

/** Returns the `version` field from the root package.json. */
export function deriveVersion(repoRoot: string): string {
  const pkgPath = resolve(repoRoot, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };
  return pkg.version;
}
