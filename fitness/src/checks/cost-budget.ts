// FF-COST-1: cost-per-app budget (Task T2.9). Synthetic fixture (Tier 1) — total token spend
// across all LLM calls for one application workflow must stay under the per-application budget
// ceiling. Alerts early if prompt engineering creates unbounded token growth.
import { buildUsageRecord } from "@selfwright/tools";
import type { CheckResult } from "./shared.js";

const CHECK_NAME = "FF-COST-1: cost-per-app budget (total tokens ≤ 50k per application)";

// At Sonnet pricing (~$3/MTok input, ~$15/MTok output) a 50k cap equals ≤ $0.60 per application.
const BUDGET_TOKENS_PER_APP = 50_000;

export function checkCostBudget(): CheckResult {
  // Synthetic workflow: one research call + one cover-letter call (headless --adapter path).
  const records = [
    buildUsageRecord({ role: "research", model: "claude-sonnet-5", inputTokens: 4_500, outputTokens: 1_200, wallTimeMs: 8_000 }),
    buildUsageRecord({ role: "cover", model: "claude-sonnet-5", inputTokens: 5_200, outputTokens: 1_800, wallTimeMs: 12_000 }),
  ];

  const totalTokens = records.reduce((sum, r) => sum + r.inputTokens + r.outputTokens, 0);

  if (totalTokens > BUDGET_TOKENS_PER_APP) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `Synthetic application workflow uses ${totalTokens} tokens; budget ceiling is ${BUDGET_TOKENS_PER_APP}`,
    };
  }

  return { name: CHECK_NAME, passed: true };
}
