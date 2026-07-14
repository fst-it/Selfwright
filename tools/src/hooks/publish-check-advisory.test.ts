// Tests use ONLY synthetic values in all examples — this file is itself scanned
// by the deterministic gates (ADR 0017 §1: test files are not exempted).
import { afterEach, describe, expect, it } from "vitest";
import {
  isAcknowledged,
  isOptIn,
  parseClaudeSpawnOutcome,
  parsePublishCheckVerdict,
} from "./publish-check-advisory.js";

// ── parsePublishCheckVerdict ──────────────────────────────────────────────────

describe("parsePublishCheckVerdict — CLEAN verdict", () => {
  it("recognises a bare CLEAN verdict line", () => {
    const result = parsePublishCheckVerdict("PUBLISH-CHECK: CLEAN");
    expect(result).toEqual({ clean: true, findingCount: 0 });
  });

  it("recognises CLEAN when it is the last line of multi-line output", () => {
    const result = parsePublishCheckVerdict(
      "No findings detected in the diff.\n\nPUBLISH-CHECK: CLEAN",
    );
    expect(result).toEqual({ clean: true, findingCount: 0 });
  });

  it("tolerates trailing whitespace / blank lines after the verdict", () => {
    const result = parsePublishCheckVerdict("PUBLISH-CHECK: CLEAN\n\n  ");
    expect(result).toEqual({ clean: true, findingCount: 0 });
  });

  it("is case-insensitive on the verdict token", () => {
    const result = parsePublishCheckVerdict("publish-check: clean");
    expect(result).toEqual({ clean: true, findingCount: 0 });
  });
});

describe("parsePublishCheckVerdict — FINDINGS verdict", () => {
  it("parses a single-finding verdict", () => {
    const result = parsePublishCheckVerdict("PUBLISH-CHECK: 1 FINDINGS");
    expect(result).toEqual({ clean: false, findingCount: 1 });
  });

  it("parses a multi-finding verdict", () => {
    const result = parsePublishCheckVerdict(
      "FINDING: contextual-PII severity:high file:docs/foo.md line:5 — synthetic example\n" +
        "FINDING: semantic-leak severity:medium file:docs/bar.md line:12 — synthetic example\n" +
        "PUBLISH-CHECK: 2 FINDINGS",
    );
    expect(result).toEqual({ clean: false, findingCount: 2 });
  });

  it("accepts the singular FINDING form", () => {
    // Rubric allows both "1 FINDING" and "1 FINDINGS" for natural language.
    const result = parsePublishCheckVerdict("PUBLISH-CHECK: 1 FINDING");
    expect(result).toEqual({ clean: false, findingCount: 1 });
  });

  it("is case-insensitive on the FINDINGS token", () => {
    const result = parsePublishCheckVerdict("publish-check: 3 findings");
    expect(result).toEqual({ clean: false, findingCount: 3 });
  });
});

describe("parsePublishCheckVerdict — inconclusive / no verdict", () => {
  it("returns null for empty output", () => {
    expect(parsePublishCheckVerdict("")).toBeNull();
  });

  it("returns null when the output has no verdict line", () => {
    expect(
      parsePublishCheckVerdict("The diff looks reasonable.\n\nNo issues found."),
    ).toBeNull();
  });

  it("returns null when the verdict is in the middle of the output, not the last line", () => {
    // The contract is STRICT: verdict must be the last non-empty line.
    const result = parsePublishCheckVerdict(
      "PUBLISH-CHECK: CLEAN\n\nSome trailing commentary that breaks the contract.",
    );
    expect(result).toBeNull();
  });

  it("returns null for a malformed verdict line", () => {
    expect(parsePublishCheckVerdict("PUBLISH-CHECK: OK")).toBeNull();
    expect(parsePublishCheckVerdict("PUBLISH-CHECK: YES FINDINGS")).toBeNull();
  });

  it("returns null for PUBLISH-CHECK: 0 FINDINGS (zero is not a valid finding count)", () => {
    // A model that genuinely found nothing should emit CLEAN, not "0 FINDINGS".
    // Treating "0 FINDINGS" as clean would silently pass a malformed verdict;
    // treating it as a blocking non-clean verdict would block on zero findings.
    // The correct answer: reject as an unparseable verdict (null → fail-open).
    expect(parsePublishCheckVerdict("PUBLISH-CHECK: 0 FINDINGS")).toBeNull();
    expect(parsePublishCheckVerdict("PUBLISH-CHECK: 0 FINDING")).toBeNull();
  });
});

// ── isOptIn ───────────────────────────────────────────────────────────────────

describe("isOptIn — SELFWRIGHT_PUBLISH_CHECK_HOOK gate", () => {
  const ORIG = process.env["SELFWRIGHT_PUBLISH_CHECK_HOOK"];
  afterEach(() => {
    if (ORIG === undefined) delete process.env["SELFWRIGHT_PUBLISH_CHECK_HOOK"];
    else process.env["SELFWRIGHT_PUBLISH_CHECK_HOOK"] = ORIG;
  });

  it("returns false when the env var is unset", () => {
    delete process.env["SELFWRIGHT_PUBLISH_CHECK_HOOK"];
    expect(isOptIn()).toBe(false);
  });

  it("returns true when set to '1'", () => {
    process.env["SELFWRIGHT_PUBLISH_CHECK_HOOK"] = "1";
    expect(isOptIn()).toBe(true);
  });

  it("returns false when set to '0'", () => {
    process.env["SELFWRIGHT_PUBLISH_CHECK_HOOK"] = "0";
    expect(isOptIn()).toBe(false);
  });

  it("returns false when set to 'true' (only '1' is accepted)", () => {
    process.env["SELFWRIGHT_PUBLISH_CHECK_HOOK"] = "true";
    expect(isOptIn()).toBe(false);
  });

  it("returns false when set to an empty string", () => {
    process.env["SELFWRIGHT_PUBLISH_CHECK_HOOK"] = "";
    expect(isOptIn()).toBe(false);
  });
});

// ── isAcknowledged ────────────────────────────────────────────────────────────

describe("isAcknowledged — SELFWRIGHT_PUBLISH_ACK gate", () => {
  const ORIG = process.env["SELFWRIGHT_PUBLISH_ACK"];
  afterEach(() => {
    if (ORIG === undefined) delete process.env["SELFWRIGHT_PUBLISH_ACK"];
    else process.env["SELFWRIGHT_PUBLISH_ACK"] = ORIG;
  });

  it("returns false when the env var is unset", () => {
    delete process.env["SELFWRIGHT_PUBLISH_ACK"];
    expect(isAcknowledged()).toBe(false);
  });

  it("returns true when set to '1'", () => {
    process.env["SELFWRIGHT_PUBLISH_ACK"] = "1";
    expect(isAcknowledged()).toBe(true);
  });

  it("returns false when set to '0'", () => {
    process.env["SELFWRIGHT_PUBLISH_ACK"] = "0";
    expect(isAcknowledged()).toBe(false);
  });

  it("returns false for any value other than '1'", () => {
    process.env["SELFWRIGHT_PUBLISH_ACK"] = "yes";
    expect(isAcknowledged()).toBe(false);
  });
});

// ── parseClaudeSpawnOutcome ───────────────────────────────────────────────────
// Exercises all four outcome branches with synthetic SpawnResult shapes so the
// timeout / signal path is covered without invoking the real `claude` CLI.

describe("parseClaudeSpawnOutcome — success", () => {
  it("returns success when status is 0, no error, no signal", () => {
    const outcome = parseClaudeSpawnOutcome({
      stdout: "PUBLISH-CHECK: CLEAN",
      stderr: "",
      status: 0,
      signal: null,
    });
    expect(outcome).toEqual({ kind: "success", output: "PUBLISH-CHECK: CLEAN" });
  });
});

describe("parseClaudeSpawnOutcome — spawn-error (CLI unavailable)", () => {
  it("returns spawn-error when error is set (e.g., ENOENT — binary not found)", () => {
    const outcome = parseClaudeSpawnOutcome({
      stdout: "",
      stderr: "",
      status: null,
      signal: null,
      error: new Error("spawn ENOENT"),
    });
    expect(outcome).toEqual({ kind: "spawn-error", message: "spawn ENOENT" });
  });

  it("prefers spawn-error over signal when both are set", () => {
    // Some platforms may set both on a forced-kill; error wins so the message is clear.
    const outcome = parseClaudeSpawnOutcome({
      stdout: "",
      stderr: "",
      status: null,
      signal: "SIGTERM",
      error: new Error("spawn ENOMEM"),
    });
    expect(outcome).toEqual({ kind: "spawn-error", message: "spawn ENOMEM" });
  });
});

describe("parseClaudeSpawnOutcome — timeout (BLOCKER fix)", () => {
  it("returns timeout when signal is set and no error is present", () => {
    // spawnSync sets result.signal = 'SIGTERM' when the timeout fires.
    const outcome = parseClaudeSpawnOutcome({
      stdout: "",
      stderr: "",
      status: null,
      signal: "SIGTERM",
    });
    expect(outcome).toEqual({ kind: "timeout", signal: "SIGTERM" });
  });

  it("handles SIGKILL (Windows / forced kill) as a timeout", () => {
    const outcome = parseClaudeSpawnOutcome({
      stdout: "",
      stderr: "",
      status: null,
      signal: "SIGKILL",
    });
    expect(outcome).toEqual({ kind: "timeout", signal: "SIGKILL" });
  });
});

describe("parseClaudeSpawnOutcome — exit-error (non-zero exit)", () => {
  it("returns exit-error with the stderr and status code", () => {
    const outcome = parseClaudeSpawnOutcome({
      stdout: "",
      stderr: "authentication required",
      status: 1,
      signal: null,
    });
    expect(outcome).toEqual({ kind: "exit-error", status: 1, stderr: "authentication required" });
  });

  it("uses status -1 when status is null without signal or error (defensive)", () => {
    // This combination should not occur in practice, but the function handles it cleanly.
    const outcome = parseClaudeSpawnOutcome({
      stdout: "",
      stderr: "",
      status: null,
      signal: null,
    });
    expect(outcome).toEqual({ kind: "exit-error", status: -1, stderr: "" });
  });
});
