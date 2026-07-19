import type { LlmPort } from "@selfwright/core";
import { CLASSIFICATION_FIXTURES } from "../golden/classification.js";
import { runPrompt } from "../harness.js";

const CLASSIFICATION_LABELS = ["requirement", "perk", "company_info", "other"] as const;

const CLASSIFICATION_SYSTEM_PROMPT =
  `Classify the given sentence from a job posting as exactly one of: ${CLASSIFICATION_LABELS.join(", ")}. ` +
  "Respond with ONLY the label — no prose, no punctuation.";

export const CLASSIFICATION_THRESHOLD = 0.85;

export function parseLabel(content: string): string {
  const cleaned = content
    .trim()
    .toLowerCase()
    .replace(/^[*_]+|[*_]+$/g, "") // strip leading/trailing markdown emphasis (* and _)
    .replace(/[."'`]/g, "")
    .trim();
  // Exact match (covers bare labels, "requirement.", "**requirement**", etc. after stripping)
  if ((CLASSIFICATION_LABELS as readonly string[]).includes(cleaned)) return cleaned;
  // Short-string whole-word match: handles light preamble like "The answer is: requirement"
  // Capped at 40 chars to avoid false-matching a label buried in a verbose non-conforming response.
  if (cleaned.length <= 40) {
    for (const label of CLASSIFICATION_LABELS) {
      if (new RegExp(`\\b${label}\\b`).test(cleaned)) return label;
    }
  }
  return cleaned;
}

export type ClassificationCheckResult = {
  readonly name: "classification";
  readonly pass: boolean;
  readonly threshold: number;
  readonly accuracy: number;
  readonly correct: number;
  readonly total: number;
};

export async function runClassificationCheck(ollama: LlmPort): Promise<ClassificationCheckResult> {
  let correct = 0;

  for (const fixture of CLASSIFICATION_FIXTURES) {
    const result = await runPrompt(
      ollama,
      "triage",
      CLASSIFICATION_SYSTEM_PROMPT,
      fixture.sentence,
    );
    if (parseLabel(result.content) === fixture.expectedLabel) correct += 1;
  }

  const total = CLASSIFICATION_FIXTURES.length;
  const accuracy = correct / total;

  return {
    name: "classification",
    pass: accuracy >= CLASSIFICATION_THRESHOLD,
    threshold: CLASSIFICATION_THRESHOLD,
    accuracy,
    correct,
    total,
  };
}
