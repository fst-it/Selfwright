// Pure, sync, zero-I/O helpers for the three fast hook checks.
// Tested in checks.test.ts; entry-point scripts are excluded from coverage.

import { relative } from "node:path";

// ── Path normalization ─────────────────────────────────────────────────────────

const ABSOLUTE_RE = /^[A-Za-z]:[/\\]|^\//;

/**
 * Convert the file_path from a Claude Code hook JSON (which is absolute) to a
 * forward-slash relative path suitable for pattern matching.
 * Callers supply `cwd` explicitly so the function stays testable without mocking
 * process.cwd(); entry-point scripts call it without the second argument (defaults
 * to process.cwd(), which is the repo root when hooks execute).
 */
export function normalizeHookPath(rawPath: string, cwd = process.cwd()): string {
  if (!rawPath) return rawPath;
  const rel = ABSOLUTE_RE.test(rawPath) ? relative(cwd, rawPath) : rawPath;
  return rel.replace(/\\/g, "/");
}

// B-1 fix: use (?:^|\/) prefix so that paths like "apps/dist/index.js" or
// "packages/tools/reports/out.txt" are also matched, not just top-level paths.
const GENERATED_PATH_PATTERNS: readonly RegExp[] = [
  /(?:^|\/)dist\//,
  /\/cv-tailored\.json$/,
  /^cv-tailored\.json$/,
  /\.pdf$/i,
  /\.docx$/i,
  /(?:^|\/)reports\//,
];

export function isGeneratedFilePath(path: string): boolean {
  return GENERATED_PATH_PATTERNS.some((p) => p.test(path));
}

// Patterns that indicate a bare claim in prose: years, percentages, dollar amounts, large numbers.
const BARE_CLAIM_PATTERNS: readonly RegExp[] = [
  /\b(19|20)\d{2}\b/,         // years 1900-2099
  /\b\d+(\.\d+)?\s*%/,        // percentages
  /\$\s*\d[\d,]*/,            // dollar amounts
  /\b\d{1,3}(,\d{3})+\b/,    // comma-grouped large numbers (e.g. 1,000,000)
];

const EVD_REF_ON_LINE = /\bEVD-[A-Z0-9-]+\b/;

export function truthTraceFast(content: string): string[] {
  const warnings: string[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (EVD_REF_ON_LINE.test(line)) continue; // EVD reference present — skip line
    for (const pattern of BARE_CLAIM_PATTERNS) {
      if (pattern.test(line)) {
        warnings.push(`line ${i + 1}: bare number/amount without EVD-* reference`);
        break;
      }
    }
  }
  return warnings;
}

const EVD_SCAN_PATTERN = /\bEVD-[A-Z0-9-]+\b/g;

export function danglingEvidenceFast(content: string, registryIds: Set<string>): string[] {
  const dangling = new Set<string>();
  for (const match of content.matchAll(EVD_SCAN_PATTERN)) {
    const id = match[0];
    if (!registryIds.has(id)) {
      dangling.add(id);
    }
  }
  return [...dangling].map((id) => `dangling evidence ID: ${id} not found in registry`);
}
