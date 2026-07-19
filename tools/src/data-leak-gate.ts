import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── PII patterns (heuristic best-effort — not exhaustive; defence-in-depth layer) ─
// Conservative; a person's name has no syntactic signature a regex can match on its own,
// so confidential names are added separately via a maintained denylist — a local, gitignored
// `.confidential-names.local` file (one name per line; used locally, e.g. pre-commit/commit-msg)
// or the SELFWRIGHT_CONFIDENTIAL_NAMES env var (newline-separated; used in CI, where no local
// file exists in a fresh checkout). Neither source is ever committed — see loadConfidentialPatterns.
export const BASE_PII_PATTERNS: readonly RegExp[] = [
  // International phone number starting with +
  /\+\d{1,4}[\s.\-()]{0,2}\d{3,}[\d\s.\-()]{5,}/,
  // Salary / compensation with currency or keyword context
  /\b(?:salary|compensation|ctc|tc|ote|annual pay|base pay|total comp|total compensation)\b[\s:=]*[$€£¥]?\s*\d[\d,]+/i,
  // Email address
  /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/,
];

// ── Pure helpers ──────────────────────────────────────────────────────────────

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findDataPathViolations(stagedFiles: readonly string[]): string[] {
  return stagedFiles.filter((f) => {
    const lower = f.toLowerCase();
    return lower === "data" || lower.startsWith("data/");
  });
}

const EXCLUDED_TEST_EXTENSIONS = [".test.ts", ".spec.ts", ".test.js", ".spec.js", ".d.ts"];
const EXCLUDED_FILENAMES = new Set(["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]);
// Binary file extensions: PII regex patterns are text heuristics; binary content produces
// false positives when decoded as UTF-8. Binary files are never hand-authored source.
const EXCLUDED_BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico",
  ".pdf", ".zip", ".gz", ".tar",
  ".woff", ".woff2", ".ttf", ".eot",
]);

// Single source of truth for "should this tracked file be PII-scanned", shared by the
// pre-commit gate (staged files) and the CI-side fitness check (whole committed tree) so
// the two layers can never drift into scanning different sets of files.
export function isScannableFile(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower === "data" || lower.startsWith("data/")) return false;
  if (EXCLUDED_TEST_EXTENSIONS.some((ext) => path.endsWith(ext))) return false;
  // Use the basename so nested lock files (e.g. infra/evidence/package-lock.json) are also excluded.
  const basename = lower.includes("/") ? lower.slice(lower.lastIndexOf("/") + 1) : lower;
  const ext = basename.includes(".") ? basename.slice(basename.lastIndexOf(".")) : "";
  if (EXCLUDED_BINARY_EXTENSIONS.has(ext)) return false;
  return !EXCLUDED_FILENAMES.has(basename);
}

// Named-entity-scan variant (ADR 0017 §1): a real confidential name in a test fixture
// leaks exactly like one in source, so — unlike isScannableFile above — this does NOT
// exclude .test.ts/.spec.ts/.test.js/.spec.js. Still excludes data/ (gitignored, never
// legitimately staged) and generated lockfiles. .d.ts stays excluded: generated type
// declarations carry no hand-authored fixture data of their own.
export function isNamedEntityScannableFile(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower === "data" || lower.startsWith("data/")) return false;
  if (path.endsWith(".d.ts")) return false;
  // Use the basename so nested lock files (e.g. infra/evidence/package-lock.json) are also excluded.
  const basename = lower.includes("/") ? lower.slice(lower.lastIndexOf("/") + 1) : lower;
  return !EXCLUDED_FILENAMES.has(basename);
}

// Confidential-name denylist: a local, gitignored `.confidential-names.local` file
// (one name per line) for pre-commit use, or the SELFWRIGHT_CONFIDENTIAL_NAMES env var
// (newline-separated) for CI, where no local file exists in a fresh checkout. Never commit
// either source — seed both from the same reviewed list via `gh secret set`.
export function loadConfidentialPatterns(repoRoot: string): RegExp[] {
  const localFile = resolve(repoRoot, ".confidential-names.local");
  const raw = existsSync(localFile)
    ? readFileSync(localFile, "utf-8")
    : (process.env["SELFWRIGHT_CONFIDENTIAL_NAMES"] ?? "");

  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((name) => new RegExp(`\\b${escapeRegex(name)}\\b`, "i"));
}

// Chunk size and overlap for large-file PII scanning.
// Files are scanned in overlapping chunks so a match that spans a chunk boundary is not missed.
// OVERLAP_SIZE bytes of overlap are enough to cover any PII pattern in BASE_PII_PATTERNS.
const CHUNK_SIZE = 200_000;
const OVERLAP_SIZE = 256;

/**
 * Scan `content` for any pattern in `patterns`.
 * For content larger than CHUNK_SIZE the scan runs over overlapping chunks so
 * a match spanning a chunk boundary is not missed.
 * Returns true on the first match; false if the content is clean.
 */
export function scanContentForPii(content: string, patterns: readonly RegExp[]): boolean {
  if (patterns.length === 0) return false;
  if (content.length <= CHUNK_SIZE) {
    return patterns.some((p) => p.test(content));
  }
  // Large content: scan in overlapping chunks.
  for (let offset = 0; offset < content.length; offset += CHUNK_SIZE - OVERLAP_SIZE) {
    const chunk = content.slice(offset, offset + CHUNK_SIZE);
    if (patterns.some((p) => p.test(chunk))) return true;
  }
  return false;
}

// Deliberately does NOT return which pattern matched or any matched text — a confidential-name
// pattern's own source (e.g. `/\bSome Name\b/i`) contains the name in cleartext, and printing it
// anywhere (console, CI logs) would defeat the point of the denylist. The file path is enough to
// act on; whoever fixes it will see the actual match by opening that file.
export function findPiiViolationsInContent(
  fileContents: ReadonlyMap<string, string>,
  piiPatterns: readonly RegExp[],
): Array<{ file: string }> {
  if (piiPatterns.length === 0) return [];

  const violations: Array<{ file: string }> = [];

  for (const [file, content] of fileContents) {
    if (scanContentForPii(content, piiPatterns)) {
      violations.push({ file });
    }
  }

  return violations;
}

// ── IO helpers (not tested in unit tests — tested via integration / lefthook) ─
/* v8 ignore start */

function getStagedFiles(): string[] {
  const output = execSync("git diff --cached --name-only", { encoding: "utf-8" });
  return output.trim().split("\n").filter(Boolean);
}

function getStagedFileContents(frameworkFiles: readonly string[]): Map<string, string> {
  const contents = new Map<string, string>();
  for (const file of frameworkFiles) {
    try {
      const content = execSync(`git show ":${file}"`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      contents.set(file, content);
    } catch {
      // binary or unreadable — skip
    }
  }
  return contents;
}

type GitleaksResult = { ok: boolean; message: string; advisory: boolean };

// git rev-parse --show-toplevel returns the worktree root regardless of the calling
// directory, so gitleaks --staged and .confidential-names.local lookups always resolve
// to the right place even when pnpm runs this script from the tools/ package directory.
function getGitRoot(): string {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf-8" });
  if (r.error !== undefined || r.status !== 0) {
    throw new Error("[data-leak-gate] not in a git repository");
  }
  return r.stdout.trim();
}

function checkGitleaks(cwd: string): GitleaksResult {
  const probe = spawnSync("gitleaks", ["version"], { encoding: "utf-8", cwd });
  if (probe.error !== undefined) {
    // Not installed: advisory locally (CI installs it as a hard requirement)
    return {
      ok: false,
      advisory: true,
      message:
        "gitleaks not installed — secret scan skipped. Install: https://github.com/gitleaks/gitleaks#installing",
    };
  }

  const result = spawnSync("gitleaks", ["protect", "--staged", "--no-banner"], {
    stdio: "inherit",
    encoding: "utf-8",
    cwd,
  });

  return result.status === 0
    ? { ok: true, advisory: false, message: "gitleaks: clean" }
    : { ok: false, advisory: false, message: "gitleaks: secrets found in staged files" };
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

function main(): void {
  const repoRoot = getGitRoot();
  let failed = false;

  // 1. Staged file list
  let stagedFiles: string[];
  try {
    stagedFiles = getStagedFiles();
  } catch {
    console.error("[data-leak-gate] ERROR: could not read staged files (not in a git repo?)");
    process.exit(1);
  }

  if (stagedFiles.length === 0) {
    console.log("[data-leak-gate] No staged files — skipping.");
    process.exit(0);
  }

  // 2. Check (a): data/ path
  const dataViolations = findDataPathViolations(stagedFiles);
  if (dataViolations.length > 0) {
    console.error("\n[data-leak-gate] BLOCKED: staged file(s) under data/:");
    for (const f of dataViolations) {
      console.error(`  ✖ ${f}`);
    }
    console.error(
      "  → data/ is gitignored for a reason. Remove these files from staging.\n",
    );
    failed = true;
  }

  // 3. Check (b): gitleaks (hard block on secrets found; advisory if not installed locally)
  const gitleaksResult = checkGitleaks(repoRoot);
  if (!gitleaksResult.ok) {
    if (gitleaksResult.advisory) {
      console.warn(`[data-leak-gate] WARN: ${gitleaksResult.message}`);
    } else {
      console.error(`\n[data-leak-gate] BLOCKED: ${gitleaksResult.message}`);
      failed = true;
    }
  }

  // 4. Check (c): PII regex in framework files (skip test files — they use intentional test data;
  //    skip lockfiles — generated files may contain emails in deprecation notices)
  const frameworkFiles = stagedFiles.filter(isScannableFile);
  const allPatterns: RegExp[] = [
    ...BASE_PII_PATTERNS,
    ...loadConfidentialPatterns(repoRoot),
  ];

  const fileContents = getStagedFileContents(frameworkFiles);
  const piiViolations = findPiiViolationsInContent(fileContents, allPatterns);

  if (piiViolations.length > 0) {
    console.error("\n[data-leak-gate] BLOCKED: PII pattern found in framework file(s):");
    for (const v of piiViolations) {
      console.error(`  ✖ ${v.file}`);
    }
    console.error("  → Move private data to Selfwright-data; use IDs only in framework code.\n");
    failed = true;
  }

  if (!failed) {
    console.log("[data-leak-gate] ✓ Clean — no data leaks detected.");
  }

  process.exit(failed ? 1 : 0);
}

// Run only when executed as the entry-point script, not when imported as a module
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
/* v8 ignore stop */
