#!/usr/bin/env node
// Installs tools/git-hooks/{pre-commit,pre-push} into .git/hooks/.
// Runs automatically as part of `pnpm prepare` (after pnpm install).
// Skips silently if:
//   - not in a git repository
//   - lefthook is already managing the hook (its shim defers to our lefthook.yml)
//   - the hooks directory is not writable
//
// pre-push is installed alongside pre-commit (ADR 0017 §2) so the named-entity scan's
// "also a real .git/hooks twin" coverage does not depend on lefthook alone for either stage.
import { execSync } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, copyFile, readFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const LEFTHOOK_MARKER = "lefthook";
const HOOK_NAMES = ["pre-commit", "pre-push", "commit-msg"];

// ── Locate the git common dir (shared across worktrees) ────────────────────────
let gitCommonDir: string;
try {
  gitCommonDir = execSync("git rev-parse --git-common-dir", {
    cwd: repoRoot,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  // git returns a relative path; resolve against repo root
  gitCommonDir = resolve(repoRoot, gitCommonDir);
} catch {
  process.stdout.write("[setup-hooks] Not in a git repository — skipping.\n");
  process.exit(0);
}

const hooksDir = resolve(gitCommonDir, "hooks");

// ── Check if the hooks directory exists and is writable ───────────────────────
try {
  await access(hooksDir, constants.W_OK);
} catch {
  try {
    await mkdir(hooksDir, { recursive: true });
  } catch {
    process.stdout.write("[setup-hooks] Cannot access .git/hooks — skipping.\n");
    process.exit(0);
  }
}

for (const hookName of HOOK_NAMES) {
  const hookSource = resolve(repoRoot, "tools/git-hooks", hookName);
  const hookDest = resolve(hooksDir, hookName);

  // ── Skip if lefthook already owns this hook ───────────────────────────────
  try {
    const existing = await readFile(hookDest, "utf-8");
    if (existing.includes(LEFTHOOK_MARKER)) {
      process.stdout.write(
        `[setup-hooks] lefthook manages .git/hooks/${hookName} — skipping (lefthook runs the full suite).\n`,
      );
      continue;
    }
  } catch {
    // File does not exist yet — proceed to install.
  }

  // ── Install the hook ────────────────────────────────────────────────────
  await copyFile(hookSource, hookDest);
  try {
    await chmod(hookDest, 0o755);
  } catch {
    // Windows does not support chmod — acceptable; Git for Windows respects the shebang.
  }

  process.stdout.write(`[setup-hooks] Installed .git/hooks/${hookName} (tool-agnostic gate).\n`);
}
