import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BASE_PII_PATTERNS,
  findPiiViolationsInContent,
  isScannableFile,
  loadConfidentialPatterns,
} from "@selfwright/tools";
import type { CheckResult } from "./shared.js";

const CHECK_NAME = "data-leak: no committed data, secrets, or PII in source";

export function checkDataLeak(repoRoot: string): CheckResult {
  // (a) Check if data/ dir has committed files (should be empty — gitignored)
  // Get ALL tracked files and filter case-insensitively for data/ paths (M2 fix)
  const allTracked = spawnSync(
    "git",
    ["ls-files"],
    { cwd: repoRoot, encoding: "utf-8" },
  );
  const committedData = allTracked.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter((f) => {
      const lower = f.toLowerCase();
      return lower === "data" || lower.startsWith("data/");
    });

  if (committedData.length > 0) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `Committed files in data/:\n${committedData.join("\n")}`,
    };
  }

  // (b) Gitleaks on the full repo (if installed)
  const probe = spawnSync("gitleaks", ["version"], { encoding: "utf-8" });
  if (probe.error === undefined) {
    const leak = spawnSync("gitleaks", ["detect", "--no-banner"], {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (leak.status !== 0) {
      return {
        name: CHECK_NAME,
        passed: false,
        details: "gitleaks detected secrets in the repository",
      };
    }
  }

  // (c) PII regex scan on the whole committed tree (C1: catches pre-commit bypass).
  // Whole-repo, not a hardcoded subset — docs/, .claude/, .claude-plugin/, and root files
  // are in scope too, sharing the exact same exclusion rule as the pre-commit gate.
  const sourceFiles = spawnSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf-8" });
  const filesToScan = sourceFiles.stdout.trim().split("\n").filter(Boolean).filter(isScannableFile);

  const fileContents = new Map<string, string>();
  for (const relPath of filesToScan) {
    try {
      const fullPath = join(repoRoot, relPath);
      const content = readFileSync(fullPath, "utf-8");
      fileContents.set(relPath, content);
    } catch {
      // binary or unreadable — skip
    }
  }

  const allPatterns = [...BASE_PII_PATTERNS, ...loadConfidentialPatterns(repoRoot)];
  const piiViolations = findPiiViolationsInContent(fileContents, allPatterns);
  if (piiViolations.length > 0) {
    // Never print which pattern matched — a confidential-name pattern's own source contains
    // the name in cleartext, and this runs in CI where logs are retained.
    const lines = piiViolations.map((v) => `  ${v.file}`).join("\n");
    return {
      name: CHECK_NAME,
      passed: false,
      details: `PII pattern found in source file(s):\n${lines}`,
    };
  }

  return { name: CHECK_NAME, passed: true };
}
