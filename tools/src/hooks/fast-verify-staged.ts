#!/usr/bin/env node
// Lefthook pre-commit variant of fast-verify: runs truth-trace and dangling-evidence
// checks on each staged file passed as CLI arguments. Advisory only; exit 0 always.
import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { truthTraceFast, danglingEvidenceFast } from "./checks.js";
import type { EvidenceEntry } from "@selfwright/core";

const files = process.argv.slice(2).filter(Boolean);
if (files.length === 0) process.exit(0);

const dataDir = process.env["SELFWRIGHT_DATA_DIR"];

let registryIds = new Set<string>();
if (dataDir) {
  try {
    const regPath = join(dataDir, "truth/evidence/registry.yml");
    const regText = await readFile(regPath, "utf-8");
    const entries = parse(regText) as EvidenceEntry[];
    if (Array.isArray(entries)) {
      registryIds = new Set(entries.map((e) => e.id));
    }
  } catch {
    // no registry available — skip dangling check
  }
}

const warnings: string[] = [];

for (const file of files) {
  let content: string;
  try {
    content = execSync(`git show ":${file}"`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    continue;
  }

  const traceW = truthTraceFast(content);
  if (traceW.length > 0) {
    warnings.push(`⚠ ADVISORY [${file}]: truth-trace — ${traceW[0]}`);
  }

  if (registryIds.size > 0) {
    const danglingW = danglingEvidenceFast(content, registryIds);
    if (danglingW.length > 0) {
      warnings.push(`⚠ ADVISORY [${file}]: dangling-evidence — ${danglingW[0]}`);
    }
  }
}

if (warnings.length > 0) {
  process.stdout.write(warnings.join("\n") + "\n");
}
process.exit(0);
