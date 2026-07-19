/**
 * Smoke tests for the Selfwright CLI.
 *
 * Imports `program` directly (the main module guard in index.ts prevents
 * program.parse() from running at import time) and calls program.parseAsync()
 * with synthetic args.
 *
 * process.exit is mocked as a no-op in every test so the test process
 * survives the CLI's early-exit paths (metrics exits 0 when no usage file).
 *
 * Synthetic data only — no real names, no real company data.
 */
import { describe, it, expect, afterEach, vi, beforeAll, beforeEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// program is exported from index.ts; the main guard prevents auto-parse.
const { program } = await import("../index.js");

// ── helpers ───────────────────────────────────────────────────────────────────

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "sw-smoke-"));
}

/** Suppress process.exit without killing the test process. */
function mockExit(): void {
  // A zero-arg function is assignable to `(code?: ...) => never` in TypeScript
  // (optional-param compatibility). `undefined as never` satisfies the `never`
  // return type without throwing — the test process stays alive.
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
}

/**
 * Capture stdout output produced by a parseAsync call.
 * process.exit is mocked to a no-op for the duration of the call so early-exit
 * paths in the CLI action don't kill the test process.
 */
async function captureStdout(args: string[]): Promise<string> {
  const chunks: string[] = [];
  mockExit();
  vi.spyOn(process.stdout, "write").mockImplementation(
    (...a: Parameters<typeof process.stdout.write>) => {
      const [chunk] = a;
      if (typeof chunk === "string") chunks.push(chunk);
      return true;
    },
  );
  try {
    await program.parseAsync(["node", "selfwright", ...args]);
  } finally {
    vi.restoreAllMocks();
  }
  return chunks.join("");
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("CLI smoke tests", () => {
  let sharedDir: string;

  beforeAll(async () => {
    sharedDir = await makeTempDir();
    // applications.yml — needed for northStar + channelOutcomes computation
    const appsDir = join(sharedDir, "applications");
    await mkdir(appsDir, { recursive: true });
    const appsYaml = [
      "- id: smoke-001",
      "  company: AcmeCorp",
      "  role: Software Engineer",
      "  status: applied",
      "  channel: linkedin",
      "  dates:",
      '    applied: "2026-01-10"',
      '    last_update: "2026-01-10"',
    ].join("\n");
    await writeFile(join(appsDir, "applications.yml"), appsYaml, "utf-8");

    // telemetry/usage.jsonl — empty file prevents the "raw === null" early-exit
    // path from running before the JSON output that includes northStar. When
    // process.exit is mocked as a no-op the "No valid usage records" path still
    // falls through to the JSON formatter which then outputs northStar.
    const telemetryDir = join(sharedDir, "telemetry");
    await mkdir(telemetryDir, { recursive: true });
    await writeFile(join(telemetryDir, "usage.jsonl"), "", "utf-8");
  });

  beforeEach(() => {
    process.env["SELFWRIGHT_DATA_DIR"] = sharedDir;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env["SELFWRIGHT_DATA_DIR"];
  });

  it("(a) metrics --format json includes northStar and channelOutcomes keys", async () => {
    const output = await captureStdout(["metrics", "--format", "json"]);
    expect(output).toBeTruthy();
    const json = JSON.parse(output) as Record<string, unknown>;
    expect(json).toHaveProperty("northStar");
    expect(json).toHaveProperty("channelOutcomes");
  });

  it("(b) debrief add then list round-trip stores and retrieves the entry", async () => {
    const dir = await makeTempDir();
    process.env["SELFWRIGHT_DATA_DIR"] = dir;

    // Add: writes to stderr only — suppress stderr and exit
    mockExit();
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await program.parseAsync([
      "node", "selfwright", "debrief", "add",
      "--app", "smoke-002",
      "--date", "2026-01-15",
      "--round", "technical-1",
      "--wobbled", "system design;data modelling",
      "--went-well", "behavioural",
    ]);
    vi.restoreAllMocks();

    // List: text output with the round-trip values
    const output = await captureStdout(["debrief", "list"]);
    expect(output).toContain("smoke-002");
    expect(output).toContain("2026-01-15");
    expect(output).toContain("technical-1");
    expect(output).toContain("system design");
    expect(output).toContain("data modelling");
    expect(output).toContain("behavioural");

    await rm(dir, { recursive: true, force: true });
  });

  it("(c) inbox with empty data dir returns empty 3-tier report without crashing", async () => {
    const dir = await makeTempDir();
    process.env["SELFWRIGHT_DATA_DIR"] = dir;

    const output = await captureStdout(["inbox", "--format", "json"]);
    expect(output).toBeTruthy();
    const report = JSON.parse(output) as Record<string, unknown>;
    expect(report).toHaveProperty("decideNow");
    expect(report).toHaveProperty("reviewSoon");
    expect(report).toHaveProperty("fyi");
    expect(Array.isArray(report["decideNow"])).toBe(true);
    expect(Array.isArray(report["reviewSoon"])).toBe(true);
    expect(Array.isArray(report["fyi"])).toBe(true);

    await rm(dir, { recursive: true, force: true });
  });
});
