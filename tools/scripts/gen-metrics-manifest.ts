#!/usr/bin/env tsx
/**
 * Generates the public metrics manifest at <repo-root>/metrics.json.
 *
 * Every field is derived from the repo — nothing is hand-typed:
 *   version        → root package.json
 *   scanProviders  → KNOWN_PROVIDERS array length in shared-config
 *   fitnessChecks  → tier counts statically parsed from fitness/src/runner.ts
 *   tests          → sum of "Tests N passed" lines from `pnpm test` output
 *   generatedAt    → --date=YYYY-MM-DD arg, or latest git commit date (%cs)
 *   commit         → short HEAD sha
 *
 * Usage (from repo root):
 *   pnpm gen-metrics-manifest
 *   pnpm gen-metrics-manifest -- --date=2026-07-14
 */

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { MetricsManifestSchema, deriveScanProviders, deriveFitnessChecks, deriveVersion } from "../src/metrics-manifest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// generator is at tools/scripts/; repo root is two levels up
const repoRoot = resolve(__dirname, "../..");

// 1. version
const version = deriveVersion(repoRoot);

// 2. scanProviders
const scanProviders = deriveScanProviders();

// 3. fitnessChecks (static parse of runner.ts)
const fitnessChecks = deriveFitnessChecks(repoRoot);

// 4. tests — run the full suite and sum "Tests N passed" per package.
//    Catches test failures (e.g. staleness test before metrics.json exists)
//    so the generator still captures counts from the partial output.
let rawTestOutput = "";
try {
  rawTestOutput = execSync("pnpm test", {
    cwd: repoRoot,
    encoding: "utf-8",
    stdio: "pipe",
    timeout: 5 * 60 * 1000,
  });
} catch (e: unknown) {
  // pnpm test exits non-zero when any package fails (e.g. first run before
  // metrics.json exists). Still parse stdout for test counts.
  const err = e as { stdout?: string; stderr?: string };
  rawTestOutput = (err.stdout ?? "") + (err.stderr ?? "");
}
// Strip ANSI escape codes before matching
const cleanOutput = rawTestOutput.replace(/\x1b\[[0-9;]*[mGKHF]/g, "");
// Sum "Tests  N passed" lines (one per package; distinct from "Test Files  N passed")
const testsTotal = [...cleanOutput.matchAll(/\bTests\s+(\d+) passed/g)].reduce(
  (sum, m) => sum + parseInt(m[1] ?? "0", 10),
  0,
);
if (testsTotal === 0) {
  process.stderr.write(
    "[gen-metrics-manifest] WARN: could not parse any test counts from pnpm test output.\n",
  );
}

// 5. generatedAt — prefer --date=YYYY-MM-DD arg; fall back to latest git commit date
const dateArg = process.argv.find((a) => a.startsWith("--date="))?.slice("--date=".length);
const generatedAt =
  dateArg ?? execSync("git log -1 --format=%cs", { cwd: repoRoot, encoding: "utf-8" }).trim();

// 6. commit — short HEAD sha
const commit = execSync("git rev-parse --short HEAD", { cwd: repoRoot, encoding: "utf-8" }).trim();

// Validate and write
const manifest = MetricsManifestSchema.parse({
  schemaVersion: 1,
  version,
  fitnessChecks,
  scanProviders,
  tests: testsTotal,
  generatedAt,
  commit,
});

const outPath = resolve(repoRoot, "metrics.json");
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
console.log(`[gen-metrics-manifest] Written to ${outPath}`);
console.log(JSON.stringify(manifest, null, 2));
