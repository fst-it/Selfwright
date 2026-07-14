import { afterEach, describe, expect, it } from "vitest";
import { checkTextForPii } from "./check-text-for-pii.js";

describe("checkTextForPii", () => {
  afterEach(() => {
    delete process.env["SELFWRIGHT_CONFIDENTIAL_NAMES"];
  });

  it("passes clean text", () => {
    const result = checkTextForPii("commit message", "fix: tighten the scan-liveness regex", "/nonexistent");
    expect(result.ok).toBe(true);
  });

  it("does not apply BASE_PII_PATTERNS — a Co-Authored-By email trailer passes", () => {
    const result = checkTextForPii(
      "commit message",
      "fix: thing\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>",
      "/nonexistent",
    );
    expect(result.ok).toBe(true);
  });

  it("blocks text matching a confidential name from the env-var denylist", () => {
    process.env["SELFWRIGHT_CONFIDENTIAL_NAMES"] = "Alice Referrer";
    const result = checkTextForPii("commit message", "thanks Alice Referrer for the intro", "/nonexistent");
    expect(result.ok).toBe(false);
  });

  it("blocks a denylisted name found in PR title/body", () => {
    process.env["SELFWRIGHT_CONFIDENTIAL_NAMES"] = "Alice Referrer";
    const result = checkTextForPii("PR title/body", "Following up per Alice Referrer's intro", "/nonexistent");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("PR title/body");
  });

  // ── machine-identity (Phase 5 T5.1, ADR 0017 addendum) — synthetic values only ──
  describe("machine-identity check (injected, synthetic values)", () => {
    it("passes clean text when machineIdentity is provided", () => {
      const result = checkTextForPii(
        "commit message",
        "fix: tighten the scan-liveness regex",
        "/nonexistent",
        { username: "zqxbot", hostname: "SYNTH-HOST-42", emails: ["planted.synthetic@example.test"] },
      );
      expect(result.ok).toBe(true);
    });

    it("does not check machine-identity at all when the parameter is omitted", () => {
      const result = checkTextForPii(
        "commit message",
        "fix: thing involving zqxbot somehow",
        "/nonexistent",
      );
      expect(result.ok).toBe(true);
    });

    it("blocks a commit message containing the planted username", () => {
      const result = checkTextForPii(
        "commit message",
        "fix: rename the zqxbot profile directory",
        "/nonexistent",
        { username: "zqxbot" },
      );
      expect(result.ok).toBe(false);
    });

    it("blocks a commit message containing the planted hostname", () => {
      const result = checkTextForPii(
        "commit message",
        "fix: update config for SYNTH-HOST-42",
        "/nonexistent",
        { hostname: "SYNTH-HOST-42" },
      );
      expect(result.ok).toBe(false);
    });

    it("blocks a commit message containing the planted personal email", () => {
      const result = checkTextForPii(
        "commit message",
        "fix: notify planted.synthetic@example.test about the change",
        "/nonexistent",
        { emails: ["planted.synthetic@example.test"] },
      );
      expect(result.ok).toBe(false);
    });

    it("blocks a commit message containing a real-shaped C:\\Users\\ local path", () => {
      const result = checkTextForPii(
        "commit message",
        "fix: path was hardcoded as C:\\Users\\zqxbot\\dev\\Selfwright",
        "/nonexistent",
        {},
      );
      expect(result.ok).toBe(false);
    });

    it("does NOT block a legal angle-bracket placeholder path", () => {
      const result = checkTextForPii(
        "commit message",
        "docs: point SELFWRIGHT_DATA_DIR at C:\\Users\\<you>\\Selfwright-data",
        "/nonexistent",
        {},
      );
      expect(result.ok).toBe(true);
    });

    it("still passes a normal message with the standard Co-Authored-By trailer", () => {
      const result = checkTextForPii(
        "commit message",
        "fix: thing\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>",
        "/nonexistent",
        { username: "zqxbot", hostname: "SYNTH-HOST-42", emails: ["planted.synthetic@example.test"] },
      );
      expect(result.ok).toBe(true);
    });
  });
});
