// FF-LLM-1: egress guard — apps/ must never instantiate an API-key-billed
// adapter, and any concrete LlmPort adapter it does instantiate must be
// behind an explicit --adapter opt-in, never the default composition path
// (D-1: co-piloted generation is the default; no gateway is instantiated
// unless the owner opts in). This is a structural string scan, not a
// control-flow/AST reachability analysis (docs/design/gateway-redesign-
// 2026-07-01.md, Task 6) — it checks for co-occurrence of an adapter
// constructor call and an --adapter gate marker in the same file, not that
// the gate actually dominates the call in the control-flow graph.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { CheckResult } from "./shared.js";

const CHECK_NAME = "FF-LLM-1: no default API-key/gateway adapter in apps/";

const API_KEY_PATTERN = /\b(ANTHROPIC_API_KEY|OPENAI_API_KEY)\b/;
const ADAPTER_CTOR_PATTERN = /\bnew\s+(LiteLlmAdapter|ClaudeCliAdapter|OllamaAdapter)\s*\(/;
const ADAPTER_GATE_PATTERN = /--adapter\b|opts\.adapter\b|\.adapter\s*[!=]==/;

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
      if (stat.isDirectory() && entry !== "node_modules" && entry !== "dist" && entry !== ".turbo") {
        walkTs(full, files);
      } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts") && !entry.endsWith(".test.ts")) {
        files.push(full);
      }
    } catch {
      // skip unreadable entries
    }
  }
  return files;
}

export function checkLlmEgress(repoRoot: string): CheckResult {
  const files = walkTs(join(repoRoot, "apps"));
  const violations: string[] = [];

  for (const file of files) {
    const relPath = relative(repoRoot, file);
    let text: string;
    try {
      text = readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    const apiKeyMatch = API_KEY_PATTERN.exec(text);
    if (apiKeyMatch) {
      violations.push(`${relPath}: references ${apiKeyMatch[1]} — no API-key adapter is permitted`);
    }

    if (ADAPTER_CTOR_PATTERN.test(text) && !ADAPTER_GATE_PATTERN.test(text)) {
      violations.push(
        `${relPath}: instantiates an LLM adapter with no --adapter opt-in gate found in the same file`,
      );
    }
  }

  if (violations.length > 0) {
    return { name: CHECK_NAME, passed: false, details: violations.join("\n") };
  }
  return { name: CHECK_NAME, passed: true };
}
