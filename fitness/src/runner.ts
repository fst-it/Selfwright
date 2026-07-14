// ── CI tiers ──────────────────────────────────────────────────────────────────
// History persistence: after every run, ONE JSON line is appended to
// <dataDir>/telemetry/fitness-history.jsonl (best-effort; write failure does
// NOT change exit code or output — only warns to stderr). If no data dir is
// resolvable (e.g. cloud CI), the write is silently skipped.
//
// TIER 1 — Always runs in CI (no private data needed):
//   FF-DATA-LEAK-1, FF-PORT-1, FF-CONTEXT-1, FF-LAZY-1, FF-HALLUC-1
//   FF-TRUTH-1a (synthetic truth-trace), FF-TRUTH-3 (synthetic honesty),
//   FF-TRUTH-5a (synthetic r19), FF-TAILOR-1, FF-TAILOR-2, FF-TAILOR-3, FF-FIT-1,
//   FF-LLM-1, FF-GEN-1, FF-SCAN-1 (scan liveness), FF-SCAN-2 (scan dedup),
//   FF-SCAN-3 (scan never-silent: all providers emit zero-result warn),
//   FF-DET-1 (determinism ratio), FF-COST-1 (cost-per-app budget), FF-WEB-1 (web dashboard
//   safety), FF-APICONTRACT (/api/* JSON contract test suite), FF-EGRESS (SSRF guard
//   structural scan), FF-CRED (credential-path scan), FF-INPUT (malformed-input fuzz suite),
//   FF-ATS (ATS pass-through on golden tailored CV), FF-AISOUND (no AI-tell phrases),
//   FF-WEB-UI-1 (web-ui must not import core or adapters), FF-TEMPLATE-1
//   (examples/data-template validates against every schema it ships)
//
// TIER 2 — Local-only (need SELFWRIGHT_DATA_DIR pointing to private data):
//   FF-TRUTH-1b (production truth-trace), FF-TRUTH-2 (dangling EVD refs),
//   FF-TRUTH-4 (identity facts), FF-TRUTH-5b (production r19),
//   FF-VOCAB-1 (real scoring vocabulary loaded)
//
// Tier-2 checks show ~ (skipped) in CI rather than ✓ (passed) so the
// distinction is honest: skipped ≠ green.

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { checkDataLeak } from "./checks/data-leak.js";
import { checkCoreNoProviderImports } from "./checks/core-no-provider-imports.js";
import { checkContextBoundaries } from "./checks/context-boundaries.js";
import { checkAntiLaziness } from "./checks/anti-laziness.js";
import { checkAntiHallucination } from "./checks/anti-hallucination.js";
import { checkTruthTraceSynthetic, checkTruthTraceProduction } from "./checks/truth-trace.js";
import { checkTruthDangling } from "./checks/truth-dangling.js";
import { checkTruthHonesty } from "./checks/truth-honesty.js";
import { checkTruthIdentity } from "./checks/truth-identity.js";
import { checkTruthR19Synthetic, checkTruthR19Production } from "./checks/truth-r19.js";
import { checkTailorOverlayGuard } from "./checks/tailor-overlay-guard.js";
import { checkTailorDriftApply } from "./checks/tailor-drift-apply.js";
import { checkTailorHonestyOutput } from "./checks/tailor-honesty-output.js";
import { checkFitNonDegeneracy } from "./checks/fit-nondegeneracy.js";
import { checkLlmEgress } from "./checks/llm-egress.js";
import { checkGeneratedArtifactTrace } from "./checks/generated-artifact-trace.js";
import { checkScanLiveness } from "./checks/scan-liveness.js";
import { checkScanDedup } from "./checks/scan-dedup.js";
import { checkDeterminismRatio } from "./checks/determinism-ratio.js";
import { checkCostBudget } from "./checks/cost-budget.js";
import { checkWebSafety } from "./checks/web-safety.js";
import { checkApiContract } from "./checks/api-contract.js";
import { checkEgressGuard } from "./checks/egress-guard.js";
import { checkCredPaths } from "./checks/cred-paths.js";
import { checkFuzzInput } from "./checks/fuzz-input.js";
import { checkScoringVocabulary } from "./checks/scoring-vocabulary.js";
import { checkFfAts } from "./checks/ff-ats.js";
import { checkFfAisound } from "./checks/ff-aisound.js";
import { checkWebUiBoundary } from "./checks/web-ui-boundary.js";
import { checkTemplateSchema } from "./checks/template-schema.js";
import { checkScanNeverSilent } from "./checks/scan-never-silent.js";
import type { CheckResult } from "./checks/shared.js";
import { buildFitnessHistoryRecord } from "./history.js";

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";

function fmt(result: CheckResult): string {
  if (result.skipped) {
    return `${YELLOW}~${RESET} ${result.name}`;
  }
  const icon = result.passed ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
  return `${icon} ${result.name}`;
}

function main(): void {
  // fitness/ is the cwd when run via turbo; repo root is one level up
  const repoRoot = resolve(process.cwd(), "..");
  const dataDir = process.env["SELFWRIGHT_DATA_DIR"] ?? "";
  console.log(`${BOLD}Selfwright fitness functions${RESET}  (root: ${repoRoot})\n`);

  const results: CheckResult[] = [
    // ── Tier 1: Always runs in CI ──────────────────────────────────────────────
    checkDataLeak(repoRoot),
    checkCoreNoProviderImports(repoRoot),
    checkContextBoundaries(repoRoot),
    checkAntiLaziness(repoRoot),
    checkAntiHallucination(repoRoot),
    checkTruthTraceSynthetic(),
    checkTruthHonesty(),
    checkTruthR19Synthetic(),
    checkTailorOverlayGuard(),
    checkTailorDriftApply(),
    checkTailorHonestyOutput(),
    checkFitNonDegeneracy(),
    checkLlmEgress(repoRoot),
    checkGeneratedArtifactTrace(),
    checkScanLiveness(),
    checkScanDedup(),
    checkScanNeverSilent(repoRoot),
    checkDeterminismRatio(),
    checkCostBudget(),
    checkWebSafety(repoRoot),
    checkApiContract(repoRoot),
    checkEgressGuard(repoRoot),
    checkCredPaths(repoRoot),
    checkFuzzInput(),
    checkFfAts(),
    checkFfAisound(),
    checkWebUiBoundary(repoRoot),
    checkTemplateSchema(repoRoot),
    // ── Tier 2: Local-only (need SELFWRIGHT_DATA_DIR) ─────────────────────────
    checkTruthTraceProduction(dataDir),
    checkTruthDangling(dataDir),
    checkTruthIdentity(dataDir),
    checkTruthR19Production(dataDir),
    checkScoringVocabulary(dataDir),
  ];

  let passed = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of results) {
    console.log(fmt(r));
    if (r.skipped) {
      skipped++;
    } else if (r.passed) {
      passed++;
    } else {
      failed++;
      if (r.details) {
        for (const line of r.details.split("\n")) {
          console.error(`    ${line}`);
        }
      }
    }
  }

  // Resolve data dir for telemetry (best-effort — env var, then conventional sibling).
  const envDataDir = process.env["SELFWRIGHT_DATA_DIR"];
  let resolvedDataDir: string | null = null;
  if (envDataDir !== undefined && envDataDir.trim() !== "") {
    resolvedDataDir = envDataDir.trim();
  } else {
    const sibling = resolve(repoRoot, "..", "Selfwright-data");
    if (existsSync(sibling)) resolvedDataDir = sibling;
  }

  // Append history record (best-effort — never changes exit code or output).
  try {
    if (resolvedDataDir !== null) {
      const telemetryDir = resolve(resolvedDataDir, "telemetry");
      mkdirSync(telemetryDir, { recursive: true });
      const record = buildFitnessHistoryRecord(results, new Date().toISOString(), passed, skipped, failed);
      appendFileSync(resolve(telemetryDir, "fitness-history.jsonl"), JSON.stringify(record) + "\n", "utf-8");
    }
  } catch (err: unknown) {
    process.stderr.write(`[fitness] warn: could not write fitness-history.jsonl: ${String(err)}\n`);
  }

  console.log();

  const skipNote = skipped > 0
    ? ` · ${YELLOW}${skipped} skipped${RESET} (SELFWRIGHT_DATA_DIR not configured)`
    : "";

  if (failed === 0) {
    console.log(`${GREEN}${passed} passed${RESET}${skipNote} · 0 failed`);
  } else {
    console.error(`${GREEN}${passed} passed${RESET}${skipNote} · ${RED}${failed} failed${RESET}`);
    process.exit(1);
  }
}

main();
