import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type UsageRecord = {
  readonly timestamp: string;
  readonly role: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd?: number;
  readonly wallTimeMs: number;
};

type BuildUsageRecordInput = Omit<UsageRecord, "timestamp">;

export function buildUsageRecord(input: BuildUsageRecordInput): UsageRecord {
  return { timestamp: new Date().toISOString(), ...input };
}

// Resolve the telemetry data dir (best-effort: env var, then conventional sibling).
// Returns null when no data dir is found — callers silently skip the write.
function resolveTelemetryUsagePath(): string | null {
  const envDir = process.env["SELFWRIGHT_DATA_DIR"];
  if (envDir !== undefined && envDir.trim() !== "") {
    return resolve(envDir.trim(), "telemetry", "usage.jsonl");
  }
  const sibling = resolve(process.cwd(), "..", "Selfwright-data");
  if (existsSync(sibling)) return resolve(sibling, "telemetry", "usage.jsonl");
  return null;
}

export function appendUsageRecord(record: UsageRecord, filePath?: string): void {
  const resolvedPath = filePath ?? resolveTelemetryUsagePath();
  if (resolvedPath === null) return; // no data dir resolvable — best-effort skip
  mkdirSync(dirname(resolvedPath), { recursive: true });
  appendFileSync(resolvedPath, JSON.stringify(record) + "\n", "utf-8");
}
