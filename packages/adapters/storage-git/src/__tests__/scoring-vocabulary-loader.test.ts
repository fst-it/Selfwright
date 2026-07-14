import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SCORING_VOCABULARY } from "@selfwright/core";
import { loadScoringVocabularyFile } from "../scoring-vocabulary-loader.js";

const FIXTURES_DIR = join(fileURLToPath(import.meta.url), "../fixtures");
const FIXTURES_EDGE_DIR = join(fileURLToPath(import.meta.url), "../fixtures-edge");

describe("loadScoringVocabularyFile", () => {
  it("loads and validates a real vocabulary file", async () => {
    const result = await loadScoringVocabularyFile(FIXTURES_DIR);
    expect(result.anchors).toEqual(["fixture anchor co"]);
    expect(result.industryTiers).toEqual([
      { bucket: "trading", points: 5, keywords: ["fixture trading co"] },
    ]);
    expect(result.commodityKeywords).toEqual(["fixture commodity co"]);
  });

  it("falls back to the synthetic default when the file is missing — no stderr warning", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const result = await loadScoringVocabularyFile("/nonexistent/data/dir");
    expect(result).toEqual(DEFAULT_SCORING_VOCABULARY);
    expect(stderrSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it("falls back to the synthetic default with a stderr warning when the file is malformed", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const result = await loadScoringVocabularyFile(FIXTURES_EDGE_DIR);
    expect(result).toEqual(DEFAULT_SCORING_VOCABULARY);
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy.mock.calls[0]?.[0]).toContain("[scoring-vocabulary] warn:");
    stderrSpy.mockRestore();
  });
});
