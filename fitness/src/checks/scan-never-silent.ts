// FF-SCAN-3: every provider in packages/adapters/scan-http/src/providers/ that
// implements async fetch() must also contain a process.stderr.write call — the
// mechanism all compliant providers use to emit a zero-result warn so that a
// stale tenant slug or expired API token fails loudly rather than silently
// returning an empty result set.
//
// This is a static source check (Tier 1, CI, no SELFWRIGHT_DATA_DIR required).
// It reads provider source files and asserts the presence of the warn call; it
// does not verify the warn fires at runtime (the per-provider unit tests cover that).
//
// Exclusions:
//   generic.ts — the generic company-page fetcher uses ctx.fetchRaw rather than
//     a per-tenant API and produces a liveness verdict (live/expired/uncertain)
//     rather than a postings list. Zero results are normal (a single URL is
//     fetched, not a board listing), so the never-silent convention for board
//     providers does not apply here.
//   workday-browser (packages/adapters/scan-browser/) — lives outside the
//     scan-http/providers/ directory that this check scans; it is a browser-
//     automation provider covered by its own test suite.
//   __tests__/ subdirectory — test files are excluded by the .ts + directory
//     filter below.

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { CheckResult } from "./shared.js";

const CHECK_NAME =
  "FF-SCAN-3: all scan-http providers emit a zero-result stderr warn (never-silent convention)";

// Provider files legitimately exempt from the never-silent convention.
// Each entry must name the file (basename only) and the justification is in
// the module-level comment above.
const EXEMPTIONS = new Set(["generic.ts"]);

// Detect files that implement a provider's fetch() method.
const FETCH_METHOD_RE = /async\s+fetch\s*\(/;
// Detect the zero-result warn call (process.stderr.write is the mechanism
// all compliant providers use — see packages/adapters/scan-http/src/providers/*.ts).
const STDERR_WRITE_RE = /process\.stderr\.write/;

export function checkScanNeverSilent(repoRoot: string): CheckResult {
  const providersDir = join(
    repoRoot,
    "packages",
    "adapters",
    "scan-http",
    "src",
    "providers",
  );

  let entries: string[];
  try {
    entries = readdirSync(providersDir);
  } catch {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `Cannot read providers directory: ${providersDir}`,
    };
  }

  const violations: string[] = [];

  for (const entry of entries) {
    // Only source .ts files in the providers/ directory itself (not __tests__/).
    if (!entry.endsWith(".ts") || entry.endsWith(".d.ts")) continue;
    if (EXEMPTIONS.has(entry)) continue;

    const fullPath = join(providersDir, entry);
    let content: string;
    try {
      content = readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }

    if (!FETCH_METHOD_RE.test(content)) continue; // not a fetch-performing file
    if (STDERR_WRITE_RE.test(content)) continue; // has the warn call

    const relPath = relative(repoRoot, fullPath).split("\\").join("/");
    violations.push(
      `${relPath}: provider has async fetch() but no process.stderr.write zero-result warn`,
    );
  }

  if (violations.length > 0) {
    return { name: CHECK_NAME, passed: false, details: violations.join("\n") };
  }
  return { name: CHECK_NAME, passed: true };
}
