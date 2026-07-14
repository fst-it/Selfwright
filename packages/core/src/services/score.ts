import { scoreJd } from "../scoring/index.js";
import type { ScoreInput, JdScoreResult } from "./types.js";

export function score(input: ScoreInput): JdScoreResult {
  return scoreJd({
    jdText: input.jdText,
    archetypes: input.archetypes,
    ontology: input.ontology,
    registry: input.registry,
    ...(input.vocabulary !== undefined ? { vocabulary: input.vocabulary } : {}),
  });
}
