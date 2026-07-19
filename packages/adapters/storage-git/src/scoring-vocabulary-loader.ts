import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_SCORING_VOCABULARY, ScoringVocabularySchema } from "@selfwright/core";
import type { ScoringVocabulary } from "@selfwright/core";
import { parseYaml } from "./yaml.js";

const REL_PATH = "positioning/scoring-vocabulary.yml";

/**
 * Best-effort loader for the data-layer scoring vocabulary (industry-tier
 * company names, Tier-0 anchors, commodity-trading keywords) — the owner's
 * real targeting data, externalized from the framework per ADR 0017 (the
 * derived named-entity gate blocks these as confidential company names in
 * framework source).
 *
 * Unlike TruthLoader's Result-returning methods, this never throws and never
 * propagates an error to the caller: a missing file is the expected default
 * state (framework installed without a data layer) and falls back silently;
 * a malformed file is unexpected but still falls back, with a stderr warning,
 * so scoring degrades gracefully rather than crashing (FF-INPUT posture).
 */
export async function loadScoringVocabularyFile(dataDir: string): Promise<ScoringVocabulary> {
  const absPath = join(dataDir, REL_PATH);
  let text: string;
  try {
    text = await readFile(absPath, "utf-8");
  } catch {
    return DEFAULT_SCORING_VOCABULARY;
  }

  try {
    const parsed = parseYaml(text);
    return ScoringVocabularySchema.parse(parsed);
  } catch (e) {
    process.stderr.write(
      `[scoring-vocabulary] warn: ${absPath} could not be parsed/validated (${
        e instanceof Error ? e.message : String(e)
      }) — falling back to the synthetic default vocabulary\n`,
    );
    return DEFAULT_SCORING_VOCABULARY;
  }
}
