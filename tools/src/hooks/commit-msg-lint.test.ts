import { describe, it, expect } from "vitest";
import { lintCommitMessage } from "./commit-msg-lint.js";

describe("lintCommitMessage — valid conventional commits", () => {
  it.each([
    ["feat: add new feature", "simple feat"],
    ["fix(core): resolve null deref", "fix with scope"],
    ["docs(adr): ADR 0020 scoring vocabulary", "docs with scope"],
    ["chore: update deps", "chore"],
    ["refactor(scoring): extract vocabulary", "refactor with scope"],
    ["test(mcp): add debrief tests", "test with scope"],
    ["perf(scan): improve dedup", "perf with scope"],
    ["build: upgrade typescript", "build"],
    ["ci: add matrix strategy", "ci"],
    ["style: fix lint warnings", "style"],
    ["revert: revert feat(core): prior commit", "revert"],
    ["feat!: breaking change", "feat with !"],
    ["feat(web,fitness): dashboard write actions", "scope with comma"],
    ["fix(core/scoring): fix sub-path scope", "scope with slash"],
    ["fix(cli,tools): scheduled scan", "scope with dash and comma"],
    ["feat(core): trailing detail fine", "long description"],
  ])("accepts %s (%s)", (msg) => {
    expect(lintCommitMessage(msg)).toEqual({ ok: true });
  });
});

describe("lintCommitMessage — Merge commits allowed", () => {
  it.each([
    "Merge branch 'main' into feat/phase4-kickoff",
    "Merge pull request #25 from owner/feat/phase3",
    "Merge remote-tracking branch 'origin/main'",
  ])("allows: %s", (msg) => {
    expect(lintCommitMessage(msg)).toEqual({ ok: true });
  });
});

describe("lintCommitMessage — comment stripping", () => {
  it("skips git comment lines to find the subject", () => {
    const msg = [
      "# This is a comment added by git",
      "# Please enter the commit message...",
      "",
      "feat: actual commit message",
      "",
      "# Changes to be committed:",
      "#   modified: foo.ts",
    ].join("\n");
    expect(lintCommitMessage(msg)).toEqual({ ok: true });
  });

  it("ignores blank lines before the subject", () => {
    const msg = "\n\nfix(core): blank lines above\n";
    expect(lintCommitMessage(msg)).toEqual({ ok: true });
  });
});

describe("lintCommitMessage — rejected messages", () => {
  it("rejects empty message (only whitespace)", () => {
    const r = lintCommitMessage("   \n  \n");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("empty");
  });

  it("rejects message with only git comment lines", () => {
    const r = lintCommitMessage("# comment only\n# another comment\n");
    expect(r.ok).toBe(false);
  });

  it.each([
    ["WIP: work in progress", "WIP prefix"],
    ["Phase 3: coaching engine", "descriptive PR summary"],
    ["T2.6/T2.7/T2.8: Ollama", "version-range prefix"],
    ["add feature", "no type prefix"],
    ["Fix bug in core", "capitalized Fix without colon pattern"],
    ["FEAT: uppercase type", "uppercase type"],
    ["feat : space before colon", "space before colon"],
    ["feat(UPPERCASE): scopes must be lowercase", "uppercase scope"],
    ["feat(): empty scope", "empty scope"],
  ])("rejects %s (%s)", (msg) => {
    const r = lintCommitMessage(msg);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("type");
    }
  });
});
