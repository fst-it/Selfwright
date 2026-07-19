import { describe, expect, it } from "vitest";
import { isGeneratedFilePath, normalizeHookPath, truthTraceFast, danglingEvidenceFast } from "./checks.js";

describe("normalizeHookPath", () => {
  it("returns empty string unchanged", () => {
    expect(normalizeHookPath("")).toBe("");
  });

  it("leaves an already-relative forward-slash path unchanged", () => {
    expect(normalizeHookPath("packages/core/src/index.ts")).toBe("packages/core/src/index.ts");
  });

  it("converts backslashes to forward slashes in relative paths", () => {
    expect(normalizeHookPath("packages\\core\\src\\index.ts")).toBe(
      "packages/core/src/index.ts",
    );
  });

  it("makes a Unix absolute path relative to the given cwd", () => {
    const result = normalizeHookPath(
      "/home/user/repo/packages/core/src/index.ts",
      "/home/user/repo",
    );
    expect(result).toBe("packages/core/src/index.ts");
  });

  it("makes a Windows-style absolute path (forward slashes) relative to cwd", () => {
    const result = normalizeHookPath(
      "C:/dev/Selfwright/packages/core/src/index.ts",
      "C:/dev/Selfwright",
    );
    expect(result).toBe("packages/core/src/index.ts");
  });

  it("normalizes backslashes in the relative result", () => {
    const result = normalizeHookPath(
      "/home/user/repo/tools/src/hooks/fast-verify.ts",
      "/home/user/repo",
    );
    expect(result).not.toContain("\\");
  });

  it("does not detect a relative path starting with a letter as absolute", () => {
    // e.g. 'apps/cli/src/index.ts' should not be treated as absolute
    expect(normalizeHookPath("apps/cli/src/index.ts")).toBe("apps/cli/src/index.ts");
  });
});

describe("isGeneratedFilePath", () => {
  it("blocks top-level dist/ paths", () => {
    expect(isGeneratedFilePath("dist/index.js")).toBe(true);
    expect(isGeneratedFilePath("dist/hooks/session-start.js")).toBe(true);
  });

  // B-1 fix: nested dist/ paths must also be blocked (not just top-level).
  // The old pattern /^dist\// would miss "apps/dist/index.js".
  it("blocks nested dist/ paths (B-1 fix)", () => {
    expect(isGeneratedFilePath("apps/dist/index.js")).toBe(true);
    expect(isGeneratedFilePath("packages/core/dist/index.js")).toBe(true);
    expect(isGeneratedFilePath("tools/dist/hooks/fast-verify.js")).toBe(true);
  });

  it("blocks cv-tailored.json anywhere in the tree", () => {
    expect(isGeneratedFilePath("apps/cli/cv-tailored.json")).toBe(true);
    expect(isGeneratedFilePath("cv-tailored.json")).toBe(true);
  });

  it("blocks .pdf files", () => {
    expect(isGeneratedFilePath("output/resume.pdf")).toBe(true);
    expect(isGeneratedFilePath("Felipe-CV.PDF")).toBe(true);
  });

  it("blocks .docx files", () => {
    expect(isGeneratedFilePath("output/cover.docx")).toBe(true);
    expect(isGeneratedFilePath("LETTER.DOCX")).toBe(true);
  });

  it("blocks top-level reports/ paths", () => {
    expect(isGeneratedFilePath("reports/usage.jsonl")).toBe(true);
    expect(isGeneratedFilePath("reports/fit-2026.md")).toBe(true);
  });

  // B-1 fix: nested reports/ paths must also be blocked.
  it("blocks nested reports/ paths (B-1 fix)", () => {
    expect(isGeneratedFilePath("packages/tools/reports/out.txt")).toBe(true);
    expect(isGeneratedFilePath("apps/reports/summary.json")).toBe(true);
  });

  it("allows normal source paths", () => {
    expect(isGeneratedFilePath("packages/core/src/index.ts")).toBe(false);
    expect(isGeneratedFilePath("tools/src/hooks/checks.ts")).toBe(false);
    expect(isGeneratedFilePath("docs/README.md")).toBe(false);
    expect(isGeneratedFilePath("apps/cli/src/index.ts")).toBe(false);
  });

  it("does not block paths that merely contain 'dist' as a word", () => {
    expect(isGeneratedFilePath("docs/distribution-plan.md")).toBe(false);
  });
});

describe("truthTraceFast", () => {
  it("returns empty array for clean content with no bare numbers", () => {
    const content = "This file has no numbers at all.";
    expect(truthTraceFast(content)).toEqual([]);
  });

  it("warns on a bare year without EVD reference", () => {
    const content = "Joined Globex in 2019.";
    const warnings = truthTraceFast(content);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("does not warn when year has EVD reference on same line", () => {
    const content = "Led a team from 2019 (EVD-LEAD-01).";
    expect(truthTraceFast(content)).toEqual([]);
  });

  it("warns on bare percentage without EVD reference", () => {
    const content = "Improved latency by 40%.";
    const warnings = truthTraceFast(content);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("does not warn when percentage has EVD reference", () => {
    const content = "Improved latency by 40% (EVD-PERF-02).";
    expect(truthTraceFast(content)).toEqual([]);
  });

  it("warns on bare dollar amount without EVD reference", () => {
    const content = "Managed a budget of $5,000,000.";
    const warnings = truthTraceFast(content);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("does not warn when dollar amount has EVD reference", () => {
    const content = "Managed a budget of $5,000,000 (EVD-BUDGET-03).";
    expect(truthTraceFast(content)).toEqual([]);
  });

  it("returns at most one warning per line", () => {
    const content = "In 2020 we earned $1,000,000 and improved by 30%.";
    const warnings = truthTraceFast(content);
    expect(warnings.length).toBe(1);
  });

  it("handles multi-line content", () => {
    const content = [
      "Clean line.",
      "In 2019 we launched (EVD-LAUNCH-01).",
      "Revenue grew 50% with no reference.",
    ].join("\n");
    const warnings = truthTraceFast(content);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("line 3");
  });
});

describe("danglingEvidenceFast", () => {
  it("returns empty array when no EVD references in content", () => {
    const content = "No evidence references here.";
    const registry = new Set(["EVD-A-01"]);
    expect(danglingEvidenceFast(content, registry)).toEqual([]);
  });

  it("returns empty array when all EVD refs exist in registry", () => {
    const content = "Supported by (EVD-A-01) and EVD-B-02.";
    const registry = new Set(["EVD-A-01", "EVD-B-02"]);
    expect(danglingEvidenceFast(content, registry)).toEqual([]);
  });

  it("warns on EVD ref not in registry", () => {
    const content = "See EVD-MISSING-99 for details.";
    const registry = new Set(["EVD-A-01"]);
    const warnings = danglingEvidenceFast(content, registry);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("EVD-MISSING-99");
  });

  it("de-duplicates multiple occurrences of the same dangling ref", () => {
    const content = "EVD-MISSING-99 mentioned twice, EVD-MISSING-99 again.";
    const registry = new Set<string>();
    const warnings = danglingEvidenceFast(content, registry);
    expect(warnings.length).toBe(1);
  });

  it("handles empty registry gracefully", () => {
    const content = "EVD-A-01 is here.";
    const registry = new Set<string>();
    const warnings = danglingEvidenceFast(content, registry);
    expect(warnings.length).toBe(1);
  });

  it("only warns on the unknown refs, not the known ones", () => {
    const content = "EVD-KNOWN-01 and EVD-UNKNOWN-99.";
    const registry = new Set(["EVD-KNOWN-01"]);
    const warnings = danglingEvidenceFast(content, registry);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("EVD-UNKNOWN-99");
    expect(warnings[0]).not.toContain("EVD-KNOWN-01");
  });
});
