// FF-CRED (ADR 0017 §3): the credentials.json class. Known secret-bearing paths
// (web/credentials.json, **/*.key, **/*.pem, .env*) must be matched by .gitignore AND
// absent from `git ls-files` — .gitignore alone only stops an accidental `git add`, not a
// forced `git add -f`, so both layers are checked independently.
import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import type { CheckResult } from "./shared.js";

const CHECK_NAME = "FF-CRED: secret-bearing paths are gitignored and untracked";

// Representative sample paths for each secret-path class, probed against .gitignore via
// `git check-ignore` (real gitignore-pattern matching, not a hand-rolled reimplementation).
const SECRET_PATH_SAMPLES: readonly string[] = [
  "web/credentials.json",
  "some-secret.key",
  "nested/dir/another.pem",
  ".env",
  ".env.production",
];

const TRACKED_SECRET_PATTERNS: readonly RegExp[] = [
  /(^|\/)web\/credentials\.json$/,
  /\.key$/,
  /\.pem$/,
  /(^|\/)\.env(\..+)?$/,
];

function isIgnored(repoRoot: string, sample: string): boolean {
  const result = spawnSync("git", ["check-ignore", "-q", sample], { cwd: repoRoot });
  return result.status === 0;
}

export function checkCredPaths(repoRoot: string): CheckResult {
  const violations: string[] = [];

  for (const sample of SECRET_PATH_SAMPLES) {
    if (!isIgnored(repoRoot, sample)) {
      violations.push(`.gitignore does not match secret-path class for: ${sample}`);
    }
  }

  const tracked = spawnSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf-8" });
  const trackedFiles = tracked.stdout.trim().split("\n").filter(Boolean);
  for (const f of trackedFiles) {
    // .env.example is a deliberately committed template, negated in .gitignore (!.env.example)
    // at any depth — matched by basename, not just at the repo root.
    if (basename(f) === ".env.example") continue;
    if (TRACKED_SECRET_PATTERNS.some((re) => re.test(f))) {
      violations.push(`credential-shaped path is tracked in git (catches a forced 'git add -f'): ${f}`);
    }
  }

  if (violations.length > 0) {
    return { name: CHECK_NAME, passed: false, details: violations.join("\n") };
  }
  return { name: CHECK_NAME, passed: true };
}
