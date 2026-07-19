import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { CheckResult } from "./shared.js";

const CHECK_NAME = "FF-CONTEXT-1: cross-context imports go through context index";

// Matches re-export-from-context statements in ports/*.ts:
//   export { Foo } from "../coaching/..."  (any target that isn't ../ports/)
//   export type { Foo } from "../scanning/..."
//   export * from "../truth/..."
// Direct `import` of domain types for declaring the port's own contract is legal.
const RE_EXPORT_CONTEXT_NAMED = /export\s+(?:type\s+)?\{[^}]*\}\s+from\s+["']\.\.\//;
const RE_EXPORT_CONTEXT_STAR = /export\s+\*\s+from\s+["']\.\.\//;
// Allowlist: re-exports from ../ports/ itself are fine
const RE_FROM_PORTS = /from\s+["']\.\.\/ports\//;

function checkPortsLeakyReexports(repoRoot: string): CheckResult | null {
  const portsDir = join(repoRoot, "packages", "core", "src", "ports");
  let files: string[];
  try {
    files = readdirSync(portsDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  } catch {
    // ports/ doesn't exist — nothing to check
    return null;
  }

  const violations: string[] = [];
  for (const file of files) {
    const filePath = join(portsDir, file);
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    lines.forEach((line, i) => {
      const isReexport =
        (RE_EXPORT_CONTEXT_NAMED.test(line) || RE_EXPORT_CONTEXT_STAR.test(line)) &&
        !RE_FROM_PORTS.test(line);
      if (isReexport) {
        violations.push(`ports/${file}:${i + 1}: ${line.trim()}`);
      }
    });
  }

  if (violations.length > 0) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `ports/ laundering: re-export of context internals detected (ports may import domain types for contract declaration, but must not re-export them):\n${violations.join("\n")}`,
    };
  }
  return null;
}

export function checkContextBoundaries(repoRoot: string): CheckResult {
  // ── Assertion 2: ports/ must not re-export context internals ────────────────
  const portsViolation = checkPortsLeakyReexports(repoRoot);
  if (portsViolation !== null) {
    return portsViolation;
  }

  // ── Assertion 1: depcruise cross-context index-only rule ────────────────────
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
    "packages/core/src",
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
    // Filter to only FF-CONTEXT-1 violations so this check stays disjoint from FF-PORT-1
    const lines = output.split("\n").filter((l) => l.includes("FF-CONTEXT-1"));
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
      details: `dependency-cruiser exited ${String(result.status)} with no FF-CONTEXT-1 lines (unrelated failure — check configuration):\n${firstLines}`,
    };
  }

  return { name: CHECK_NAME, passed: true };
}
