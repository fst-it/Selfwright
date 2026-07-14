import { spawn } from "node:child_process";
import type { LlmPort, LlmRequest, LlmResult } from "@selfwright/core";
import { appendUsageRecord, buildUsageRecord } from "@selfwright/tools";
import type { UsageRecord } from "@selfwright/tools";

/**
 * Minimal surface of node:child_process's ChildProcess that this adapter needs.
 * Kept intentionally narrow (rather than depending on the full, overloaded
 * `spawn` typings) so tests can inject a plain EventEmitter-based fake
 * without fighting Node's ChildProcess type.
 */
export interface SpawnedProcess {
  readonly stdout: { on(event: "data", listener: (chunk: Buffer | string) => void): void } | null;
  readonly stderr: { on(event: "data", listener: (chunk: Buffer | string) => void): void } | null;
  readonly stdin: { write(data: string): void; end(): void } | null;
  on(event: "close", listener: (code: number | null) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
}

export type SpawnFn = (command: string, args: string[]) => SpawnedProcess;

// Real subprocess spawn — deliberately excluded from unit-test coverage
// (tests inject a fake SpawnFn and must never invoke the real `claude` binary).
/* v8 ignore start */
function defaultSpawn(command: string, args: string[]): SpawnedProcess {
  return spawn(command, args);
}
/* v8 ignore stop */

interface ClaudeJsonResult {
  result: string;
  is_error?: boolean;
  usage?: { input_tokens?: number; output_tokens?: number };
  total_cost_usd?: number;
}

export interface ClaudeCliAdapterOpts {
  /** "text" (default): plain stdout, usage reported as zeros. "json": parse --output-format json for real usage. */
  outputFormat?: "text" | "json";
  /**
   * Fallback Claude-model hint (config/models.yml's `default:`) used when
   * `req.role` has no entry in `modelIds`. Mirrors LiteLlmAdapter.resolveModel's
   * roles-then-default fallback — without this, an unmapped role silently
   * omits `--model` instead of falling back to the configured default.
   */
  defaultModel?: string;
}

/**
 * Headless LlmPort implementation that shells out to `claude --print`.
 * Optional escape hatch behind LlmPort — not wired into any default
 * composition root (see ADR 0006).
 */
export class ClaudeCliAdapter implements LlmPort {
  constructor(
    private readonly modelIds: Record<string, string> = {},
    private readonly spawnFn: SpawnFn = defaultSpawn,
    private readonly opts: ClaudeCliAdapterOpts = {},
    private readonly onUsage: (record: UsageRecord) => void = appendUsageRecord,
  ) {}

  async complete(req: LlmRequest): Promise<LlmResult> {
    const systemPrompt = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const userPrompt = req.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => m.content)
      .join("\n\n");

    const args = ["--print"];
    const model = this.modelIds[req.role] ?? this.opts.defaultModel;
    if (model !== undefined) args.push("--model", model);
    if (systemPrompt.length > 0) args.push("--append-system-prompt", systemPrompt);
    const useJson = this.opts.outputFormat === "json";
    if (useJson) args.push("--output-format", "json");
    const startMs = Date.now();

    return new Promise<LlmResult>((resolve, reject) => {
      const child = this.spawnFn("claude", args);
      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (err) => {
        reject(err);
      });
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`claude exited with code ${String(code)}: ${stderr.trim()}`));
          return;
        }
        let result: LlmResult;
        if (useJson) {
          try {
            result = parseJsonResult(stdout);
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
            return;
          }
        } else {
          result = { content: stdout.trim(), usage: { inputTokens: 0, outputTokens: 0 } };
        }
        this.onUsage(
          buildUsageRecord({
            role: req.role,
            model: model ?? "unknown",
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            wallTimeMs: Date.now() - startMs,
            ...(result.usage.costUsd !== undefined ? { costUsd: result.usage.costUsd } : {}),
          }),
        );
        resolve(result);
      });

      child.stdin?.write(userPrompt);
      child.stdin?.end();
    });
  }
}

function parseJsonResult(stdout: string): LlmResult {
  let parsed: ClaudeJsonResult;
  try {
    parsed = JSON.parse(stdout) as ClaudeJsonResult;
  } catch (e) {
    throw new Error(
      `Failed to parse claude --output-format json output: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const usage = {
    inputTokens: parsed.usage?.input_tokens ?? 0,
    outputTokens: parsed.usage?.output_tokens ?? 0,
  };
  return {
    content: parsed.result,
    usage: parsed.total_cost_usd !== undefined ? { ...usage, costUsd: parsed.total_cost_usd } : usage,
  };
}
