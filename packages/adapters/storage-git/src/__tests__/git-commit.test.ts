import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  chmodSync,
  readFileSync,
  mkdirSync,
  existsSync,
  utimesSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { commitDataDirFile } from "../git-commit.js";

const LOCK_FILE = ".selfwright-write.lock";

// Fast retry config used in contention tests to avoid long delays.
const FAST_RETRY = { maxAttempts: 2, minDelayMs: 1, maxDelayMs: 5 };

function runGit(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function makeGitDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-git-commit-"));
  runGit(["init", "-q"], dir);
  return dir;
}

function makeNonGitDir(): string {
  return mkdtempSync(join(tmpdir(), "sw-non-git-"));
}

function commitCount(dir: string): number {
  try {
    const out = execFileSync("git", ["log", "--oneline"], { cwd: dir, encoding: "utf-8", stdio: "pipe" });
    return out.trim().length === 0 ? 0 : out.trim().split("\n").length;
  } catch {
    return 0;
  }
}

describe("commitDataDirFile", () => {
  it("stages and commits a file, applying the built-in identity", async () => {
    const dir = makeGitDir();
    try {
      writeFileSync(join(dir, "hello.txt"), "hello\n");
      const result = await commitDataDirFile(dir, "hello.txt", "test: add hello");
      expect(result.ok).toBe(true);
      expect(commitCount(dir)).toBe(1);

      const author = execFileSync("git", ["log", "-1", "--format=%an <%ae>"], {
        cwd: dir,
        encoding: "utf-8",
      }).trim();
      expect(author).toBe("selfwright-web <selfwright-web@local>");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("succeeds without a global git identity configured (via -c overrides)", async () => {
    const dir = makeGitDir();
    try {
      writeFileSync(join(dir, "hello.txt"), "hello\n");
      const result = await commitDataDirFile(dir, "hello.txt", "test: no global identity");
      expect(result.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("on pre-commit hook rejection: returns kind:hook-rejection with hook stderr, and unstages the file", async () => {
    const dir = makeGitDir();
    try {
      const hooksDir = join(dir, ".git", "hooks");
      mkdirSync(hooksDir, { recursive: true });
      const hookPath = join(hooksDir, "pre-commit");
      writeFileSync(hookPath, "#!/bin/sh\necho 'blocked: test hook' 1>&2\nexit 1\n");
      chmodSync(hookPath, 0o755);

      writeFileSync(join(dir, "hello.txt"), "hello\n");
      const result = await commitDataDirFile(dir, "hello.txt", "test: should be blocked");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe("hook-rejection");
        expect(result.stderr).toContain("blocked: test hook");
      }
      expect(commitCount(dir)).toBe(0);

      // The file must be unstaged (reset), even though the working tree still
      // has the write — that revert is the caller's responsibility.
      const status = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf-8" });
      expect(status.trim()).toBe("?? hello.txt");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns kind:other when git add fails (path outside the repo)", async () => {
    const dir = makeGitDir();
    try {
      const result = await commitDataDirFile(dir, "../outside.txt", "test: should fail add");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.kind).toBe("other");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("committed content is readable back from the working tree", async () => {
    const dir = makeGitDir();
    try {
      writeFileSync(join(dir, "hello.txt"), "hello world\n");
      await commitDataDirFile(dir, "hello.txt", "test: content check");
      expect(readFileSync(join(dir, "hello.txt"), "utf-8")).toBe("hello world\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns kind:not-a-git-repo when dataDir is not a git repository", async () => {
    const dir = makeNonGitDir();
    try {
      writeFileSync(join(dir, "hello.txt"), "hello\n");
      const result = await commitDataDirFile(dir, "hello.txt", "test: not a repo", FAST_RETRY);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.kind).toBe("not-a-git-repo");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns kind:concurrent-write after retries when index.lock exists", async () => {
    const dir = makeGitDir();
    try {
      // Simulate another process holding the lock.
      const lockPath = join(dir, ".git", "index.lock");
      writeFileSync(lockPath, "");

      writeFileSync(join(dir, "hello.txt"), "hello\n");
      const result = await commitDataDirFile(dir, "hello.txt", "test: lock contention", FAST_RETRY);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.kind).toBe("concurrent-write");
      // No commit must have been created.
      expect(commitCount(dir)).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts an array of paths and stages+commits them together as one commit (ADR 0024 promote)", async () => {
    const dir = makeGitDir();
    try {
      writeFileSync(join(dir, "a.txt"), "a\n");
      writeFileSync(join(dir, "b.txt"), "b\n");
      const result = await commitDataDirFile(dir, ["a.txt", "b.txt"], "test: two files, one commit");
      expect(result.ok).toBe(true);
      expect(commitCount(dir)).toBe(1);

      const files = execFileSync("git", ["show", "--stat", "--format=", "HEAD"], {
        cwd: dir,
        encoding: "utf-8",
      });
      expect(files).toContain("a.txt");
      expect(files).toContain("b.txt");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("on hook rejection with multiple paths, unstages all of them", async () => {
    const dir = makeGitDir();
    try {
      const hooksDir = join(dir, ".git", "hooks");
      mkdirSync(hooksDir, { recursive: true });
      const hookPath = join(hooksDir, "pre-commit");
      writeFileSync(hookPath, "#!/bin/sh\necho 'blocked: test hook' 1>&2\nexit 1\n");
      chmodSync(hookPath, 0o755);

      writeFileSync(join(dir, "a.txt"), "a\n");
      writeFileSync(join(dir, "b.txt"), "b\n");
      const result = await commitDataDirFile(dir, ["a.txt", "b.txt"], "test: should be blocked");

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.kind).toBe("hook-rejection");
      expect(commitCount(dir)).toBe(0);

      const status = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf-8" });
      const lines = status.trim().split("\n").sort();
      expect(lines).toEqual(["?? a.txt", "?? b.txt"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("succeeds on retry when index.lock disappears between attempts", async () => {
    const dir = makeGitDir();
    try {
      const lockPath = join(dir, ".git", "index.lock");
      writeFileSync(lockPath, "");
      writeFileSync(join(dir, "hello.txt"), "hello\n");

      // Schedule lock removal after the first attempt will have been made.
      // The retry config uses minDelayMs=50 so the lock is removed before
      // the second attempt.
      setTimeout(() => {
        try { rmSync(lockPath); } catch { /* already gone */ }
      }, 20);

      const result = await commitDataDirFile(dir, "hello.txt", "test: lock clears", {
        maxAttempts: 3,
        minDelayMs: 50,
        maxDelayMs: 80,
      });
      expect(result.ok).toBe(true);
      expect(commitCount(dir)).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── Cross-process advisory lock (.selfwright-write.lock) ──────────────────
  // These prove the NEW lockfile mechanism specifically (not just git's own
  // index.lock retry, already covered above): a lockfile created outside this
  // process's call stack must still block commitDataDirFile until it is
  // released or reclaimed as stale.

  it("two concurrent commitDataDirFile calls to the same data dir serialize: both succeed, two commits, no leftover lockfile", async () => {
    const dir = makeGitDir();
    try {
      writeFileSync(join(dir, "a.txt"), "a\n");
      writeFileSync(join(dir, "b.txt"), "b\n");

      const [resultA, resultB] = await Promise.all([
        commitDataDirFile(dir, "a.txt", "test: concurrent a"),
        commitDataDirFile(dir, "b.txt", "test: concurrent b"),
      ]);

      expect(resultA.ok).toBe(true);
      expect(resultB.ok).toBe(true);
      expect(commitCount(dir)).toBe(2);
      // Both files must be present in the final tree — a clobbered/racing
      // write would leave one of them missing from HEAD.
      const tracked = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], {
        cwd: dir,
        encoding: "utf-8",
      });
      expect(tracked).toContain("a.txt");
      expect(tracked).toContain("b.txt");
      expect(existsSync(join(dir, LOCK_FILE))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("waits for an externally-held lockfile (simulating another process) and commits once it is released", async () => {
    const dir = makeGitDir();
    try {
      const lockPath = join(dir, LOCK_FILE);
      writeFileSync(lockPath, "9999 0"); // simulate another process holding the lock

      writeFileSync(join(dir, "hello.txt"), "hello\n");

      setTimeout(() => {
        try {
          rmSync(lockPath);
        } catch {
          /* already gone */
        }
      }, 100);

      const result = await commitDataDirFile(dir, "hello.txt", "test: waited for external lock");
      expect(result.ok).toBe(true);
      expect(commitCount(dir)).toBe(1);
      expect(existsSync(lockPath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reclaims a stale lockfile (mtime older than the staleness threshold) left behind by a crashed holder", async () => {
    const dir = makeGitDir();
    try {
      const lockPath = join(dir, LOCK_FILE);
      writeFileSync(lockPath, "1234 0");
      // Backdate the lock file well past the 30s staleness threshold so it is
      // reclaimed immediately rather than waited out.
      const old = new Date(Date.now() - 60_000);
      utimesSync(lockPath, old, old);

      writeFileSync(join(dir, "hello.txt"), "hello\n");
      const result = await commitDataDirFile(dir, "hello.txt", "test: stale lock reclaimed");
      expect(result.ok).toBe(true);
      expect(commitCount(dir)).toBe(1);
      expect(existsSync(lockPath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
