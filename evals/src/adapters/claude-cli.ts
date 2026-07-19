import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { LlmPort } from "@selfwright/core";
import { ClaudeCliAdapter } from "@selfwright/adapter-llm-claude-cli";
import { loadModelsConfig } from "@selfwright/shared-config";

// Resolved via git root rather than a CWD-relative path — `pnpm eval` (repo root) and
// `pnpm --filter @selfwright/evals run eval` (cwd: evals/) must both find config/models.yml.
function getGitRoot(): string {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf-8" });
  if (r.error !== undefined || r.status !== 0) {
    throw new Error("createClaudeBaseline: not in a git repository");
  }
  return r.stdout.trim();
}

export function createClaudeBaseline(): LlmPort {
  const modelsConfig = loadModelsConfig(join(getGitRoot(), "config/models.yml"));
  return new ClaudeCliAdapter(modelsConfig.roles, undefined, {
    defaultModel: modelsConfig.default,
  });
}
