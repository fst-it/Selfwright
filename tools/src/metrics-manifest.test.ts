/**
 * Staleness gate for metrics.json.
 *
 * Re-derives version, scanProviders, and fitnessChecks using the SAME static
 * functions as the generator and asserts they match the committed manifest.
 * If someone changes providers/checks/package-version without regenerating
 * metrics.json, this test (running under `pnpm test`) will fail.
 *
 * The `tests` field is only presence-checked (positive integer) because
 * re-running the full suite here would be prohibitively slow and circular.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MetricsManifestSchema, deriveScanProviders, deriveFitnessChecks, deriveVersion } from "./metrics-manifest.js";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "../..");

describe("metrics.json staleness gate", () => {
  it("committed metrics.json parses against MetricsManifestSchema", () => {
    const raw = readFileSync(resolve(REPO_ROOT, "metrics.json"), "utf-8");
    const result = MetricsManifestSchema.safeParse(JSON.parse(raw));
    expect(result.success, result.success ? "" : JSON.stringify((result as { error: unknown }).error)).toBe(true);
  });

  it("version field matches root package.json", () => {
    const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, "metrics.json"), "utf-8")) as Record<string, unknown>;
    expect(manifest["version"]).toBe(deriveVersion(REPO_ROOT));
  });

  it("scanProviders field matches KNOWN_PROVIDERS.length", () => {
    const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, "metrics.json"), "utf-8")) as Record<string, unknown>;
    expect(manifest["scanProviders"]).toBe(deriveScanProviders());
  });

  it("fitnessChecks field matches static derivation from fitness/src/runner.ts", () => {
    const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, "metrics.json"), "utf-8")) as Record<string, unknown>;
    const derived = deriveFitnessChecks(REPO_ROOT);
    const fc = manifest["fitnessChecks"] as { ci: number; total: number };
    expect(fc.ci).toBe(derived.ci);
    expect(fc.total).toBe(derived.total);
  });

  it("tests field is a positive integer", () => {
    const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, "metrics.json"), "utf-8")) as Record<string, unknown>;
    const tests = manifest["tests"];
    expect(typeof tests).toBe("number");
    expect(Number.isInteger(tests)).toBe(true);
    expect(tests as number).toBeGreaterThan(0);
  });
});
