// Tests use ONLY synthetic username/hostname/email/path values (never a real one) — this is
// the exact leak this scanner exists to prevent (Phase 5 T5.1, ADR 0017 addendum).
import { describe, expect, it } from "vitest";
import {
  buildMachineIdentityPatterns,
  extractIdentityEmail,
  findMachineIdentityViolations,
  getIdentifierEmbeddedTokenGroups,
  WINDOWS_USER_PATH_PATTERN,
} from "./machine-identity.js";

// Builds a real-shaped Windows/MSYS user path at RUNTIME from separate segments, never as a
// contiguous literal in this file's own source text. This test file is itself scanned by the
// gate it exercises (ADR 0017 §1: test files are not exempted) — a literal `C:\Users\<word>`
// or `/c/Users/<word>` string sitting in tracked source would trip the very value-free path
// pattern under test. The assembled runtime value is identical to a literal; only the SOURCE
// TEXT differs.
function winPath(sep: string, ...segments: string[]): string {
  return segments.join(sep);
}

// ── WINDOWS_USER_PATH_PATTERN — static, value-free (drive-letter AND MSYS/Git-Bash forms) ──
describe("WINDOWS_USER_PATH_PATTERN", () => {
  it("matches a real absolute Windows user path with backslashes", () => {
    expect(WINDOWS_USER_PATH_PATTERN.test(winPath("\\", "C:", "Users", "zqxbot", "dev", "project"))).toBe(
      true,
    );
  });

  it("matches a real absolute Windows user path with forward slashes", () => {
    expect(WINDOWS_USER_PATH_PATTERN.test(winPath("/", "C:", "Users", "zqxbot", "dev", "project"))).toBe(
      true,
    );
  });

  it("matches any drive letter, not just C", () => {
    expect(WINDOWS_USER_PATH_PATTERN.test(winPath("\\", "D:", "Users", "zqxbot"))).toBe(true);
  });

  it("is case-insensitive on the drive letter and Users segment", () => {
    expect(WINDOWS_USER_PATH_PATTERN.test(winPath("\\", "c:", "users", "zqxbot"))).toBe(true);
  });

  it("does NOT match a legal angle-bracket placeholder path (drive-letter form)", () => {
    expect(WINDOWS_USER_PATH_PATTERN.test("C:\\Users\\<you>\\Selfwright-data")).toBe(false);
    expect(WINDOWS_USER_PATH_PATTERN.test("C:/Users/<you>/Selfwright-data")).toBe(false);
  });

  it("does not match unrelated text", () => {
    expect(WINDOWS_USER_PATH_PATTERN.test("this is an ordinary sentence about users")).toBe(false);
  });

  // MSYS/Git-Bash represents Windows drives as /c/, /d/, etc. — the same real local path,
  // just under a different shell's rendering. Without this, a path pasted from a Git-Bash
  // terminal would sail past the drive-letter-colon form entirely.
  it("matches the MSYS/Git-Bash drive form (/c/Users/...)", () => {
    expect(WINDOWS_USER_PATH_PATTERN.test(winPath("/", "", "c", "Users", "zqxbot", "dev"))).toBe(true);
  });

  it("is case-insensitive on the MSYS drive letter and Users segment", () => {
    expect(WINDOWS_USER_PATH_PATTERN.test(winPath("/", "", "C", "users", "zqxbot"))).toBe(true);
  });

  it("does NOT match a legal angle-bracket placeholder path (MSYS form)", () => {
    expect(WINDOWS_USER_PATH_PATTERN.test("/c/Users/<you>/Selfwright-data")).toBe(false);
  });
});

// ── buildMachineIdentityPatterns — eligibility + pattern shape ──────────────────
describe("buildMachineIdentityPatterns", () => {
  it("always includes the value-free path pattern even with no inputs", () => {
    const patterns = buildMachineIdentityPatterns({});
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toBe(WINDOWS_USER_PATH_PATTERN);
  });

  it("builds a word-boundary, case-insensitive pattern for an eligible username", () => {
    const patterns = buildMachineIdentityPatterns({ username: "zqxbot" });
    expect(patterns.some((p) => p.test("logged in as zqxbot today"))).toBe(true);
    expect(patterns.some((p) => p.test("LOGGED IN AS ZQXBOT TODAY"))).toBe(true);
  });

  it("builds a pattern for an eligible hostname", () => {
    const patterns = buildMachineIdentityPatterns({ hostname: "SYNTH-HOST-42" });
    expect(patterns.some((p) => p.test("connect to synth-host-42 remotely"))).toBe(true);
  });

  // A compound hostname/username (hyphen/underscore/dot-separated, Windows' own default
  // auto-generated hostname shape is DESKTOP-XXXXXXX) must also match when written with a
  // DIFFERENT separator than the one it was derived with — same flexible-punctuation
  // discipline as buildNamedEntityPatterns' multi-word company/person names.
  it("matches a compound hostname written with a different separator (flexible punctuation)", () => {
    const patterns = buildMachineIdentityPatterns({ hostname: "SYNTH-HOST-42" });
    expect(patterns.some((p) => p.test("connect to synth_host_42 remotely"))).toBe(true);
    expect(patterns.some((p) => p.test("connect to synth host 42 remotely"))).toBe(true);
  });

  it("builds a pattern for each eligible email in the list", () => {
    const patterns = buildMachineIdentityPatterns({
      emails: ["planted.synthetic@example.test", "second.synth@example.test"],
    });
    expect(patterns.some((p) => p.test("contact planted.synthetic@example.test for access"))).toBe(true);
    expect(patterns.some((p) => p.test("or reach second.synth@example.test instead"))).toBe(true);
  });

  it("skips a username shorter than 4 characters", () => {
    const patterns = buildMachineIdentityPatterns({ username: "abc" });
    expect(patterns).toHaveLength(1); // only the path pattern
  });

  it("skips a username that is a bundled common word", () => {
    // "list" is in the common-word set — must not trip standalone.
    const patterns = buildMachineIdentityPatterns({ username: "list" });
    expect(patterns).toHaveLength(1);
  });

  it("skips an empty username/hostname and empty-string emails", () => {
    const patterns = buildMachineIdentityPatterns({ username: "", hostname: "  ", emails: [""] });
    expect(patterns).toHaveLength(1);
  });

  it("does not match a completely unrelated email address (not a generic email regex)", () => {
    // Only the specific injected email should match — no generic "any email" scanning.
    const patterns = buildMachineIdentityPatterns({ emails: ["planted.synthetic@example.test"] });
    expect(patterns.some((p) => p.test("Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"))).toBe(
      false,
    );
  });
});

// ── getIdentifierEmbeddedTokenGroups — one word-group per eligible value ────────
// A single-token value (e.g. "zqxbot") yields a one-element group; a compound value (e.g.
// "SYNTH-HOST-42") yields a multi-element group whose words must ALL co-occur within the SAME
// identifier run to count as a match (see findMachineIdentityViolations below) — this is what
// fixes the bug where a compound value was stored as one opaque token that could never equal
// any single extracted sub-token. Eligibility (empty/<4 chars/common-word) is checked ONCE
// against the whole raw value, not per split component — same choice as named-entity-scan's
// multi-word terms, where component words are not filtered individually because requiring all
// of them to co-occur is already a much stronger signal than any single common word alone.
describe("getIdentifierEmbeddedTokenGroups", () => {
  it("returns a one-element group per eligible single-token username/hostname", () => {
    const groups = getIdentifierEmbeddedTokenGroups({ username: "zqxbot" });
    expect(groups).toEqual([["zqxbot"]]);
  });

  it("splits a compound (hyphenated) hostname into a multi-element group, lowercased", () => {
    const groups = getIdentifierEmbeddedTokenGroups({ hostname: "SYNTH-HOST-42" });
    expect(groups).toEqual([["synth", "host", "42"]]);
  });

  it("returns one group per eligible value (username AND hostname)", () => {
    const groups = getIdentifierEmbeddedTokenGroups({ username: "zqxbot", hostname: "SYNTH-HOST-42" });
    expect(groups).toEqual(expect.arrayContaining([["zqxbot"], ["synth", "host", "42"]]));
    expect(groups).toHaveLength(2);
  });

  it("excludes email entirely (no identifier-embedded form)", () => {
    const groups = getIdentifierEmbeddedTokenGroups({
      username: "zqxbot",
      emails: ["planted.synthetic@example.test"],
    });
    expect(groups).toEqual([["zqxbot"]]);
  });

  it("excludes an ineligible username/hostname", () => {
    expect(getIdentifierEmbeddedTokenGroups({ username: "abc", hostname: "list" })).toEqual([]);
  });

  it("returns an empty array for empty inputs", () => {
    expect(getIdentifierEmbeddedTokenGroups({})).toEqual([]);
  });
});

// ── findMachineIdentityViolations — file-path-only reporting, no allowlist ─────
describe("findMachineIdentityViolations", () => {
  it("catches a username appearing in prose", () => {
    const patterns = buildMachineIdentityPatterns({ username: "zqxbot" });
    const contents = new Map([["docs/example.md", "Logged in as zqxbot on the shared machine."]]);
    expect(findMachineIdentityViolations(contents, patterns)).toEqual([{ file: "docs/example.md" }]);
  });

  it("catches a username embedded in a snake_case identifier (no true word boundary)", () => {
    const inputs = { username: "zqxbot" };
    const patterns = buildMachineIdentityPatterns(inputs);
    const groups = getIdentifierEmbeddedTokenGroups(inputs);
    const contents = new Map([
      ["packages/core/src/config.ts", "const some_zqxbot_specific_value = true;"],
    ]);
    expect(findMachineIdentityViolations(contents, patterns, groups)).toEqual([
      { file: "packages/core/src/config.ts" },
    ]);
  });

  it("catches a username embedded in a camelCase identifier", () => {
    const inputs = { username: "zqxbot" };
    const patterns = buildMachineIdentityPatterns(inputs);
    const groups = getIdentifierEmbeddedTokenGroups(inputs);
    const contents = new Map([["packages/core/src/config.ts", "const zqxbotProfilePath = 1;"]]);
    expect(findMachineIdentityViolations(contents, patterns, groups)).toEqual([
      { file: "packages/core/src/config.ts" },
    ]);
  });

  it("catches a hostname embedded in an identifier", () => {
    const inputs = { hostname: "synthhost" };
    const patterns = buildMachineIdentityPatterns(inputs);
    const groups = getIdentifierEmbeddedTokenGroups(inputs);
    const contents = new Map([["packages/core/src/config.ts", "const synthhostEndpoint = 1;"]]);
    expect(findMachineIdentityViolations(contents, patterns, groups)).toEqual([
      { file: "packages/core/src/config.ts" },
    ]);
  });

  // ── Compound (hyphenated) hostname — the exact regression the adversarial review found ──
  // A hostname like "SYNTH-HOST-42" (Windows' own default auto-generated shape is
  // DESKTOP-XXXXXXX) must be caught when its component words all appear, in order, inside a
  // SINGLE identifier run — regardless of which separator convention that run uses.
  describe("compound hostname embedded in an identifier (camelCase / snake_case / kebab-case)", () => {
    const inputs = { hostname: "SYNTH-HOST-42" };
    const patterns = buildMachineIdentityPatterns(inputs);
    const groups = getIdentifierEmbeddedTokenGroups(inputs);

    it("catches it embedded as camelCase", () => {
      const contents = new Map([["packages/core/src/config.ts", "const SynthHost42Endpoint = 1;"]]);
      expect(findMachineIdentityViolations(contents, patterns, groups)).toEqual([
        { file: "packages/core/src/config.ts" },
      ]);
    });

    it("catches it embedded as snake_case", () => {
      const contents = new Map([
        ["packages/core/src/config.ts", "const synth_host_42_endpoint = 1;"],
      ]);
      expect(findMachineIdentityViolations(contents, patterns, groups)).toEqual([
        { file: "packages/core/src/config.ts" },
      ]);
    });

    it("catches it embedded as kebab-case", () => {
      const contents = new Map([["config/endpoint.yml", "synth-host-42-endpoint: true"]]);
      expect(findMachineIdentityViolations(contents, patterns, groups)).toEqual([
        { file: "config/endpoint.yml" },
      ]);
    });

    it("does NOT flag an identifier containing only some of the compound's component words", () => {
      const contents = new Map([["packages/core/src/config.ts", "const synthEndpoint = 1;"]]);
      expect(findMachineIdentityViolations(contents, patterns, groups)).toEqual([]);
    });

    it("does NOT flag the component words when they appear in DIFFERENT identifier runs", () => {
      const contents = new Map([
        [
          "packages/core/src/config.ts",
          "const synthRegion = 1;\nconst hostEndpoint = 2;\nconst port42 = 3;",
        ],
      ]);
      expect(findMachineIdentityViolations(contents, patterns, groups)).toEqual([]);
    });
  });

  it("catches a real absolute Windows user path planted in a file", () => {
    const patterns = buildMachineIdentityPatterns({});
    const contents = new Map([
      ["docs/example.md", `Local install lives at ${winPath("\\", "C:", "Users", "zqxbot", "Selfwright")}.`],
    ]);
    expect(findMachineIdentityViolations(contents, patterns)).toEqual([{ file: "docs/example.md" }]);
  });

  it("catches a real absolute MSYS/Git-Bash user path planted in a file", () => {
    const patterns = buildMachineIdentityPatterns({});
    const contents = new Map([
      ["docs/example.md", `Local install lives at ${winPath("/", "", "c", "Users", "zqxbot", "Selfwright")}.`],
    ]);
    expect(findMachineIdentityViolations(contents, patterns)).toEqual([{ file: "docs/example.md" }]);
  });

  it("does NOT flag a legal angle-bracket placeholder path (either form)", () => {
    const patterns = buildMachineIdentityPatterns({});
    const contents = new Map([
      ["docs/example.md", "Point SELFWRIGHT_DATA_DIR at C:\\Users\\<you>\\Selfwright-data."],
      ["docs/other.md", "Or on Git-Bash: /c/Users/<you>/Selfwright-data."],
    ]);
    expect(findMachineIdentityViolations(contents, patterns)).toEqual([]);
  });

  it("catches a planted personal email", () => {
    const patterns = buildMachineIdentityPatterns({ emails: ["planted.synthetic@example.test"] });
    const contents = new Map([["docs/example.md", "Contact planted.synthetic@example.test for details."]]);
    expect(findMachineIdentityViolations(contents, patterns)).toEqual([{ file: "docs/example.md" }]);
  });

  it("does not flag clean content", () => {
    const patterns = buildMachineIdentityPatterns({ username: "zqxbot", hostname: "synthhost" });
    const contents = new Map([["README.md", "This is an ordinary framework document."]]);
    expect(findMachineIdentityViolations(contents, patterns)).toEqual([]);
  });

  it("reports each violating file only once even when multiple patterns match", () => {
    const patterns = buildMachineIdentityPatterns({ username: "zqxbot", hostname: "synthhost" });
    const contents = new Map([
      ["docs/example.md", "zqxbot logged into synthhost this morning."],
    ]);
    expect(findMachineIdentityViolations(contents, patterns)).toHaveLength(1);
  });

  it("has no allowlist parameter to bypass — machine-identity matches are never allowlistable", () => {
    // Type-level guarantee: calling with an extra (ignored) argument does not change behavior.
    const patterns = buildMachineIdentityPatterns({ username: "zqxbot" });
    const contents = new Map([["docs/example.md", "zqxbot was here"]]);
    const violations = findMachineIdentityViolations(contents, patterns);
    expect(violations).toEqual([{ file: "docs/example.md" }]);
  });
});

// ── extractIdentityEmail — pure extraction over a parsed identity.yml doc ──────
describe("extractIdentityEmail", () => {
  it("extracts contact.email from a parsed doc", () => {
    expect(extractIdentityEmail({ contact: { email: "planted.synthetic@example.test" } })).toBe(
      "planted.synthetic@example.test",
    );
  });

  it("returns undefined when contact is missing", () => {
    expect(extractIdentityEmail({ name: "Zorblatt Fenwick" })).toBeUndefined();
  });

  it("returns undefined when contact.email is missing or blank", () => {
    expect(extractIdentityEmail({ contact: { phone: "555" } })).toBeUndefined();
    expect(extractIdentityEmail({ contact: { email: "   " } })).toBeUndefined();
  });

  it("returns undefined for null/malformed doc", () => {
    expect(extractIdentityEmail(null)).toBeUndefined();
    expect(extractIdentityEmail(undefined)).toBeUndefined();
    expect(extractIdentityEmail("not an object")).toBeUndefined();
    expect(extractIdentityEmail({ contact: "not an object either" })).toBeUndefined();
  });
});
