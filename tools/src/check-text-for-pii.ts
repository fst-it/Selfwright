import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findPiiViolationsInContent, loadConfidentialPatterns } from "./data-leak-gate.js";
import { resolveDataDir } from "./hooks/named-entity-scan.js";
import {
  buildMachineIdentityPatterns,
  deriveMachineIdentity,
  findMachineIdentityViolations,
  getIdentifierEmbeddedTokenGroups,
  type MachineIdentityInputs,
} from "./hooks/machine-identity.js";

export type PiiTextCheckResult = { ok: boolean; message: string };

// Scans arbitrary text (a commit message, a PR title/body) for confidential-name denylist
// matches only — NOT the full BASE_PII_PATTERNS. Commit messages legitimately contain an
// email address in this project's own Co-Authored-By trailer, added to every commit, so the
// generic phone/salary/email regexes would false-positive on ordinary commits. The denylist
// (specific confidential names/values) carries no such risk.
//
// machineIdentity is optional and injected (pure/testable with synthetic values only, Phase 5
// T5.1) — the real values are derived once in main() below and passed in for the actual hook
// run; omitting it (the default) skips the machine-identity check, e.g. for callers that only
// care about the confidential-name denylist.
export function checkTextForPii(
  label: string,
  content: string,
  repoRoot: string,
  machineIdentity?: MachineIdentityInputs,
): PiiTextCheckResult {
  const patterns = loadConfidentialPatterns(repoRoot);
  const violations = findPiiViolationsInContent(new Map([[label, content]]), patterns);

  if (violations.length > 0) {
    return {
      ok: false,
      message: `[check-text-for-pii] BLOCKED: a confidential-name pattern matched in ${label}. Rewrite it without naming confidential contacts.`,
    };
  }

  if (machineIdentity !== undefined) {
    const machinePatterns = buildMachineIdentityPatterns(machineIdentity);
    const machineTokens = getIdentifierEmbeddedTokenGroups(machineIdentity);
    const machineViolations = findMachineIdentityViolations(
      new Map([[label, content]]),
      machinePatterns,
      machineTokens,
    );
    // Never allowlistable (see machine-identity.ts file header) — no allowlist consulted here.
    if (machineViolations.length > 0) {
      return {
        ok: false,
        message: `[check-text-for-pii] BLOCKED: a machine-identity pattern (username/hostname/personal email/local path) matched in ${label}. Rewrite it without machine-specific identifiers.`,
      };
    }
  }

  return { ok: true, message: `[check-text-for-pii] ✓ ${label}: clean.` };
}

// git rev-parse --show-toplevel returns the worktree root regardless of the calling
// directory, so file lookups always resolve to the right place even when pnpm runs
// this script from the tools/ package directory.
function getGitRoot(): string {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf-8" });
  if (r.error !== undefined || r.status !== 0) {
    throw new Error("[check-text-for-pii] not in a git repository");
  }
  return r.stdout.trim();
}

/* v8 ignore start */
function main(): void {
  const [, , filePath, label] = process.argv;
  if (filePath === undefined) {
    console.error("[check-text-for-pii] ERROR: usage: check-text-for-pii <file> [label]");
    process.exit(1);
  }

  const repoRoot = getGitRoot();
  const resolvedPath = resolve(repoRoot, filePath);
  const content = readFileSync(resolvedPath, "utf-8");

  // Best-effort, not fail-closed: unlike named-entity-scan's pre-commit/pre-push gate, a
  // missing data dir here only means the identity.yml contact-email source is unavailable —
  // the OS username/hostname and git config user.email are independent of it and still checked.
  const dataDirResolution = resolveDataDir(repoRoot);
  const machineIdentity = deriveMachineIdentity(dataDirResolution.ok ? dataDirResolution.dir : undefined);

  const result = checkTextForPii(label ?? filePath, content, repoRoot, machineIdentity);

  if (!result.ok) {
    console.error(`\n${result.message}\n`);
    process.exit(1);
  }
  console.log(result.message);
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
/* v8 ignore stop */
