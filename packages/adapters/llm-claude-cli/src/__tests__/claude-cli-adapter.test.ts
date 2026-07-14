import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { ClaudeCliAdapter } from "../claude-cli-adapter.js";
import type { SpawnedProcess, SpawnFn } from "../claude-cli-adapter.js";
import type { UsageRecord } from "@selfwright/tools";

interface FakeChild extends SpawnedProcess {
  emitStdout(chunk: string): void;
  emitStderr(chunk: string): void;
  emitClose(code: number | null): void;
  emitError(err: Error): void;
  stdinWrite: ReturnType<typeof vi.fn>;
  stdinEnd: ReturnType<typeof vi.fn>;
}

function makeFakeChild(): FakeChild {
  const proc = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const stdinWrite = vi.fn();
  const stdinEnd = vi.fn();
  return Object.assign(proc, {
    stdout,
    stderr,
    stdin: { write: stdinWrite, end: stdinEnd },
    stdinWrite,
    stdinEnd,
    emitStdout: (chunk: string) => stdout.emit("data", chunk),
    emitStderr: (chunk: string) => stderr.emit("data", chunk),
    emitClose: (code: number | null) => proc.emit("close", code),
    emitError: (err: Error) => proc.emit("error", err),
  });
}

describe("ClaudeCliAdapter", () => {
  it("splits system messages into --append-system-prompt and user/assistant messages onto stdin", async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn<SpawnFn>().mockReturnValue(child);
    const adapter = new ClaudeCliAdapter({}, spawnFn, {}, vi.fn<(record: UsageRecord) => void>());

    const promise = adapter.complete({
      role: "triage",
      messages: [
        { role: "system", content: "You are a helper." },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ],
    });
    child.emitStdout("ok");
    child.emitClose(0);
    await promise;

    const [command, args] = spawnFn.mock.calls[0] as [string, string[]];
    expect(command).toBe("claude");
    expect(args).toContain("--append-system-prompt");
    expect(args[args.indexOf("--append-system-prompt") + 1]).toBe("You are a helper.");
    expect(child.stdinWrite).toHaveBeenCalledWith("Hello\n\nHi there");
    expect(child.stdinEnd).toHaveBeenCalledOnce();
  });

  it("omits --append-system-prompt when there is no system message", async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn<SpawnFn>().mockReturnValue(child);
    const adapter = new ClaudeCliAdapter({}, spawnFn, {}, vi.fn<(record: UsageRecord) => void>());

    const promise = adapter.complete({ role: "triage", messages: [{ role: "user", content: "Hi" }] });
    child.emitStdout("ok");
    child.emitClose(0);
    await promise;

    const [, args] = spawnFn.mock.calls[0] as [string, string[]];
    expect(args).not.toContain("--append-system-prompt");
  });

  it("selects --model when the role is known in the injected model-id map", async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn<SpawnFn>().mockReturnValue(child);
    const adapter = new ClaudeCliAdapter(
      { "cover-final": "claude-opus-4-8" },
      spawnFn,
      {},
      vi.fn<(record: UsageRecord) => void>(),
    );

    const promise = adapter.complete({ role: "cover-final", messages: [{ role: "user", content: "Hi" }] });
    child.emitStdout("ok");
    child.emitClose(0);
    await promise;

    const [, args] = spawnFn.mock.calls[0] as [string, string[]];
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("claude-opus-4-8");
  });

  it("omits --model when the role is unknown and no defaultModel is configured", async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn<SpawnFn>().mockReturnValue(child);
    const adapter = new ClaudeCliAdapter(
      { "cover-final": "claude-opus-4-8" },
      spawnFn,
      {},
      vi.fn<(record: UsageRecord) => void>(),
    );

    const promise = adapter.complete({ role: "unknown-role", messages: [{ role: "user", content: "Hi" }] });
    child.emitStdout("ok");
    child.emitClose(0);
    await promise;

    const [, args] = spawnFn.mock.calls[0] as [string, string[]];
    expect(args).not.toContain("--model");
  });

  it("falls back to opts.defaultModel when the role is unknown", async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn<SpawnFn>().mockReturnValue(child);
    const adapter = new ClaudeCliAdapter(
      { "cover-final": "claude-opus-4-8" },
      spawnFn,
      { defaultModel: "claude/haiku" },
      vi.fn<(record: UsageRecord) => void>(),
    );

    const promise = adapter.complete({ role: "unknown-role", messages: [{ role: "user", content: "Hi" }] });
    child.emitStdout("ok");
    child.emitClose(0);
    await promise;

    const [, args] = spawnFn.mock.calls[0] as [string, string[]];
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("claude/haiku");
  });

  it("resolves content from trimmed stdout with zero usage by default (text mode)", async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn<SpawnFn>().mockReturnValue(child);
    const adapter = new ClaudeCliAdapter({}, spawnFn, {}, vi.fn<(record: UsageRecord) => void>());

    const promise = adapter.complete({ role: "triage", messages: [{ role: "user", content: "Hi" }] });
    child.emitStdout("Hello back\n");
    child.emitClose(0);
    const result = await promise;

    expect(result.content).toBe("Hello back");
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("assembles stdout across multiple data chunks", async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn<SpawnFn>().mockReturnValue(child);
    const adapter = new ClaudeCliAdapter({}, spawnFn, {}, vi.fn<(record: UsageRecord) => void>());

    const promise = adapter.complete({ role: "triage", messages: [{ role: "user", content: "Hi" }] });
    child.emitStdout("Hello ");
    child.emitStdout("back");
    child.emitClose(0);
    const result = await promise;

    expect(result.content).toBe("Hello back");
  });

  it("rejects with a descriptive error (including stderr) on non-zero exit", async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn<SpawnFn>().mockReturnValue(child);
    const adapter = new ClaudeCliAdapter({}, spawnFn, {}, vi.fn<(record: UsageRecord) => void>());

    const promise = adapter.complete({ role: "triage", messages: [{ role: "user", content: "Hi" }] });
    child.emitStderr("authentication failed");
    child.emitClose(1);

    await expect(promise).rejects.toThrow(/authentication failed/);
  });

  it("rejects when the child process emits an error", async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn<SpawnFn>().mockReturnValue(child);
    const adapter = new ClaudeCliAdapter({}, spawnFn, {}, vi.fn<(record: UsageRecord) => void>());

    const promise = adapter.complete({ role: "triage", messages: [{ role: "user", content: "Hi" }] });
    child.emitError(new Error("ENOENT: claude not found"));

    await expect(promise).rejects.toThrow("ENOENT");
  });

  it("passes --output-format json and parses real usage when outputFormat is json", async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn<SpawnFn>().mockReturnValue(child);
    const adapter = new ClaudeCliAdapter(
      {},
      spawnFn,
      { outputFormat: "json" },
      vi.fn<(record: UsageRecord) => void>(),
    );

    const promise = adapter.complete({ role: "triage", messages: [{ role: "user", content: "Hi" }] });
    const [, args] = spawnFn.mock.calls[0] as [string, string[]];
    expect(args).toContain("--output-format");
    expect(args[args.indexOf("--output-format") + 1]).toBe("json");

    child.emitStdout(
      JSON.stringify({
        result: "pong",
        usage: { input_tokens: 12, output_tokens: 4 },
        total_cost_usd: 0.0021,
      }),
    );
    child.emitClose(0);
    const result = await promise;

    expect(result.content).toBe("pong");
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 4, costUsd: 0.0021 });
  });

  it("rejects with a clear error when --output-format json output is not valid JSON", async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn<SpawnFn>().mockReturnValue(child);
    const onUsage = vi.fn<(record: UsageRecord) => void>();
    const adapter = new ClaudeCliAdapter({}, spawnFn, { outputFormat: "json" }, onUsage);

    const promise = adapter.complete({ role: "triage", messages: [{ role: "user", content: "Hi" }] });
    child.emitStdout("not json");
    child.emitClose(0);

    await expect(promise).rejects.toThrow(/Failed to parse/);
    expect(onUsage).not.toHaveBeenCalled();
  });

  it("defaults to the real node:child_process spawn when no spawnFn is injected", () => {
    // Constructing without a spawnFn must not throw — it should fall back to
    // the real `spawn`. We never call .complete() here, so the real `claude`
    // binary is never invoked.
    expect(() => new ClaudeCliAdapter()).not.toThrow();
  });

  it("calls onUsage once in text mode with zero tokens and no costUsd", async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn<SpawnFn>().mockReturnValue(child);
    const onUsage = vi.fn<(record: UsageRecord) => void>();
    const adapter = new ClaudeCliAdapter({}, spawnFn, {}, onUsage);

    const promise = adapter.complete({ role: "triage", messages: [{ role: "user", content: "Hi" }] });
    child.emitStdout("Hello");
    child.emitClose(0);
    await promise;

    expect(onUsage).toHaveBeenCalledOnce();
    const record = onUsage.mock.calls.at(0)?.[0];
    expect(record).toBeDefined();
    expect(record?.role).toBe("triage");
    expect(record?.model).toBe("unknown");
    expect(record?.inputTokens).toBe(0);
    expect(record?.outputTokens).toBe(0);
    expect(record?.wallTimeMs).toBeGreaterThanOrEqual(0);
    expect(typeof record?.timestamp).toBe("string");
    expect(record?.costUsd).toBeUndefined();
  });

  it("calls onUsage once in json mode with real usage and costUsd", async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn<SpawnFn>().mockReturnValue(child);
    const onUsage = vi.fn<(record: UsageRecord) => void>();
    const adapter = new ClaudeCliAdapter({}, spawnFn, { outputFormat: "json" }, onUsage);

    const promise = adapter.complete({ role: "triage", messages: [{ role: "user", content: "Hi" }] });
    child.emitStdout(
      JSON.stringify({
        result: "pong",
        usage: { input_tokens: 12, output_tokens: 4 },
        total_cost_usd: 0.0021,
      }),
    );
    child.emitClose(0);
    await promise;

    expect(onUsage).toHaveBeenCalledOnce();
    const record = onUsage.mock.calls.at(0)?.[0];
    expect(record?.role).toBe("triage");
    expect(record?.model).toBe("unknown");
    expect(record?.inputTokens).toBe(12);
    expect(record?.outputTokens).toBe(4);
    expect(record?.costUsd).toBe(0.0021);
    expect(record?.wallTimeMs).toBeGreaterThanOrEqual(0);
    expect(typeof record?.timestamp).toBe("string");
  });

  it("does not call onUsage on non-zero exit", async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn<SpawnFn>().mockReturnValue(child);
    const onUsage = vi.fn<(record: UsageRecord) => void>();
    const adapter = new ClaudeCliAdapter({}, spawnFn, {}, onUsage);

    const promise = adapter.complete({ role: "triage", messages: [{ role: "user", content: "Hi" }] });
    child.emitStderr("auth failed");
    child.emitClose(1);
    await expect(promise).rejects.toThrow();

    expect(onUsage).not.toHaveBeenCalled();
  });
});
