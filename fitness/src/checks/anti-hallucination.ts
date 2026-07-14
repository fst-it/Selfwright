import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import type { CheckResult } from "./shared.js";

// Only match actual import/export statements, not strings inside code or comments.
// ^import/^export at line start (multiline mode) followed by 'from "<relative>"'
const IMPORT_EXPORT_RE =
  /^(?:import|export)\b[^'"]*from\s+['"](\.[^'"]+)['"]/gm;

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
      if (stat.isDirectory() && entry !== "node_modules" && entry !== "dist") {
        walkTs(full, files);
      } else if ((entry.endsWith(".ts") || entry.endsWith(".tsx")) && !entry.endsWith(".d.ts")) {
        files.push(full);
      }
    } catch {
      // skip
    }
  }
  return files;
}

function resolveImportToTs(importer: string, specifier: string): string {
  const base = join(dirname(importer), specifier);
  if (base.endsWith(".js")) {
    const tsxPath = base.slice(0, -3) + ".tsx";
    if (existsSync(tsxPath)) return tsxPath;
    return base.slice(0, -3) + ".ts";
  }
  if (existsSync(base + ".ts")) return base + ".ts";
  if (existsSync(base + ".tsx")) return base + ".tsx";
  return join(base, "index.ts");
}

const SOURCE_DIRS = ["packages", "apps", "tools/src", "fitness/src", "evals/src"];

export function checkAntiHallucination(repoRoot: string): CheckResult {
  const missing: string[] = [];

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

      IMPORT_EXPORT_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = IMPORT_EXPORT_RE.exec(content)) !== null) {
        const specifier = match[1];
        if (specifier === undefined || !specifier.startsWith(".")) continue;
        const resolved = resolveImportToTs(file, specifier);
        if (!existsSync(resolved)) {
          missing.push(
            `${relative(repoRoot, file)} imports '${specifier}' → ${relative(repoRoot, resolved)} not found`,
          );
        }
      }
    }
  }

  if (missing.length > 0) {
    return {
      name: "anti-hallucination: all relative imports resolve",
      passed: false,
      details: missing.join("\n"),
    };
  }

  return { name: "anti-hallucination: all relative imports resolve", passed: true };
}
