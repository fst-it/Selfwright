import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildUsageRecord, appendUsageRecord, type UsageRecord } from "./metrics.js";

describe("buildUsageRecord", () => {
  it("builds a record with required fields", () => {
    const record = buildUsageRecord({
      role: "score",
      model: "claude/sonnet",
      inputTokens: 100,
      outputTokens: 50,
      wallTimeMs: 1200,
    });
    expect(record.role).toBe("score");
    expect(record.model).toBe("claude/sonnet");
    expect(record.inputTokens).toBe(100);
    expect(record.outputTokens).toBe(50);
    expect(record.wallTimeMs).toBe(1200);
    expect(record.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("includes costUsd when provided", () => {
    const record = buildUsageRecord({
      role: "triage",
      model: "claude/haiku",
      inputTokens: 10,
      outputTokens: 5,
      wallTimeMs: 200,
      costUsd: 0.0001,
    });
    expect(record.costUsd).toBe(0.0001);
  });
});

describe("appendUsageRecord", () => {
  let tempDir: string;
  let reportsDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `sw-metrics-test-${String(Date.now())}`);
    reportsDir = join(tempDir, "reports");
    mkdirSync(reportsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates usage.jsonl and appends the record", () => {
    const record: UsageRecord = buildUsageRecord({
      role: "score",
      model: "claude/sonnet",
      inputTokens: 100,
      outputTokens: 50,
      wallTimeMs: 1200,
    });

    const filePath = join(reportsDir, "usage.jsonl");
    appendUsageRecord(record, filePath);

    expect(existsSync(filePath)).toBe(true);
    const lines = readFileSync(filePath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? "{}") as UsageRecord;
    expect(parsed.role).toBe("score");
    expect(parsed.inputTokens).toBe(100);
  });

  it("appends multiple records as separate JSONL lines", () => {
    const filePath = join(reportsDir, "usage.jsonl");
    const r1 = buildUsageRecord({ role: "triage", model: "claude/haiku", inputTokens: 10, outputTokens: 5, wallTimeMs: 100 });
    const r2 = buildUsageRecord({ role: "score", model: "claude/sonnet", inputTokens: 200, outputTokens: 80, wallTimeMs: 2000 });

    appendUsageRecord(r1, filePath);
    appendUsageRecord(r2, filePath);

    const lines = readFileSync(filePath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect((JSON.parse(lines[0] ?? "{}") as UsageRecord).role).toBe("triage");
    expect((JSON.parse(lines[1] ?? "{}") as UsageRecord).role).toBe("score");
  });
});
