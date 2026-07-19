import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { CheckResult } from "./shared.js";

const LAZY_RE = new RegExp(
  [
    String.raw`\bTODO\b`,
    String.raw`\bFIXME\b`,
    String.raw`\bNotImplemented\b`,
    String.raw`\/\/ unchanged`,
    String.raw`\/\/ placeholder`,
    String.raw`\.skip\s*\(`,
  ].join("|"),
  "i",
);

const LAZY_LABEL_RE = new RegExp(
  [
    String.raw`\bTODO\b`,
    String.raw`\bFIXME\b`,
    String.raw`\bNotImplemented\b`,
  ].join("|"),
  "i",
);

const SOURCE_DIRS = ["packages", "apps", "tools/src", "evals/src"];

function walkTs(dir: string, files: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    try {
      const stat = statSync(full);
      if (
        stat.isDirectory() &&
        entry !== "node_modules" &&
        entry !== "dist" &&
        entry !== ".turbo"
      ) {
        walkTs(full, files);
      } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
        files.push(full);
      }
    } catch {
      // skip unreadable entries
    }
  }
  return files;
}

function describeMatch(line: string): string {
  if (/\.skip\s*\(/.test(line)) return ".skip(";
  if (/\/\/ placeholder/i.test(line)) return "// placeholder";
  if (/\/\/ unchanged/.test(line)) return "// unchanged";
  if (/\bNotImplemented\b/.test(line)) return "NotImplemented";
  if (/\bFIXME\b/.test(line)) return "FIXME";
  if (/\bTODO\b/.test(line)) return "TODO";
  return "lazy-marker";
}

export function checkAntiLaziness(repoRoot: string): CheckResult {
  const violations: string[] = [];

  for (const dir of SOURCE_DIRS) {
    const absDir = join(repoRoot, dir);
    const files = walkTs(absDir);

    for (const file of files) {
      let content: string;
      try {
        content = readFileSync(file, "utf-8");
      } catch {
        continue;
      }

      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (!LAZY_RE.test(line)) continue;

        // Skip lines where the word appears only inside a string/regex literal
        // (heuristic: line is a regex pattern definition or the label-only form)
        if (/^.*(?:re\s*:.*\/|label\s*:)/.test(line) && LAZY_LABEL_RE.test(line)) continue;

        violations.push(`${relative(repoRoot, file)}:${i + 1} — ${describeMatch(line)}`);
      }
    }
  }

  if (violations.length > 0) {
    return {
      name: "anti-laziness: no lazy-markers in source",
      passed: false,
      details: violations.join("\n"),
    };
  }

  return { name: "anti-laziness: no lazy-markers in source", passed: true };
}
