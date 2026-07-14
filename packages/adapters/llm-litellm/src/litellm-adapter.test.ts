import { describe, it, expect, vi, beforeEach } from "vitest";
import { LiteLlmAdapter } from "./litellm-adapter.js";
import type { ModelsConfig } from "@selfwright/shared-config";
import type { UsageRecord } from "@selfwright/tools";

const TEST_CONFIG: ModelsConfig = {
  default: "claude/haiku",
  roles: {
    triage: "claude/haiku",
    score: "claude/sonnet",
    tailor: "claude/sonnet",
    "cover-final": "claude/opus",
    judge: "claude/sonnet",
    default: "claude/haiku",
  },
};

const OK_RESPONSE = {
  id: "chatcmpl-test",
  object: "chat.completion",
  model: "claude-haiku-4-5",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Test response" },
      finish_reason: "stop",
    },
  ],
  usage: {
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
  },
};

describe("LiteLlmAdapter", () => {
  const mockFetch = vi.fn();
  const mockOnUsage = vi.fn<(record: UsageRecord) => void>();

  beforeEach(() => {
    mockFetch.mockReset();
    mockOnUsage.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("sends a POST to /chat/completions with the correct URL", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(OK_RESPONSE) });

    const adapter = new LiteLlmAdapter("http://localhost:4000", TEST_CONFIG, mockOnUsage);
    await adapter.complete({ role: "triage", messages: [{ role: "user", content: "Hello" }] });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:4000/chat/completions");
  });

  it("resolves the model from the role in models.yml", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(OK_RESPONSE) });

    const adapter = new LiteLlmAdapter("http://localhost:4000", TEST_CONFIG, mockOnUsage);
    await adapter.complete({ role: "score", messages: [{ role: "user", content: "Score this" }] });

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body["model"]).toBe("claude/sonnet");
  });

  it("falls back to default model for unknown role", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(OK_RESPONSE) });

    const adapter = new LiteLlmAdapter("http://localhost:4000", TEST_CONFIG, mockOnUsage);
    await adapter.complete({ role: "unknown-role", messages: [{ role: "user", content: "Hi" }] });

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body["model"]).toBe("claude/haiku");
  });

  it("forwards messages to the request body", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(OK_RESPONSE) });

    const messages = [
      { role: "system" as const, content: "You are a helper" },
      { role: "user" as const, content: "Score this role" },
    ];
    const adapter = new LiteLlmAdapter("http://localhost:4000", TEST_CONFIG, mockOnUsage);
    await adapter.complete({ role: "triage", messages });

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body["messages"]).toEqual(messages);
  });

  it("returns content and usage from the proxy response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(OK_RESPONSE) });

    const adapter = new LiteLlmAdapter("http://localhost:4000", TEST_CONFIG, mockOnUsage);
    const result = await adapter.complete({
      role: "triage",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result.content).toBe("Test response");
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);
  });

  it("calls onUsage with role, model, token counts, and a positive wall-time", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(OK_RESPONSE) });

    const adapter = new LiteLlmAdapter("http://localhost:4000", TEST_CONFIG, mockOnUsage);
    await adapter.complete({ role: "score", messages: [{ role: "user", content: "Hi" }] });

    expect(mockOnUsage).toHaveBeenCalledOnce();
    const record = mockOnUsage.mock.calls.at(0)?.[0];
    expect(record).toBeDefined();
    expect(record?.role).toBe("score");
    expect(record?.model).toBe("claude/sonnet");
    expect(record?.inputTokens).toBe(10);
    expect(record?.outputTokens).toBe(5);
    expect(record?.wallTimeMs).toBeGreaterThanOrEqual(0);
    expect(typeof record?.timestamp).toBe("string");
  });

  it("throws a descriptive error on non-OK HTTP response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      json: () => Promise.resolve({ error: { message: "LiteLLM unavailable" } }),
    });

    const adapter = new LiteLlmAdapter("http://localhost:4000", TEST_CONFIG, mockOnUsage);
    await expect(
      adapter.complete({ role: "triage", messages: [{ role: "user", content: "Hi" }] }),
    ).rejects.toThrow("503");
  });
});
