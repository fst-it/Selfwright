import { computeAts } from "../scoring/index.js";
import type { AtsInput, AtsResult } from "./types.js";

export function ats(input: AtsInput): AtsResult {
  return computeAts(
    input.jdText,
    input.cv,
    input.ontology,
    input.evidenceRegistry,
    input.opts,
  );
}
