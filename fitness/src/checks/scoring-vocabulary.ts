import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { DEFAULT_SCORING_VOCABULARY, ScoringVocabularySchema } from "@selfwright/core";
import type { CheckResult } from "./shared.js";

const CHECK_NAME = "FF-VOCAB-1: scoring-vocabulary — real vocabulary loaded when data dir is set";
const REL_PATH = "positioning/scoring-vocabulary.yml";

export function checkScoringVocabulary(dataDir: string): CheckResult {
  const vocabPath = join(dataDir, REL_PATH);

  if (!dataDir || !existsSync(vocabPath)) {
    return {
      name: CHECK_NAME,
      passed: true,
      skipped: true,
      details: "SELFWRIGHT_DATA_DIR not configured — skipped (run locally with private data)",
    };
  }

  let vocabulary;
  try {
    const text = readFileSync(vocabPath, "utf-8");
    const parsed: unknown = parse(text);
    vocabulary = ScoringVocabularySchema.parse(parsed);
  } catch (err) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `${REL_PATH} could not be parsed/validated: ${String(err)}`,
    };
  }

  if (JSON.stringify(vocabulary) === JSON.stringify(DEFAULT_SCORING_VOCABULARY)) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: "real data dir present but synthetic vocabulary loaded — check positioning/scoring-vocabulary.yml",
    };
  }

  return { name: CHECK_NAME, passed: true };
}
