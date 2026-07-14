// FF-CONTEXT-1 hardening tests — T5.6 adversarial review fixes
//
// Two independent concerns:
//
//  Fix 1 — depcruise fail-closed: when depcruise exits non-zero but stdout/stderr
//    contains zero FF-CONTEXT-1 lines (e.g. a tsconfig path error), the check must
//    return passed:false, not passed:true.  Tests mock the spawnSync result shape.
//
//  Fix 2 — ports/ laundering static scan: a port file that re-exports a named or
//    star export from a sibling context must fail the check.  Tests use real temp
//    directories — no mocking needed (the scan is a pure file read).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkContextBoundaries } from "./context-boundaries.js";

// All spawnSync calls in context-boundaries.ts go through this mock.
// The factory MUST NOT reference top-level variables (TDZ — vi.mock is hoisted).
vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, spawnSync: vi.fn() };
});

// ── helpers ───────────────────────────────────────────────────────────────────

function tmpRepoRoot(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${String(Date.now())}-${String(Math.random()).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makePortFile(repoRoot: string, name: string, content: string): void {
  const dir = join(repoRoot, "packages", "core", "src", "ports");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), content);
}

// ── Fix 1: depcruise fail-closed ──────────────────────────────────────────────

describe("checkContextBoundaries — depcruise fail-closed (Fix 1)", () => {
  beforeEach(() => {
    vi.mocked(spawnSync).mockReset();
  });

  it("FAILS when depcruise exits non-zero with zero FF-CONTEXT-1 lines (tsconfig crash)", () => {
    // Simulate a tsconfig path error: status=1, output with no "FF-CONTEXT-1"
    vi.mocked(spawnSync).mockReturnValueOnce({
      status: 1,
      stdout: "",
      stderr: "ERROR: error TS5083: Cannot read file 'tsconfig-nonexistent.json'.",
      pid: 0,
      output: [],
      signal: null,
    });

    const result = checkContextBoundaries("/fake/repo");

    expect(result.passed).toBe(false);
    expect(result.details).toMatch(/exited 1 with no FF-CONTEXT-1 lines/);
    expect(result.details).toMatch(/TS5083/);
  });

  it("FAILS and lists matching lines when depcruise exits non-zero WITH FF-CONTEXT-1 lines", () => {
    vi.mocked(spawnSync).mockReturnValueOnce({
      status: 1,
      stdout:
        "  error  packages/core/src/scanning/scan.ts → packages/core/src/truth/schemas.ts" +
        "  FF-CONTEXT-1-index-only-cross-context\n",
      stderr: "",
      pid: 0,
      output: [],
      signal: null,
    });

    const result = checkContextBoundaries("/fake/repo");

    expect(result.passed).toBe(false);
    expect(result.details).toMatch(/FF-CONTEXT-1/);
    // Must NOT be the "unrelated crash" message
    expect(result.details).not.toMatch(/exited.*with no FF-CONTEXT-1 lines/);
  });

  it("PASSES when depcruise exits 0 (no ports/ to scan)", () => {
    vi.mocked(spawnSync).mockReturnValueOnce({
      status: 0,
      stdout: "",
      stderr: "",
      pid: 0,
      output: [],
      signal: null,
    });

    const root = tmpRepoRoot("ctx-depcruise-zero");
    try {
      const result = checkContextBoundaries(root);
      expect(result.passed).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── Fix 2: ports/ laundering static scan ─────────────────────────────────────
//
// When a port violation is found the function returns before calling spawnSync,
// so no mock setup is needed for the FAIL cases.  For PASS cases we mock
// spawnSync to exit 0 so depcruise does not interfere.

describe("checkContextBoundaries — ports/ laundering static scan (Fix 2)", () => {
  let repoRoot: string;

  beforeEach(() => {
    vi.mocked(spawnSync).mockReset();
    // Default: depcruise exits 0 so it doesn't mask ports scan results
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: "",
      stderr: "",
      pid: 0,
      output: [],
      signal: null,
    });
  });

  afterEach(() => {
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  it("FAILS when a port file re-exports a named export from a sibling context", () => {
    repoRoot = tmpRepoRoot("ctx-ports-named-reexport");
    makePortFile(
      repoRoot,
      "leaky.ts",
      'import type { CoachingType } from "../coaching/types.js";\n' +
        'export type { CoachingType } from "../coaching/types.js";\n',
    );
    const result = checkContextBoundaries(repoRoot);
    expect(result.passed).toBe(false);
    expect(result.details).toMatch(/ports\/leaky\.ts/);
    expect(result.details).toMatch(/laundering/);
  });

  it("FAILS when a port file uses export * from a sibling context", () => {
    repoRoot = tmpRepoRoot("ctx-ports-star-reexport");
    makePortFile(repoRoot, "leaky.ts", 'export * from "../coaching/index.js";\n');
    const result = checkContextBoundaries(repoRoot);
    expect(result.passed).toBe(false);
    expect(result.details).toMatch(/laundering/);
  });

  it("PASSES when a port file only imports domain types (no re-export)", () => {
    repoRoot = tmpRepoRoot("ctx-ports-import-only");
    makePortFile(
      repoRoot,
      "llm.ts",
      'import type { CoachingType } from "../coaching/types.js";\n' +
        "export interface LlmPort { run(input: CoachingType): Promise<string>; }\n",
    );
    const result = checkContextBoundaries(repoRoot);
    expect(result.passed).toBe(true);
    expect(result.details ?? "").not.toMatch(/laundering/);
  });

  it("PASSES when a port file re-exports from ../ports/ itself (intra-ports is fine)", () => {
    repoRoot = tmpRepoRoot("ctx-ports-intra-ports");
    makePortFile(repoRoot, "combined.ts", 'export type { SomeType } from "../ports/other.js";\n');
    const result = checkContextBoundaries(repoRoot);
    expect(result.passed).toBe(true);
    expect(result.details ?? "").not.toMatch(/laundering/);
  });

  it("PASSES the real repo ports/ — no laundering in existing ports/*.ts", () => {
    // This test exercises the real ports/*.ts files in the repo.
    // spawnSync is mocked to exit 0 in beforeEach so it doesn't interfere.
    const realRepoRoot = join(import.meta.dirname, "..", "..", "..");
    const result = checkContextBoundaries(realRepoRoot);
    expect(result.details ?? "").not.toMatch(/laundering/);
  });
});
