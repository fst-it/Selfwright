import type { LlmPort } from "@selfwright/core";
import { JD_EXTRACTION_FIXTURES } from "../golden/jd-extraction.js";
import { runPrompt } from "../harness.js";

const EXTRACTION_SYSTEM_PROMPT =
  "You extract the top 5 required skills from a job description. " +
  "Respond with ONLY a JSON array of up to 5 short skill strings — no prose, no markdown.";

export const EXTRACTION_THRESHOLD = 0.6;

export function parseSkillArray(content: string): string[] | null {
  try {
    // Use non-greedy bracket groups to avoid spanning from a citation "[1]" to the real array.
    // Take the LAST match, since the answer array typically appears at or near the end of the response.
    const matches = content.match(/\[[^\[\]]*\]/g);
    const lastMatch = matches ? matches[matches.length - 1] : undefined;
    const jsonText = lastMatch ?? content.trim();
    const parsed = JSON.parse(jsonText) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.map((s) => String(s).trim().toLowerCase());
  } catch {
    return null;
  }
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 1 : intersection / union;
}

export type ExtractionFixtureScore = {
  readonly id: string;
  readonly ollamaVsClaude: number;
  readonly claudeVsExpected: number;
  readonly parseError?: string;
};

export type ExtractionCheckResult = {
  readonly name: "extraction";
  readonly pass: boolean;
  readonly threshold: number;
  readonly averageScore: number;
  readonly perFixture: readonly ExtractionFixtureScore[];
};

export async function runExtractionCheck(
  claude: LlmPort,
  ollama: LlmPort,
): Promise<ExtractionCheckResult> {
  const perFixture: ExtractionFixtureScore[] = [];

  for (const fixture of JD_EXTRACTION_FIXTURES) {
    const [claudeResult, ollamaResult] = await Promise.all([
      runPrompt(claude, "triage", EXTRACTION_SYSTEM_PROMPT, fixture.jdText),
      runPrompt(ollama, "triage", EXTRACTION_SYSTEM_PROMPT, fixture.jdText),
    ]);

    const claudeSkills = parseSkillArray(claudeResult.content);
    const ollamaSkills = parseSkillArray(ollamaResult.content);
    const expectedSkills = fixture.expectedSkills.map((s) => s.toLowerCase());

    const parseErrorParts: string[] = [];
    if (claudeSkills === null) {
      process.stderr.write(
        `[extraction] fixture ${fixture.id}: Claude response unparseable\n`,
      );
      parseErrorParts.push("claude");
    }
    if (ollamaSkills === null) {
      process.stderr.write(
        `[extraction] fixture ${fixture.id}: Ollama response unparseable\n`,
      );
      parseErrorParts.push("ollama");
    }

    const fixtureScore = {
      id: fixture.id,
      ollamaVsClaude:
        claudeSkills !== null && ollamaSkills !== null
          ? jaccard(ollamaSkills, claudeSkills)
          : 0,
      claudeVsExpected: claudeSkills !== null ? jaccard(claudeSkills, expectedSkills) : 0,
    };

    perFixture.push(
      parseErrorParts.length > 0
        ? { ...fixtureScore, parseError: parseErrorParts.join(", ") }
        : fixtureScore,
    );
  }

  const averageScore =
    perFixture.reduce((sum, f) => sum + f.ollamaVsClaude, 0) / perFixture.length;

  return {
    name: "extraction",
    pass: averageScore >= EXTRACTION_THRESHOLD,
    threshold: EXTRACTION_THRESHOLD,
    averageScore,
    perFixture,
  };
}
