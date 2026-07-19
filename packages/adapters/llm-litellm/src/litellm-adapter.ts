import type { LlmPort, LlmRequest, LlmResult } from "@selfwright/core";
import type { ModelsConfig, ModelRole } from "@selfwright/shared-config";
import { appendUsageRecord, buildUsageRecord } from "@selfwright/tools";
import type { UsageRecord } from "@selfwright/tools";

const FETCH_TIMEOUT_MS = 30_000;

function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const tid = setTimeout(() => { controller.abort(); }, FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => { clearTimeout(tid); });
}

type OpenAiMessage = { role: string; content: string };
type OpenAiChatRequest = { model: string; messages: OpenAiMessage[] };
type OpenAiChatResponse = {
  choices: Array<{ message: { content: string }; finish_reason: string }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

export class LiteLlmAdapter implements LlmPort {
  constructor(
    private readonly baseUrl: string,
    private readonly modelsConfig: ModelsConfig,
    private readonly onUsage: (record: UsageRecord) => void = appendUsageRecord,
  ) {}

  async complete(req: LlmRequest): Promise<LlmResult> {
    const model = this.resolveModel(req.role);
    const startMs = Date.now();

    const body: OpenAiChatRequest = {
      model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    };

    const response = await fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(
        `LiteLLM request failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as OpenAiChatResponse;

    const choice = data.choices[0];
    if (choice === undefined) {
      throw new Error("LiteLLM returned an empty choices array");
    }

    const result: LlmResult = {
      content: choice.message.content,
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
      },
    };

    this.onUsage(
      buildUsageRecord({
        role: req.role,
        model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        wallTimeMs: Date.now() - startMs,
      }),
    );

    return result;
  }

  private resolveModel(role: string): string {
    const known = Object.prototype.hasOwnProperty.call(this.modelsConfig.roles, role);
    return (
      (known ? this.modelsConfig.roles[role as ModelRole] : undefined) ??
      this.modelsConfig.default
    );
  }
}
