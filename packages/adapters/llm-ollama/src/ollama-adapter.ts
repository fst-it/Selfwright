import type { LlmPort, LlmRequest, LlmResult } from "@selfwright/core";
import { appendUsageRecord, buildUsageRecord } from "@selfwright/tools";
import type { UsageRecord } from "@selfwright/tools";

const FETCH_TIMEOUT_MS = 30_000;

function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const tid = setTimeout(() => { controller.abort(); }, FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => { clearTimeout(tid); });
}

type OllamaMessage = { role: string; content: string };
type OllamaChatRequest = { model: string; messages: OllamaMessage[] };
type OllamaChatResponse = {
  choices: Array<{ message: { content: string }; finish_reason: string }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

export class OllamaAdapter implements LlmPort {
  constructor(
    private readonly model: string,
    private readonly baseUrl: string = "http://localhost:11434",
    private readonly onUsage: (record: UsageRecord) => void = appendUsageRecord,
  ) {}

  async complete(req: LlmRequest): Promise<LlmResult> {
    const body: OllamaChatRequest = {
      model: this.model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    const startMs = Date.now();

    const response = await fetchWithTimeout(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as OllamaChatResponse;

    const choice = data.choices[0];
    if (choice === undefined) {
      throw new Error("Ollama returned an empty choices array");
    }

    const result: LlmResult = {
      content: choice.message.content,
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        costUsd: 0,
      },
    };

    this.onUsage(
      buildUsageRecord({
        role: req.role,
        model: this.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        wallTimeMs: Date.now() - startMs,
        costUsd: 0,
      }),
    );

    return result;
  }
}
