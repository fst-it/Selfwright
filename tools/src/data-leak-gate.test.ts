import { afterEach, describe, expect, it } from "vitest";
import {
  escapeRegex,
  findDataPathViolations,
  findPiiViolationsInContent,
  isNamedEntityScannableFile,
  isScannableFile,
  loadConfidentialPatterns,
  scanContentForPii,
  BASE_PII_PATTERNS,
} from "./data-leak-gate.js";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("findDataPathViolations", () => {
  it("flags files under data/", () => {
    expect(findDataPathViolations(["data/secret.md"])).toEqual(["data/secret.md"]);
  });

  it("flags nested data/ paths", () => {
    expect(findDataPathViolations(["data/truth/identity.yml"])).toEqual([
      "data/truth/identity.yml",
    ]);
  });

  it("does not flag non-data paths", () => {
    expect(findDataPathViolations(["packages/core/src/index.ts"])).toEqual([]);
  });

  it("does not flag paths that merely start with 'data'", () => {
    expect(findDataPathViolations(["data-extra/file.ts", "database/schema.sql"])).toEqual([]);
  });

  it("handles empty staged file list", () => {
    expect(findDataPathViolations([])).toEqual([]);
  });

  it("flags mixed: data/ and clean files — returns only violations", () => {
    const result = findDataPathViolations(["src/index.ts", "data/secret.md", "README.md"]);
    expect(result).toEqual(["data/secret.md"]);
  });

  it("flags Data/ with capital D (Windows case-insensitive filesystem)", () => {
    expect(findDataPathViolations(["Data/secret.md"])).toEqual(["Data/secret.md"]);
  });

  it("flags DATA/ uppercase", () => {
    expect(findDataPathViolations(["DATA/truth/identity.yml"])).toEqual(["DATA/truth/identity.yml"]);
  });
});

describe("isScannableFile", () => {
  it("excludes data/ paths", () => {
    expect(isScannableFile("data/truth/identity.yml")).toBe(false);
  });

  it("excludes test/spec files", () => {
    expect(isScannableFile("src/foo.test.ts")).toBe(false);
    expect(isScannableFile("src/foo.spec.ts")).toBe(false);
    expect(isScannableFile("src/foo.test.js")).toBe(false);
    expect(isScannableFile("src/foo.spec.js")).toBe(false);
  });

  it("excludes .d.ts declaration files", () => {
    expect(isScannableFile("dist/index.d.ts")).toBe(false);
  });

  it("excludes lockfiles", () => {
    expect(isScannableFile("pnpm-lock.yaml")).toBe(false);
    expect(isScannableFile("package-lock.json")).toBe(false);
    expect(isScannableFile("yarn.lock")).toBe(false);
  });

  it("excludes nested lockfiles (full relative path from git ls-files)", () => {
    expect(isScannableFile("infra/evidence/package-lock.json")).toBe(false);
    expect(isScannableFile("some/nested/pnpm-lock.yaml")).toBe(false);
  });

  it("excludes binary image and font files (text PII regex produces false positives on binary data)", () => {
    expect(isScannableFile("docs/brand/logo.png")).toBe(false);
    expect(isScannableFile("docs/brand/icon.jpg")).toBe(false);
    expect(isScannableFile("public/font.woff2")).toBe(false);
  });

  it("includes docs/, .claude/, and root files (the confirmed CI gap)", () => {
    expect(isScannableFile("docs/adr/0007-scanner.md")).toBe(true);
    expect(isScannableFile(".claude/skills/scan/SKILL.md")).toBe(true);
    expect(isScannableFile("README.md")).toBe(true);
  });

  it("includes ordinary framework source files", () => {
    expect(isScannableFile("packages/core/src/index.ts")).toBe(true);
  });
});

describe("isNamedEntityScannableFile", () => {
  it("excludes data/ paths", () => {
    expect(isNamedEntityScannableFile("data/truth/identity.yml")).toBe(false);
  });

  it("INCLUDES test/spec files — unlike isScannableFile, a confidential name in a test", () => {
    // fixture leaks exactly like one in source (ADR 0017 §1 test-file hole closure).
    expect(isNamedEntityScannableFile("src/foo.test.ts")).toBe(true);
    expect(isNamedEntityScannableFile("src/foo.spec.ts")).toBe(true);
    expect(isNamedEntityScannableFile("src/foo.test.js")).toBe(true);
    expect(isNamedEntityScannableFile("src/foo.spec.js")).toBe(true);
  });

  it("excludes .d.ts declaration files", () => {
    expect(isNamedEntityScannableFile("dist/index.d.ts")).toBe(false);
  });

  it("excludes lockfiles", () => {
    expect(isNamedEntityScannableFile("pnpm-lock.yaml")).toBe(false);
    expect(isNamedEntityScannableFile("package-lock.json")).toBe(false);
    expect(isNamedEntityScannableFile("yarn.lock")).toBe(false);
  });

  it("excludes nested lockfiles (full relative path from git ls-files)", () => {
    expect(isNamedEntityScannableFile("infra/evidence/package-lock.json")).toBe(false);
    expect(isNamedEntityScannableFile("some/nested/pnpm-lock.yaml")).toBe(false);
  });

  it("includes ordinary framework source files", () => {
    expect(isNamedEntityScannableFile("packages/core/src/index.ts")).toBe(true);
  });
});

describe("escapeRegex", () => {
  it("escapes special regex characters", () => {
    expect(escapeRegex("John (Doe)")).toBe("John \\(Doe\\)");
    expect(escapeRegex("J.Smith")).toBe("J\\.Smith");
    expect(escapeRegex("name+surname")).toBe("name\\+surname");
  });
});

describe("findPiiViolationsInContent", () => {
  it("returns empty array when no patterns provided", () => {
    const contents = new Map([["src/index.ts", "const salary = 100000;"]]);
    expect(findPiiViolationsInContent(contents, [])).toEqual([]);
  });

  it("detects matching PII pattern", () => {
    const contents = new Map([["src/index.ts", "compensation: $95000"]]);
    const violations = findPiiViolationsInContent(contents, BASE_PII_PATTERNS);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.file).toBe("src/index.ts");
  });

  it("detects international phone number in content", () => {
    const contents = new Map([["docs/contact.md", "Call me at +44 7700 900123"]]);
    const violations = findPiiViolationsInContent(contents, BASE_PII_PATTERNS);
    expect(violations.length).toBeGreaterThan(0);
  });

  it("does not flag clean framework content", () => {
    const contents = new Map([
      ["packages/core/src/index.ts", "export type { LlmPort } from './ports/llm.js';"],
      ["README.md", "# Selfwright — open-core career OS"],
    ]);
    expect(findPiiViolationsInContent(contents, BASE_PII_PATTERNS)).toEqual([]);
  });

  it("detects confidential name from custom patterns", () => {
    const contents = new Map([["src/referrals.ts", "Contact: Alice Referrer via LinkedIn"]]);
    const customPatterns = [/\bAlice Referrer\b/gi];
    const violations = findPiiViolationsInContent(contents, customPatterns);
    expect(violations.length).toBeGreaterThan(0);
  });

  it("reports only one violation per file even if multiple patterns match", () => {
    const contents = new Map([
      ["src/bad.ts", "phone +44 7700 900123 and salary: $95000"],
    ]);
    const violations = findPiiViolationsInContent(contents, BASE_PII_PATTERNS);
    expect(violations.length).toBe(1);
  });

  it("detects email address in content", () => {
    const contents = new Map([["src/contacts.ts", "const recruiter = 'alice@example.com';"]]);
    const violations = findPiiViolationsInContent(contents, BASE_PII_PATTERNS);
    expect(violations.length).toBeGreaterThan(0);
  });
});

describe("loadConfidentialPatterns", () => {
  afterEach(() => {
    delete process.env["SELFWRIGHT_CONFIDENTIAL_NAMES"];
  });

  it("returns empty array when local file does not exist and no env var is set", () => {
    const patterns = loadConfidentialPatterns("/nonexistent/path");
    expect(patterns).toEqual([]);
  });

  it("falls back to SELFWRIGHT_CONFIDENTIAL_NAMES env var when no local file exists", () => {
    process.env["SELFWRIGHT_CONFIDENTIAL_NAMES"] = "Alice Referrer\nBob Manager";
    const patterns = loadConfidentialPatterns("/nonexistent/path");
    expect(patterns).toHaveLength(2);
    expect(patterns[0]?.test("Alice Referrer was helpful")).toBe(true);
  });

  it("prefers the local file over the env var when both are present", () => {
    process.env["SELFWRIGHT_CONFIDENTIAL_NAMES"] = "EnvOnlyName";
    const dir = join(tmpdir(), `selfwright-gate-test-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".confidential-names.local"), "LocalName\n");
    try {
      const patterns = loadConfidentialPatterns(dir);
      expect(patterns).toHaveLength(1);
      expect(patterns[0]?.test("LocalName")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns regexp patterns from local confidential-names file", () => {
    const dir = join(tmpdir(), `selfwright-gate-test-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".confidential-names.local"), "Alice Referrer\nBob Manager\n");
    try {
      const patterns = loadConfidentialPatterns(dir);
      expect(patterns).toHaveLength(2);
      expect(patterns[0]?.test("Alice Referrer was helpful")).toBe(true);
      expect(patterns[1]?.test("Bob Manager approved")).toBe(true);
      expect(patterns[0]?.test("no match here")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips blank lines in confidential-names file", () => {
    const dir = join(tmpdir(), `selfwright-gate-test-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".confidential-names.local"), "Alice\n\nBob\n\n");
    try {
      const patterns = loadConfidentialPatterns(dir);
      expect(patterns).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("confidential pattern matches consistently across multiple files (no g-flag lastIndex drift)", () => {
    const dir = join(tmpdir(), `selfwright-gate-test-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".confidential-names.local"), "Alice Referrer\n");
    try {
      const patterns = loadConfidentialPatterns(dir);
      const pat = patterns[0];
      expect(pat).toBeDefined();
      expect(pat?.test("Alice Referrer was mentioned")).toBe(true);
      expect(pat?.test("Also Alice Referrer here")).toBe(true);
      expect(pat?.test("Alice Referrer again")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("scanContentForPii", () => {
  // Padding note: use "=" (not alphanumeric) so the email regex
  // /[a-zA-Z0-9...]+@.../ fails immediately at each position rather than
  // greedily matching the entire padding string and backtracking — which would
  // make a 200 KB test string take >5 s.
  const SAFE_PADDING_CHAR = "=";

  it("returns false for empty patterns list", () => {
    expect(scanContentForPii("contact@example.com", [])).toBe(false);
  });

  it("catches PII in a small string (below CHUNK_SIZE)", () => {
    expect(scanContentForPii("call me at +44 7700 900123", BASE_PII_PATTERNS)).toBe(true);
  });

  it("returns false for clean small content", () => {
    expect(scanContentForPii("const x = 42;", BASE_PII_PATTERNS)).toBe(false);
  });

  it("catches PII in content larger than 200 000 chars — beyond the old skip threshold", () => {
    // Email address embedded after 201 000 non-alphanumeric chars (past the old 200 KB limit).
    const padding = SAFE_PADDING_CHAR.repeat(201_000);
    const large = `${padding} admin@selfwright.example`;
    expect(scanContentForPii(large, BASE_PII_PATTERNS)).toBe(true);
  });

  it("returns false for large clean content", () => {
    const large = SAFE_PADDING_CHAR.repeat(201_000);
    expect(scanContentForPii(large, BASE_PII_PATTERNS)).toBe(false);
  });

  it("catches PII near the chunk boundary (overlap window ensures coverage)", () => {
    // PII starts just before the first chunk boundary (offset 199 995) so only
    // part of it is in chunk 0; the overlap window puts the full match in chunk 1.
    const prefix = SAFE_PADDING_CHAR.repeat(199_995);
    const pii = "a@b.com"; // short email, 7 chars
    const suffix = SAFE_PADDING_CHAR.repeat(5_000);
    const content = prefix + pii + suffix;
    expect(scanContentForPii(content, BASE_PII_PATTERNS)).toBe(true);
  });
});

describe("findPiiViolationsInContent — large file coverage (no silent skip)", () => {
  it("scans content larger than 200 000 chars and catches embedded PII", () => {
    const padding = "=".repeat(201_000);
    const contents = new Map([["src/large-fixture.ts", `${padding} alice@example.com`]]);
    const violations = findPiiViolationsInContent(contents, BASE_PII_PATTERNS);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.file).toBe("src/large-fixture.ts");
  });
});
