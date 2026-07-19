// Auto-commit primitive for the data dir's own git repository (ADR 0019).
// The data dir (SELFWRIGHT_DATA_DIR) is a separate git repository from the
// framework repo; every write action commits there so "the git history IS the
// audit log." Never shell-interpolate: args are always passed as an array to
// spawn(), never through a shell string.
import { spawn } from "node:child_process";
import { open, rm, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Discriminated error kinds for a failed commit:
 *   "concurrent-write"  — index.lock contention from another git process; retried
 *                         up to maxAttempts times before failing.
 *   "not-a-git-repo"    — dataDir is not a git repository.
 *   "hook-rejection"    — a pre-commit hook exited non-zero; hook stderr is
 *                         surfaced so callers can display the rejection reason.
 *   "other"             — any other failure (pathspec outside repo, etc.).
 */
export type GitCommitErrorKind = "concurrent-write" | "not-a-git-repo" | "hook-rejection" | "other";

export type GitCommitResult =
  | { ok: true }
  | { ok: false; kind: GitCommitErrorKind; stderr: string };

// Applied to every commit so it succeeds regardless of whether the data repo
// has a global git identity configured (documented in ADR 0019).
const GIT_IDENTITY_ARGS = [
  "-c",
  "user.name=selfwright-web",
  "-c",
  "user.email=selfwright-web@local",
];

function runGit(args: string[], cwd: string): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", (err) => {
      resolve({ code: 1, stderr: err.message });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stderr });
    });
  });
}

function isLockContention(stderr: string): boolean {
  return stderr.includes("index.lock") || stderr.includes("Another git process");
}

function isNotAGitRepo(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return (
    lower.includes("not a git repository") ||
    lower.includes("does not appear to be a git repository")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Cross-process advisory lock ─────────────────────────────────────────────
// withWriteLock (apps/web/src/write-lock.ts) only serializes writers within
// one Node process. The data dir is also written by the CLI and by skills
// shelling out independently, each its own process, so an in-process queue
// alone does not prevent two processes racing the same `git commit` (and,
// worse, one process's fail-closed revert stomping the other's already-
// committed working-tree write). This lock closes that gap for every caller
// of commitDataDirFile (web + CLI + skills all funnel through here).
const LOCK_FILE_NAME = ".selfwright-write.lock";
// A lock file older than this is assumed to belong to a crashed/killed holder
// (a live holder always finishes a commit well under this) and is reclaimed.
const LOCK_STALE_MS = 30_000;
const LOCK_ACQUIRE_TIMEOUT_MS = 10_000;
const LOCK_RETRY_MIN_MS = 20;
const LOCK_RETRY_MAX_MS = 80;

/**
 * Acquire the cross-process lockfile in dataDir via O_EXCL create ("wx" —
 * fails with EEXIST if the file already exists), bounded-retried with
 * jitter, reclaiming a stale lock left behind by a crashed holder. Returns a
 * release function on success, or null if the lock could not be acquired
 * within the timeout (caller should treat this like lock contention).
 */
async function acquireCrossProcessLock(dataDir: string): Promise<(() => Promise<void>) | null> {
  const lockPath = join(dataDir, LOCK_FILE_NAME);
  const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;

  for (;;) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(`${process.pid} ${Date.now()}`, "utf-8");
      } finally {
        await handle.close();
      }
      return () => rm(lockPath, { force: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        // Can't create a lockfile at all (e.g. dataDir missing/unwritable) —
        // degrade to the in-process lock only rather than blocking forever.
        return () => Promise.resolve();
      }

      // Stale-lock reclaim: remove and retry immediately.
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
          await rm(lockPath, { force: true });
          continue;
        }
      } catch {
        // Lock vanished between the failed open and this stat — retry now.
        continue;
      }

      if (Date.now() >= deadline) return null;
      const jitter = LOCK_RETRY_MIN_MS + Math.floor(Math.random() * (LOCK_RETRY_MAX_MS - LOCK_RETRY_MIN_MS));
      await sleep(jitter);
    }
  }
}

/** Optional retry tuning — useful for tests that need fast failure cycles. */
export interface CommitRetryConfig {
  maxAttempts?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULT_RETRY: Required<CommitRetryConfig> = {
  maxAttempts: 5,
  minDelayMs: 100,
  maxDelayMs: 300,
};

/**
 * Stage and commit one or more files within the data dir's own git
 * repository. A single path stages/commits exactly as before (T5.9 and
 * earlier callers are unaffected); an array stages every path in one `git
 * add` and commits them together as a single atomic commit — needed by
 * ADR 0024's promote write, which must move a queue entry into
 * applications.yml (two files) in one auditable commit rather than two.
 *
 * Error classes (discriminated by `kind` on the returned failure):
 *   "concurrent-write"  — index.lock contention; retried with jitter before
 *                         surfacing this class. Callers should return 409 and
 *                         ask the user to try again.
 *   "not-a-git-repo"    — dataDir is not initialised as a git repository.
 *                         Callers should return 500 — this is a mis-configuration.
 *   "hook-rejection"    — the pre-commit hook rejected the commit; hook stderr
 *                         is carried in `stderr` so callers can surface it.
 *                         Callers should return 422.
 *   "other"             — any other git failure (pathspec outside repo, etc.).
 *                         Callers should return 500.
 *
 * On commit failure every staged file is unstaged again (`git reset`) so the
 * index matches HEAD — the caller is responsible for restoring the
 * working-tree file content itself (it holds the pre-write original),
 * matching ADR 0019's "revert the file(s) to HEAD" requirement.
 */
export async function commitDataDirFile(
  dataDir: string,
  relFilePath: string | readonly string[],
  message: string,
  retryConfig?: CommitRetryConfig,
): Promise<GitCommitResult> {
  const maxAttempts = retryConfig?.maxAttempts ?? DEFAULT_RETRY.maxAttempts;
  const minDelay = retryConfig?.minDelayMs ?? DEFAULT_RETRY.minDelayMs;
  const maxDelay = retryConfig?.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs;
  const relFilePaths = typeof relFilePath === "string" ? [relFilePath] : [...relFilePath];

  const release = await acquireCrossProcessLock(dataDir);
  if (release === null) {
    return {
      ok: false,
      kind: "concurrent-write",
      stderr: `cross-process write lock held by another process after ${LOCK_ACQUIRE_TIMEOUT_MS}ms: concurrent write in progress, try again`,
    };
  }

  try {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        const jitter = minDelay + Math.floor(Math.random() * (maxDelay - minDelay + 1));
        await sleep(jitter);
      }

      const add = await runGit(["add", ...relFilePaths], dataDir);
      if (add.code !== 0) {
        if (isLockContention(add.stderr)) continue;
        if (isNotAGitRepo(add.stderr)) {
          return { ok: false, kind: "not-a-git-repo", stderr: add.stderr || "not a git repository" };
        }
        return { ok: false, kind: "other", stderr: add.stderr || "git add failed" };
      }

      const commit = await runGit([...GIT_IDENTITY_ARGS, "commit", "-m", message], dataDir);
      if (commit.code !== 0) {
        // Unstage before retrying or returning — always matches ADR 0019 revert
        // requirement, and leaves a clean slate for the next retry's git add.
        await runGit(["reset", "--", ...relFilePaths], dataDir);
        if (isLockContention(commit.stderr)) continue;
        if (isNotAGitRepo(commit.stderr)) {
          return { ok: false, kind: "not-a-git-repo", stderr: commit.stderr };
        }
        // If add succeeded we are inside a git repo; commit failure without a
        // lock is treated as a hook rejection (the dominant non-lock failure mode).
        return { ok: false, kind: "hook-rejection", stderr: commit.stderr || "git commit failed" };
      }

      return { ok: true };
    }

    return {
      ok: false,
      kind: "concurrent-write",
      stderr: `index.lock contention after ${maxAttempts} attempts: concurrent write in progress, try again`,
    };
  } finally {
    await release();
  }
}
