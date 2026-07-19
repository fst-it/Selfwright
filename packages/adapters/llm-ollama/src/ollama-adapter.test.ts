import { describe, it, expect, vi, beforeEach } from "vitest";
import { OllamaAdapter } from "./ollama-adapter.js";
import type { UsageRecord } from "@selfwright/tools";

const OK_RESPONSE = {
  id: "chatcmpl-test",
  object: "chat.completion",
  model: "llama3.2:3b",
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

describe("OllamaAdapter", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("sends a POST to {baseUrl}/v1/chat/completions with the configured model", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(OK_RESPONSE) });

    const adapter = new OllamaAdapter(
      "llama3.2:3b",
      "http://localhost:11434",
      vi.fn<(record: UsageRecord) => void>(),
    );
    await adapter.complete({ role: "triage", messages: [{ role: "user", content: "Hello" }] });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body["model"]).toBe("llama3.2:3b");
  });

  it("defaults baseUrl to http://localhost:11434 when not provided", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(OK_RESPONSE) });

    const adapter = new OllamaAdapter("llama3.2:3b", undefined, vi.fn<(record: UsageRecord) => void>());
    await adapter.complete({ role: "triage", messages: [{ role: "user", content: "Hi" }] });

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
  });

  it("returns content and usage with costUsd always 0", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(OK_RESPONSE) });

    const adapter = new OllamaAdapter("llama3.2:3b", undefined, vi.fn<(record: UsageRecord) => void>());
    const result = await adapter.complete({
      role: "triage",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result.content).toBe("Test response");
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);
    expect(result.usage.costUsd).toBe(0);
  });

  it("throws a descriptive error on non-OK HTTP response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });

    const adapter = new OllamaAdapter("llama3.2:3b", undefined, vi.fn<(record: UsageRecord) => void>());
    await expect(
      adapter.complete({ role: "triage", messages: [{ role: "user", content: "Hi" }] }),
    ).rejects.toThrow("503");
  });

  it("throws a descriptive error on an empty choices array", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          ...OK_RESPONSE,
          choices: [],
        }),
    });

    const adapter = new OllamaAdapter("llama3.2:3b", undefined, vi.fn<(record: UsageRecord) => void>());
    await expect(
      adapter.complete({ role: "triage", messages: [{ role: "user", content: "Hi" }] }),
    ).rejects.toThrow("empty choices array");
  });

  it("calls onUsage with role, model, token counts, costUsd 0, and a non-negative wall-time", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(OK_RESPONSE) });
    const onUsage = vi.fn<(record: UsageRecord) => void>();

    const adapter = new OllamaAdapter("llama3.2:3b", "http://localhost:11434", onUsage);
    await adapter.complete({ role: "triage", messages: [{ role: "user", content: "Hi" }] });

    expect(onUsage).toHaveBeenCalledOnce();
    const record = onUsage.mock.calls.at(0)?.[0];
    expect(record).toBeDefined();
    expect(record?.role).toBe("triage");
    expect(record?.model).toBe("llama3.2:3b");
    expect(record?.inputTokens).toBe(10);
    expect(record?.outputTokens).toBe(5);
    expect(record?.costUsd).toBe(0);
    expect(record?.wallTimeMs).toBeGreaterThanOrEqual(0);
    expect(typeof record?.timestamp).toBe("string");
  });

  it("does not call onUsage on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });
    const onUsage = vi.fn<(record: UsageRecord) => void>();

    const adapter = new OllamaAdapter("llama3.2:3b", "http://localhost:11434", onUsage);
    await expect(
      adapter.complete({ role: "triage", messages: [{ role: "user", content: "Hi" }] }),
    ).rejects.toThrow("503");

    expect(onUsage).not.toHaveBeenCalled();
  });
});
