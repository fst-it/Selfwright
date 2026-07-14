#!/usr/bin/env node
// PostToolUse fast verify — runs truth-trace, dangling-evidence, drift reminders.
// Advisory only — exit 0 always. Must complete in < 500 ms.
// Skipped silently when SELFWRIGHT_DATA_DIR is not set.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { normalizeHookPath, truthTraceFast, danglingEvidenceFast } from "./checks.js";
import type { EvidenceEntry, DriftEntry } from "@selfwright/core";

// ── File-scope constants ──────────────────────────────────────────────────────

const WATCHED_DIRS = ["src/", "packages/", "apps/", "tools/src/", "docs/"];
const WATCHED_EXTS = [".ts", ".md", ".yml", ".json"];
const CORE_APP_DIRS = ["packages/core/src/", "apps/"];

// ── Stdin parsing ─────────────────────────────────────────────────────────────

interface HookInput {
  tool_name?: string;
  tool_input?: { file_path?: string; path?: string; content?: string; new_string?: string };
}

let raw = "";
process.stdin.setEncoding("utf-8");
for await (const chunk of process.stdin) {
  raw += chunk as string;
}

let parsed: HookInput = {};
try {
  parsed = JSON.parse(raw) as HookInput;
} catch {
  process.exit(0);
}

const toolName = parsed.tool_name ?? "";
if (toolName !== "Edit" && toolName !== "Write") process.exit(0);

const filePath = normalizeHookPath(parsed.tool_input?.file_path ?? parsed.tool_input?.path ?? "");

const isWatched =
  WATCHED_DIRS.some((d) => filePath.startsWith(d)) &&
  WATCHED_EXTS.some((e) => filePath.endsWith(e));

if (!isWatched) process.exit(0);

// ── SELFWRIGHT_DATA_DIR guard ─────────────────────────────────────────────────

const dataDir = process.env["SELFWRIGHT_DATA_DIR"];
if (!dataDir) process.exit(0);

// ── Content to check ──────────────────────────────────────────────────────────

const content = parsed.tool_input?.content ?? parsed.tool_input?.new_string ?? "";
if (!content) process.exit(0);

// ── Run the three checks ──────────────────────────────────────────────────────

const warnings: string[] = [];

// 1. truth-trace-fast
const traceWarnings = truthTraceFast(content);
if (traceWarnings.length > 0) {
  warnings.push(`⚠ ADVISORY: truth-trace — ${traceWarnings[0]}`);
}

// 2. dangling-evidence-fast
let registryIds = new Set<string>();
try {
  const regPath = join(dataDir, "truth/evidence/registry.yml");
  const regText = await readFile(regPath, "utf-8");
  const entries = parse(regText) as EvidenceEntry[];
  if (Array.isArray(entries)) {
    registryIds = new Set(entries.map((e) => e.id));
  }
} catch {
  // skip check if registry is unreadable
}

if (registryIds.size > 0) {
  const danglingWarnings = danglingEvidenceFast(content, registryIds);
  if (danglingWarnings.length > 0) {
    warnings.push(`⚠ ADVISORY: dangling-evidence — ${danglingWarnings[0]}`);
  }
}

// 3. drift-fast — surface active drifts when touching core or apps
const touchesCore = CORE_APP_DIRS.some((d) => filePath.startsWith(d));
if (touchesCore) {
  try {
    const driftsDir = join(dataDir, "drifts/companies");
    const files = (await readdir(driftsDir)).filter((f) => f.endsWith(".yml"));
    const activeDrifts: string[] = [];
    for (const file of files) {
      const text = await readFile(join(driftsDir, file), "utf-8");
      const ledger = parse(text) as { drifts?: DriftEntry[] };
      if (Array.isArray(ledger.drifts)) {
        for (const d of ledger.drifts) {
          if (d.status === "active") activeDrifts.push(d.id);
        }
      }
    }
    if (activeDrifts.length > 0) {
      warnings.push(`⚠ ADVISORY: drift-fast — active drifts: ${activeDrifts.join(", ")}`);
    }
  } catch {
    // skip if drifts directory is unreadable
  }
}

if (warnings.length > 0) {
  process.stdout.write(warnings.slice(0, 3).join("\n") + "\n");
}

process.exit(0);
