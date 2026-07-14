#!/usr/bin/env node
// Conventional-commit lint — called by lefthook's commit-msg hook (lefthook.yml)
// or by the tool-agnostic tools/git-hooks/commit-msg twin when lefthook is absent.
//
// Receives the commit-message file path as its first CLI argument (git's commit-msg
// hook convention: git passes the path to the file containing the commit message).
//
// Rejects commit messages whose first non-blank non-comment line does not match the
// conventional-commit spec. Auto-generated git merge messages ("Merge ...") are
// allowed. Exits 0 on pass, 1 on failure (stderr only — never stdout, which git uses
// for commit-message suggestions in some environments).
//
// Pure logic is exported from `lintCommitMessage` for unit testing (checks.test.ts /
// commit-msg-lint.test.ts) — the entry-point I/O below is excluded from coverage.
//
// Conventional-commit regex (per brief item 3):
//   ^(feat|fix|docs|chore|refactor|test|perf|build|ci|style|revert)
//   (\([a-z0-9,/-]+\))?!?: .+
import { readFileSync } from "node:fs";

// ── Pure lint logic (exported for tests) ─────────────────────────────────────

const CC_TYPES = [
  "feat",
  "fix",
  "docs",
  "chore",
  "refactor",
  "test",
  "perf",
  "build",
  "ci",
  "style",
  "revert",
] as const;

const CC_RE = new RegExp(
  `^(${CC_TYPES.join("|")})(\\([a-z0-9,\\-/]+\\))?!?: .+`,
);

export type LintResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Lint a raw commit message string.
 *
 * Rules:
 * 1. Strip lines starting with "#" (git comment lines) and blank lines to find
 *    the subject (first non-empty, non-comment line).
 * 2. If no subject is found, reject as empty.
 * 3. Allow any message whose subject starts with "Merge " (git auto-generated
 *    merge messages: "Merge branch '...'", "Merge pull request #N ...").
 * 4. Otherwise the subject must match the conventional-commit pattern.
 */
export function lintCommitMessage(msg: string): LintResult {
  const lines = msg.split("\n");
  const subject = lines.find((l) => l.trim().length > 0 && !l.startsWith("#"));

  if (subject === undefined) {
    return { ok: false, reason: "Commit message is empty" };
  }

  // Allow git's auto-generated merge commit messages.
  if (subject.startsWith("Merge ")) {
    return { ok: true };
  }

  if (CC_RE.test(subject)) {
    return { ok: true };
  }

  return {
    ok: false,
    reason:
      `Subject must match conventional-commit form:\n` +
      `  type(scope)?: description\n` +
      `  Got: ${subject}\n` +
      `  Allowed types: ${CC_TYPES.join("|")}`,
  };
}

// ── Entry point (I/O; excluded from coverage) ────────────────────────────────
/* v8 ignore start */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function isMainModule(): boolean {
  const invoked = process.argv[1];
  if (invoked === undefined) return false;
  return fileURLToPath(import.meta.url) === resolve(invoked);
}

// Resolve the commit-message file path against the git repo root so the script
// works correctly when pnpm runs it from the tools/ package directory (where a
// relative ".git/COMMIT_EDITMSG" would not resolve).  Matches the pattern in
// check-text-for-pii.ts.
function getGitRoot(): string {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf-8" });
  if (r.error !== undefined || r.status !== 0) {
    throw new Error("[commit-msg-lint] not in a git repository");
  }
  return r.stdout.trim();
}

if (isMainModule()) {
  const msgFile = process.argv[2];
  if (!msgFile) {
    process.stderr.write("[commit-msg-lint] No commit message file supplied.\n");
    process.exit(1);
  }

  let raw: string;
  try {
    const resolvedPath = resolve(getGitRoot(), msgFile);
    raw = readFileSync(resolvedPath, "utf-8");
  } catch {
    process.stderr.write(`[commit-msg-lint] Cannot read ${msgFile}.\n`);
    process.exit(1);
  }

  const result = lintCommitMessage(raw);
  if (!result.ok) {
    process.stderr.write(`✖ COMMIT REJECTED — ${result.reason}\n`);
    process.stderr.write(`  Examples: feat(core): add scoring vocabulary  /  fix: null deref in scan\n`);
    process.exit(1);
  }
  process.exit(0);
}

/* v8 ignore stop */
