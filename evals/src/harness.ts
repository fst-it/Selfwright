import type { LlmPort, LlmResult } from "@selfwright/core";

export async function runPrompt(
  llm: LlmPort,
  role: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<LlmResult> {
  return llm.complete({
    role,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
}
