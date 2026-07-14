import type { LlmPort } from "../ports/llm.js";
import type { ResearchContext, ResearchResult } from "./types.js";
import { fenceUntrusted } from "./prompt-fence.js";

export function buildResearchPrompt(ctx: ResearchContext): string {
  const parts: string[] = [
    `COMPANY: ${ctx.company}`,
    `ROLE TITLE: ${ctx.roleTitle}`,
    "",
    "JOB DESCRIPTION:",
    ...fenceUntrusted(ctx.jdText),
    "",
  ];

  if (ctx.archetypeId) {
    parts.push(`TARGET ARCHETYPE: ${ctx.archetypeId}`, "");
  }

  if (ctx.gapsText) {
    parts.push("KNOWN GAPS AND RISKS:", ctx.gapsText, "");
  }

  parts.push(
    "Research the company and role. Produce a company-research.md document.",
    "Never invent facts. Use public sources only.",
  );

  return parts.join("\n");
}

export async function research(ctx: ResearchContext, llm: LlmPort): Promise<ResearchResult> {
  const systemPrompt = `You are a career research assistant. Research the company and role from the provided JD.
Use public sources only. Output a company-research.md document. Never invent facts.`;
  const userPrompt = buildResearchPrompt(ctx);
  const result = await llm.complete({
    role: "research",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  return { markdown: result.content };
}
