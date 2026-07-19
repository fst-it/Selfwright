// FF-APICONTRACT: the typed /api/* JSON contract (T5.9) has a contract test
// suite, it exercises every documented endpoint, and it passes.
//
// Two layers, matching the fitness/src/checks pattern used elsewhere
// (core-no-provider-imports.ts spawns an external tool and checks its exit
// code; context-boundaries.ts does the same for depcruise):
//   1. Structural: the contract test file exists and contains a reference to
//      every endpoint path in the documented contract — catches a silently
//      dropped endpoint (one added to app.ts/api-contract but never
//      exercised) that a bare "did vitest exit 0" check would miss.
//   2. Behavioral: spawn vitest against exactly that file (no --coverage —
//      this is a pass/fail gate, not a coverage gate) and require exit 0.
//      Runs hermetically: apps/web's contract tests never touch the real
//      data dir (a fresh git-init'ed tmp dir per test, per the existing
//      actions.test.ts pattern).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckResult } from "./shared.js";

const CHECK_NAME = "FF-APICONTRACT: /api/* JSON contract tests (T5.9)";
const WEB_DIR = join("apps", "web");
const CONTRACT_TEST_REL = join("src", "__tests__", "api-contract.test.ts");

// Every endpoint documented in the T5.9 design (docs/MANUAL.md's internal
// /api/* contract section). Kept as a flat literal list, not derived from
// app.ts, so a route silently deleted from BOTH app.ts and this list at once
// would still need a deliberate, reviewable edit here.
const DOCUMENTED_ENDPOINTS = [
  "/api/meta",
  "/api/overview",
  "/api/inbox",
  // Covers both GET /api/applications and POST /api/applications/:id/status
  // (the test file's literal calls, e.g. "/api/applications/APP-001/status",
  // are a superstring of this path).
  "/api/applications",
  "/api/queue",
  // ADR 0024's two queue-triage write routes. "/api/queue" above already
  // gates their presence as a substring match, but these are kept explicit
  // and self-documenting per the ADR.
  "/promote",
  "/dismiss",
  "/api/coaching",
  "/api/debriefs",
  "/api/content",
  "/api/reporting",
  "/api/settings",
  "/api/scan-targets",
];

export function checkApiContract(repoRoot: string): CheckResult {
  const testFilePath = join(repoRoot, WEB_DIR, CONTRACT_TEST_REL);
  let testSrc: string;
  try {
    testSrc = readFileSync(testFilePath, "utf-8");
  } catch {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `${join(WEB_DIR, CONTRACT_TEST_REL)} not found — the /api/* JSON contract has no contract test suite`,
    };
  }

  const missingEndpoints = DOCUMENTED_ENDPOINTS.filter((path) => !testSrc.includes(path));
  if (missingEndpoints.length > 0) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `${join(WEB_DIR, CONTRACT_TEST_REL)} does not reference every documented endpoint. Missing: ${missingEndpoints.join(", ")}`,
    };
  }

  const isWindows = process.platform === "win32";
  const vitest = join(repoRoot, "node_modules", ".bin", isWindows ? "vitest.cmd" : "vitest");
  const vitestArgs = ["run", CONTRACT_TEST_REL];

  // Pass the full command as a single string to avoid DEP0190 (no args array with shell:true).
  const cmd = [`"${vitest}"`, ...vitestArgs].join(" ");
  const result = spawnSync(cmd, [], {
    cwd: join(repoRoot, WEB_DIR),
    encoding: "utf-8",
    shell: true,
  });

  if (result.error) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `vitest not found or failed to start: ${result.error.message}`,
    };
  }

  if (result.status !== 0) {
    const output = (result.stdout || result.stderr || "").trim();
    return {
      name: CHECK_NAME,
      passed: false,
      details: `contract test suite failed:\n${output.slice(-4000)}`,
    };
  }

  return { name: CHECK_NAME, passed: true };
}
