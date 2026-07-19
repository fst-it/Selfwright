import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { EvidenceRegistrySchema } from "@selfwright/core/truth/schemas";
import type { CheckResult } from "./shared.js";

const CHECK_NAME = "FF-TRUTH-2: truth-dangling — no dangling EVD-* references";
const EVD_REF_RE = /EVD-[A-Za-z0-9-]+/gi;

function walkYaml(dir: string, files: string[] = []): string[] {
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
      if (stat.isDirectory()) {
        walkYaml(full, files);
      } else if (entry.endsWith(".yml") || entry.endsWith(".yaml")) {
        files.push(full);
      }
    } catch {
      // skip unreadable entries
    }
  }
  return files;
}

export function checkTruthDangling(dataDir: string): CheckResult {
  const registryPath = join(dataDir, "truth/evidence/registry.yml");
  if (!existsSync(registryPath)) {
    return {
      name: CHECK_NAME,
      passed: true,
      skipped: true,
      details: "SELFWRIGHT_DATA_DIR not configured — skipped (run locally with private data)",
    };
  }

  let registryIds: Set<string>;
  try {
    const raw = readFileSync(registryPath, "utf-8");
    const entries = EvidenceRegistrySchema.parse(parse(raw));
    registryIds = new Set(entries.map((e) => e.id));
  } catch (err) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `Failed to load evidence registry: ${String(err)}`,
    };
  }

  const yamlFiles = walkYaml(dataDir).filter((f) => f !== registryPath);
  const dangling: string[] = [];

  for (const filePath of yamlFiles) {
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const refs = content.match(EVD_REF_RE) ?? [];
    for (const ref of refs) {
      if (!registryIds.has(ref)) {
        const rel = filePath.replace(dataDir, "").replace(/\\/g, "/");
        dangling.push(`${rel}: ${ref}`);
      }
    }
  }

  if (dangling.length > 0) {
    const unique = [...new Set(dangling)];
    return {
      name: CHECK_NAME,
      passed: false,
      details: `Dangling EVD-* references (not in registry):\n${unique.join("\n")}`,
    };
  }
  return { name: CHECK_NAME, passed: true };
}
