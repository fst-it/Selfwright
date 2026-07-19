import type { LlmPort } from "../ports/llm.js";
import type { CoverContext, CoverResult } from "./types.js";
import type { Identity } from "../truth/index.js";
import type { TailoredCvContent } from "../tailoring/index.js";
import { fenceUntrusted } from "./prompt-fence.js";

function buildCoverSystemPrompt(identity: Identity, styleGuide?: string): string {
  const boundaries = identity.honesty_boundaries.join("; ");
  return [
    "You generate cover letters. Every claim must trace to the provided identity and evidence.",
    "Do NOT invent facts, titles, systems, or metrics.",
    "Use British/EU spelling for European employers.",
    "Format: 350-400 words. No bold-label bullets in body. Hook opening — never start with 'I am writing to...'.",
    `Honesty boundaries: ${boundaries}`,
    styleGuide ? `Style guide: ${styleGuide}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildCoverUserPrompt(ctx: CoverContext): string {
  const parts: string[] = [
    "JOB DESCRIPTION:",
    ...fenceUntrusted(ctx.jdText),
    "",
  ];

  if (ctx.companyResearch) {
    parts.push("COMPANY RESEARCH:", ...fenceUntrusted(ctx.companyResearch), "");
  }

  parts.push(
    "TAILORED CV (structured data):",
    JSON.stringify(ctx.tailoredCv, null, 2),
    "",
    "IDENTITY CONTEXT:",
    `Canonical title: ${ctx.identity.canonical_title}`,
    `Honesty boundaries: ${ctx.identity.honesty_boundaries.join("; ")}`,
    "",
  );

  if (ctx.driftSummary) {
    parts.push("DRIFT SUMMARY:", ...fenceUntrusted(ctx.driftSummary), "");
  }

  if (ctx.archetypeId) {
    parts.push(`TARGET ARCHETYPE: ${ctx.archetypeId}`, "");
  }

  parts.push("Write a cover letter per the format rules. Output only the markdown cover letter.");

  return parts.join("\n");
}

export async function cover(ctx: CoverContext, llm: LlmPort): Promise<CoverResult> {
  const systemPrompt = buildCoverSystemPrompt(ctx.identity, ctx.styleGuide);
  const userPrompt = buildCoverUserPrompt(ctx);
  const result = await llm.complete({
    role: "cover-final",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  const markdown = result.content;
  const wordCount = markdown.trim().split(/\s+/).length;
  return { markdown, wordCount };
}

// Export builders for testability without LLM
export { buildCoverSystemPrompt, buildCoverUserPrompt };
export type { TailoredCvContent };
