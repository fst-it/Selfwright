import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { CheckResult } from "./shared.js";

const CHECK_NAME = "FF-WEB-UI-1: apps/web-ui must not import packages/core or packages/adapters";

export function checkWebUiBoundary(repoRoot: string): CheckResult {
  const isWindows = process.platform === "win32";
  const depcruise = join(
    repoRoot,
    "node_modules",
    ".bin",
    isWindows ? "depcruise.cmd" : "depcruise",
  );
  const depcruiseArgs = [
    "--config",
    ".dependency-cruiser.cjs",
    "--output-type",
    "err",
    "apps/web-ui/src",
  ];

  // Pass the full command as a single string to avoid DEP0190 (no args array with shell:true)
  const cmd = [`"${depcruise}"`, ...depcruiseArgs].join(" ");
  const result = spawnSync(cmd, [], { cwd: repoRoot, encoding: "utf-8", shell: true });

  if (result.error) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `dependency-cruiser not found or failed to start: ${result.error.message}\nInstall with: pnpm add -D -w dependency-cruiser`,
    };
  }

  if (result.status !== 0) {
    const output = (result.stdout || result.stderr).trim();
    // Filter to only FF-WEB-UI-1 violations so this check stays disjoint from FF-PORT-1
    const lines = output.split("\n").filter((l) => l.includes("FF-WEB-UI-1"));
    if (lines.length > 0) {
      return {
        name: CHECK_NAME,
        passed: false,
        details: lines.join("\n"),
      };
    }
    // Non-zero exit with no matching lines means an unrelated crash (e.g. bad tsconfig path).
    // Fail closed — do NOT silently pass on an unknown depcruise failure.
    const firstLines = output.split("\n").slice(0, 5).join("\n");
    return {
      name: CHECK_NAME,
      passed: false,
      details: `dependency-cruiser exited ${String(result.status)} with no FF-WEB-UI-1 lines (unrelated failure — check configuration):\n${firstLines}`,
    };
  }

  return { name: CHECK_NAME, passed: true };
}
