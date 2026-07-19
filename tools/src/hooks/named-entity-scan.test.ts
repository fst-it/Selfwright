// Tests use ONLY synthetic company/person names in fixtures (never a real confidential
// name) — this is the exact leak the scanner exists to prevent (ADR 0017).
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isNamedEntityScannableFile } from "../data-leak-gate.js";
import {
  buildNamedEntityPatterns,
  deriveConfidentialTerms,
  extractDriftTerms,
  extractGenericTerms,
  extractIdentifierRunTokenSets,
  extractIdentifierSubTokens,
  extractIdentityOwnName,
  extractIdentityTerms,
  findNamedEntityViolations,
  loadAdditionalConfidentialNames,
  loadAllowlist,
  matchGlob,
  parsePrePushRefs,
  resolveDataDir,
  validateAllowlistInvariant,
} from "./named-entity-scan.js";

function tmpDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${String(Date.now())}-${String(Math.random()).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ── resolveDataDir — fail-closed ────────────────────────────────────────────────
describe("resolveDataDir", () => {
  const ORIGINAL_ENV = process.env["SELFWRIGHT_DATA_DIR"];
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env["SELFWRIGHT_DATA_DIR"];
    else process.env["SELFWRIGHT_DATA_DIR"] = ORIGINAL_ENV;
  });

  it("fails closed when SELFWRIGHT_DATA_DIR is unset and no sibling exists", () => {
    delete process.env["SELFWRIGHT_DATA_DIR"];
    const isolatedRoot = tmpDir("selfwright-repo-root");
    try {
      const result = resolveDataDir(isolatedRoot);
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/fail|SELFWRIGHT_DATA_DIR/i);
    } finally {
      rmSync(isolatedRoot, { recursive: true, force: true });
    }
  });

  it("uses SELFWRIGHT_DATA_DIR when set and it exists", () => {
    const dataDir = tmpDir("selfwright-data-env");
    try {
      process.env["SELFWRIGHT_DATA_DIR"] = dataDir;
      const result = resolveDataDir("/nonexistent/repo/root");
      expect(result.ok).toBe(true);
      expect(result.dir).toBe(dataDir);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("fails closed when SELFWRIGHT_DATA_DIR is set but does not exist", () => {
    process.env["SELFWRIGHT_DATA_DIR"] = "/definitely/does/not/exist/selfwright-data";
    const result = resolveDataDir("/nonexistent/repo/root");
    expect(result.ok).toBe(false);
  });

  it("falls back to the conventional sibling ../Selfwright-data", () => {
    delete process.env["SELFWRIGHT_DATA_DIR"];
    const parent = tmpDir("selfwright-parent");
    const repoRoot = join(parent, "Selfwright");
    const siblingData = join(parent, "Selfwright-data");
    mkdirSync(repoRoot, { recursive: true });
    mkdirSync(siblingData, { recursive: true });
    try {
      const result = resolveDataDir(repoRoot);
      expect(result.ok).toBe(true);
      expect(result.dir).toBe(siblingData);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

// ── term extraction (pure, over parsed docs) ────────────────────────────────────
describe("extractIdentityTerms", () => {
  it("extracts every roles_timeline company but NOT the top-level name (owner-name exemption)", () => {
    const doc = {
      name: "Zorblatt Fenwick",
      roles_timeline: [
        { company: "Wobbleton Corp", title: "Engineer" },
        { company: "Grentz Industries", title: "Lead" },
      ],
    };
    const terms = extractIdentityTerms(doc);
    expect(terms).toEqual(expect.arrayContaining(["Wobbleton Corp", "Grentz Industries"]));
    expect(terms).not.toContain("Zorblatt Fenwick");
  });

  it("returns empty array for null/malformed doc", () => {
    expect(extractIdentityTerms(null)).toEqual([]);
    expect(extractIdentityTerms(undefined)).toEqual([]);
    expect(extractIdentityTerms("not an object")).toEqual([]);
  });
});

describe("extractIdentityOwnName", () => {
  it("extracts the top-level name field", () => {
    expect(extractIdentityOwnName({ name: "Zorblatt Fenwick" })).toBe("Zorblatt Fenwick");
  });

  it("returns undefined for null/malformed doc or missing name", () => {
    expect(extractIdentityOwnName(null)).toBeUndefined();
    expect(extractIdentityOwnName(undefined)).toBeUndefined();
    expect(extractIdentityOwnName("not an object")).toBeUndefined();
    expect(extractIdentityOwnName({ roles_timeline: [] })).toBeUndefined();
  });
});

describe("extractGenericTerms", () => {
  it("extracts top-level company field", () => {
    expect(extractGenericTerms({ company: "Plinkwater Logistics" })).toContain(
      "Plinkwater Logistics",
    );
  });

  it("recursively extracts name-like keys (contact_name, hiring_manager, referrer_name)", () => {
    const doc = {
      company: "Quexbell Holdings",
      contact: { contact_name: "Marla Quimble" },
      hiring_manager: "Dorian Fenwick",
      referrer_name: "Silas Grentz",
    };
    const terms = extractGenericTerms(doc);
    expect(terms).toEqual(
      expect.arrayContaining(["Quexbell Holdings", "Marla Quimble", "Dorian Fenwick", "Silas Grentz"]),
    );
  });

  it("does not extract unrelated keys", () => {
    const doc = { title: "Senior Engineer", status: "applied" };
    expect(extractGenericTerms(doc)).toEqual([]);
  });
});

describe("extractDriftTerms", () => {
  it("extracts filename stem and company field", () => {
    expect(extractDriftTerms({ company: "Blorptech Global" }, "blorptech")).toEqual(
      expect.arrayContaining(["blorptech", "Blorptech Global"]),
    );
  });
});

// ── deriveConfidentialTerms — full synthetic data-dir fixture ──────────────────
describe("deriveConfidentialTerms", () => {
  it("derives terms from a synthetic Selfwright-data-shaped directory", () => {
    const dataDir = tmpDir("selfwright-data-fixture");
    try {
      mkdirSync(join(dataDir, "truth"), { recursive: true });
      writeFileSync(
        join(dataDir, "truth", "identity.yml"),
        "name: Zorblatt Fenwick\nroles_timeline:\n  - { company: Wobbleton Corp, title: Engineer }\n",
      );

      mkdirSync(join(dataDir, "applications"), { recursive: true });
      writeFileSync(
        join(dataDir, "applications", "app-1.yml"),
        "company: Quexbell Holdings\nhiring_manager: Dorian Fenwick\n",
      );

      mkdirSync(join(dataDir, "contacts"), { recursive: true });
      writeFileSync(join(dataDir, "contacts", "c-1.yml"), "name: Marla Quimble\ncompany: Plinkwater Logistics\n");

      mkdirSync(join(dataDir, "drifts", "companies"), { recursive: true });
      writeFileSync(join(dataDir, "drifts", "companies", "blorptech.yml"), "company: Blorptech Global\n");

      mkdirSync(join(dataDir, "positioning"), { recursive: true });
      writeFileSync(join(dataDir, "positioning", "lane.yml"), "company: Nizzleworth Inc\n");

      const terms = deriveConfidentialTerms(dataDir);
      expect(terms).toEqual(
        expect.arrayContaining([
          "Wobbleton Corp",
          "Quexbell Holdings",
          "Dorian Fenwick",
          "Marla Quimble",
          "Plinkwater Logistics",
          "blorptech",
          "Blorptech Global",
          "Nizzleworth Inc",
        ]),
      );
      // Owner-name exemption: identity.yml's top-level `name` must never enter the
      // derived confidential-name set (it's the owner's own authorship identity).
      expect(terms).not.toContain("Zorblatt Fenwick");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("tolerates missing subdirectories and malformed YAML without crashing", () => {
    const dataDir = tmpDir("selfwright-data-sparse");
    try {
      // No truth/, applications/, etc. at all.
      expect(() => deriveConfidentialTerms(dataDir)).not.toThrow();
      expect(deriveConfidentialTerms(dataDir)).toEqual([]);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("skips a malformed YAML file with a warning rather than crashing", () => {
    const dataDir = tmpDir("selfwright-data-malformed");
    try {
      mkdirSync(join(dataDir, "contacts"), { recursive: true });
      writeFileSync(join(dataDir, "contacts", "bad.yml"), "{ unclosed");
      expect(() => deriveConfidentialTerms(dataDir)).not.toThrow();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  // End-to-end proof of the owner-name exemption (ADR 0017 §1): a file naming the owner
  // (e.g. a LICENSE-style copyright line) must scan clean, while a file naming a
  // third-party past employer from the same identity.yml must still be blocked.
  it("end-to-end: owner's own name is not flagged, a roles_timeline company still is", () => {
    const dataDir = tmpDir("selfwright-data-e2e");
    try {
      mkdirSync(join(dataDir, "truth"), { recursive: true });
      writeFileSync(
        join(dataDir, "truth", "identity.yml"),
        "name: Zorblatt Fenwick\nroles_timeline:\n  - { company: Wobbleton Corp, title: Engineer }\n",
      );

      const terms = deriveConfidentialTerms(dataDir);
      const patterns = buildNamedEntityPatterns(terms);

      const ownNameFile = new Map([
        ["LICENSE", "Copyright (c) 2026 Zorblatt Fenwick. All rights reserved."],
      ]);
      expect(findNamedEntityViolations(ownNameFile, patterns)).toEqual([]);

      const thirdPartyFile = new Map([
        ["docs/example.md", "Interviewed with a recruiter from Wobbleton Corp last week."],
      ]);
      expect(findNamedEntityViolations(thirdPartyFile, patterns)).toEqual([
        { file: "docs/example.md" },
      ]);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

// ── pattern building: multi-word phrase + single-token + common-word exclusion ─
describe("buildNamedEntityPatterns", () => {
  it("builds a full-phrase pattern for a multi-word name with flexible internal punctuation", () => {
    const [pattern] = buildNamedEntityPatterns(["Zorblatt Fenwick"]);
    expect(pattern).toBeDefined();
    expect(pattern?.regex.test("Contact Zorblatt Fenwick about the role")).toBe(true);
    expect(pattern?.regex.test("Contact Zorblatt, Fenwick about the role")).toBe(true);
    expect(pattern?.regex.test("Contact Zorblatt-Fenwick about the role")).toBe(true);
  });

  it("builds a flexible-punctuation pattern for a dotted company name (with dot separator)", () => {
    const [pattern] = buildNamedEntityPatterns(["Blorptech.io"]);
    expect(pattern?.regex.test("Applied via Blorptech.io careers page")).toBe(true);
    expect(pattern?.regex.test("Applied via Blorptech io careers page")).toBe(true);
  });

  it("matches an unusual single-token company name (>= 4 chars, not a common word) on its own", () => {
    const [pattern] = buildNamedEntityPatterns(["Zorblatt"]);
    expect(pattern).toBeDefined();
    expect(pattern?.regex.test("We interviewed at Zorblatt last week")).toBe(true);
  });

  it("does NOT match a common single-token word on its own even if it is a derived term", () => {
    // "booking" is in the bundled common-word list — a job-board mention must not trip it.
    const patterns = buildNamedEntityPatterns(["booking"]);
    expect(patterns).toEqual([]);
  });

  it("does NOT match a common first name on its own", () => {
    const patterns = buildNamedEntityPatterns(["Jane"]);
    expect(patterns).toEqual([]);
  });

  it("does NOT generate a single-token pattern for a term shorter than 4 chars", () => {
    const patterns = buildNamedEntityPatterns(["Sap"]);
    expect(patterns).toEqual([]);
  });

  it("ignores blank/whitespace-only terms", () => {
    expect(buildNamedEntityPatterns(["", "   "])).toEqual([]);
  });
});

// ── identifier tokenization (ADR 0017 §1 addendum) — closes the \b-word-boundary blind
// spot where a confidential single-token name is embedded inside a programming identifier
// (snake_case, camelCase, SCREAMING_SNAKE_CASE) and so has no true word boundary around it.
describe("extractIdentifierSubTokens", () => {
  it("splits a snake_case identifier into its component sub-tokens", () => {
    expect(extractIdentifierSubTokens("zorblatt_specific: z.boolean()")).toEqual(
      new Set(["zorblatt", "specific", "z", "boolean"]),
    );
  });

  it("splits a camelCase identifier at the lower-to-upper transition", () => {
    const tokens = extractIdentifierSubTokens("const zorblattSpecific = false;");
    expect(tokens.has("zorblatt")).toBe(true);
    expect(tokens.has("specific")).toBe(true);
  });

  it("splits a SCREAMING_SNAKE_CASE identifier", () => {
    const tokens = extractIdentifierSubTokens("EVD_ZORBLATT_POSITIONPNL");
    expect(tokens.has("zorblatt")).toBe(true);
    expect(tokens.has("evd")).toBe(true);
    expect(tokens.has("positionpnl")).toBe(true);
  });

  it("returns an empty set for content with no identifier-shaped runs", () => {
    expect(extractIdentifierSubTokens("   ...   ")).toEqual(new Set());
  });
});

// ── per-run token sets (multi-word identifier-embedded matching) ───────────────
describe("extractIdentifierRunTokenSets", () => {
  it("keeps sub-tokens from different identifier runs in separate sets", () => {
    const sets = extractIdentifierRunTokenSets("thistledownWebhook aeroworksClientId");
    expect(sets).toHaveLength(2);
    expect(sets[0]?.has("thistledown")).toBe(true);
    expect(sets[0]?.has("aeroworks")).toBe(false);
    expect(sets[1]?.has("aeroworks")).toBe(true);
    expect(sets[1]?.has("thistledown")).toBe(false);
  });

  it("groups all sub-tokens of a single camelCase run into one set", () => {
    const sets = extractIdentifierRunTokenSets("thistledownAeroworksWebhookUrl");
    expect(sets).toHaveLength(1);
    expect(sets[0]).toEqual(new Set(["thistledown", "aeroworks", "webhook", "url"]));
  });

  it("returns an empty array for content with no identifier-shaped runs", () => {
    expect(extractIdentifierRunTokenSets("   ...   ")).toEqual([]);
  });
});

describe("findNamedEntityViolations — identifier-embedded names", () => {
  it("catches a single-token confidential name embedded in a snake_case identifier", () => {
    const patterns = buildNamedEntityPatterns(["Zorblatt"]);
    const contents = new Map([
      ["packages/core/src/schema.ts", "  zorblatt_specific: z.boolean().default(false),"],
    ]);
    expect(findNamedEntityViolations(contents, patterns)).toEqual([
      { file: "packages/core/src/schema.ts" },
    ]);
  });

  it("catches a single-token confidential name embedded in a camelCase identifier", () => {
    const patterns = buildNamedEntityPatterns(["Zorblatt"]);
    const contents = new Map([
      ["packages/core/src/schema.ts", "const zorblattSpecific = false;"],
    ]);
    expect(findNamedEntityViolations(contents, patterns)).toEqual([
      { file: "packages/core/src/schema.ts" },
    ]);
  });

  it("catches a single-token confidential name embedded in a SCREAMING_SNAKE_CASE identifier", () => {
    const patterns = buildNamedEntityPatterns(["Zorblatt"]);
    const contents = new Map([
      ["packages/core/src/schema.ts", "const EVD_ZORBLATT = 'evidence-id';"],
    ]);
    expect(findNamedEntityViolations(contents, patterns)).toEqual([
      { file: "packages/core/src/schema.ts" },
    ]);
  });

  it("does NOT flag an ordinary identifier with no blocklist name embedded in it", () => {
    const patterns = buildNamedEntityPatterns(["Zorblatt"]);
    const contents = new Map([
      ["packages/core/src/schema.ts", "const evidenceIdsSpecific = [];"],
    ]);
    expect(findNamedEntityViolations(contents, patterns)).toEqual([]);
  });

  it("does NOT flag a multi-word term when only ONE of its component words is embedded", () => {
    // "Zorblatt Fenwick" requires BOTH "zorblatt" and "fenwick" to co-occur in the same
    // identifier run — an identifier containing only "zorblatt" must not trip it (avoids
    // false positives on an unrelated identifier that merely shares one common fragment).
    const patterns = buildNamedEntityPatterns(["Zorblatt Fenwick"]);
    const contents = new Map([
      ["packages/core/src/schema.ts", "const zorblatt_specific = false;"],
    ]);
    expect(findNamedEntityViolations(contents, patterns)).toEqual([]);
  });

  it("catches a two-word confidential term embedded as camelCase (all words in the same run)", () => {
    const patterns = buildNamedEntityPatterns(["Thistledown Aeroworks"]);
    const contents = new Map([
      ["packages/adapters/webhook/src/config.ts", "const thistledownAeroworksWebhookUrl = env.URL;"],
    ]);
    expect(findNamedEntityViolations(contents, patterns)).toEqual([
      { file: "packages/adapters/webhook/src/config.ts" },
    ]);
  });

  it("catches a two-word confidential term embedded as suffixed snake_case", () => {
    const patterns = buildNamedEntityPatterns(["Thistledown Aeroworks"]);
    const contents = new Map([
      ["packages/adapters/webhook/src/config.ts", "const thistledown_aeroworks_webhook_url = env.URL;"],
    ]);
    expect(findNamedEntityViolations(contents, patterns)).toEqual([
      { file: "packages/adapters/webhook/src/config.ts" },
    ]);
  });

  it("catches a two-word confidential term embedded as SCREAMING_SNAKE_CASE", () => {
    const patterns = buildNamedEntityPatterns(["Thistledown Aeroworks"]);
    const contents = new Map([
      ["packages/adapters/webhook/src/config.ts", "const THISTLEDOWN_AEROWORKS_WEBHOOK_URL = 1;"],
    ]);
    expect(findNamedEntityViolations(contents, patterns)).toEqual([
      { file: "packages/adapters/webhook/src/config.ts" },
    ]);
  });

  it("does NOT flag an identifier containing only one of a two-word term's component words", () => {
    const patterns = buildNamedEntityPatterns(["Thistledown Aeroworks"]);
    const contents = new Map([
      ["packages/adapters/webhook/src/config.ts", "const thistledownWebhookUrl = env.URL;"],
    ]);
    expect(findNamedEntityViolations(contents, patterns)).toEqual([]);
  });

  it("does NOT flag an identifier when the two words appear in DIFFERENT identifier runs", () => {
    // "all words present in the same run" is the floor — two separate identifiers that
    // each carry one component word must not combine into a false positive.
    const patterns = buildNamedEntityPatterns(["Thistledown Aeroworks"]);
    const contents = new Map([
      [
        "packages/adapters/webhook/src/config.ts",
        "const thistledownRegion = 1;\nconst aeroworksClientId = 2;",
      ],
    ]);
    expect(findNamedEntityViolations(contents, patterns)).toEqual([]);
  });

  it("leaves ordinary identifiers with no blocklist words embedded unaffected", () => {
    const patterns = buildNamedEntityPatterns(["Thistledown Aeroworks"]);
    const contents = new Map([
      ["packages/adapters/webhook/src/config.ts", "const webhookClientIdForRegion = 1;"],
    ]);
    expect(findNamedEntityViolations(contents, patterns)).toEqual([]);
  });

  it("still respects the allowlist for a multi-word identifier-embedded match", () => {
    const patterns = buildNamedEntityPatterns(["Thistledown Aeroworks"]);
    const contents = new Map([
      ["packages/adapters/webhook/src/config.ts", "const thistledownAeroworksWebhookUrl = env.URL;"],
    ]);
    const allowlist = [
      { term: "Thistledown Aeroworks", path: "packages/adapters/webhook/**", reason: "test allowlist" },
    ];
    expect(findNamedEntityViolations(contents, patterns, allowlist)).toEqual([]);
  });

  it("regression: an old-style <company>_specific leak pattern is now caught (synthetic equivalent)", () => {
    // Reproduces, with a synthetic name, the exact shape that slipped past the scanner
    // before this fix: a confidential single-token company name baked into a Zod schema
    // field via snake_case (`<company>_specific`).
    const patterns = buildNamedEntityPatterns(["Zorblatt"]);
    const contents = new Map([
      [
        "packages/core/src/truth/schemas/gaps.ts",
        "  zorblatt_specific: z.boolean().default(false),",
      ],
    ]);
    expect(findNamedEntityViolations(contents, patterns)).toEqual([
      { file: "packages/core/src/truth/schemas/gaps.ts" },
    ]);
  });

  it("still respects the allowlist for an identifier-embedded match", () => {
    const patterns = buildNamedEntityPatterns(["Zorblatt"]);
    const contents = new Map([
      ["packages/core/src/schema.ts", "const zorblatt_specific = false;"],
    ]);
    const allowlist = [
      { term: "Zorblatt", path: "packages/core/src/**", reason: "test allowlist" },
    ];
    expect(findNamedEntityViolations(contents, patterns, allowlist)).toEqual([]);
  });
});

// ── test-file hole closure (ADR 0017 §1) — a real name in a test fixture leaks exactly
// like one in source, so this scanner (unlike the PII-regex isScannableFile) must NOT
// exempt .test.ts/.spec.ts. Proves both directions: a planted name in a test-file path
// IS caught, and the scanner's own synthetic (Zorblatt-style) fixtures do NOT self-trip.
describe("test files are scanned, not exempted (ADR 0017 §1)", () => {
  it("isNamedEntityScannableFile includes .test.ts/.spec.ts, unlike the PII-scan predicate", () => {
    expect(isNamedEntityScannableFile("packages/core/src/__tests__/foo.test.ts")).toBe(true);
    expect(isNamedEntityScannableFile("packages/core/src/__tests__/foo.spec.ts")).toBe(true);
  });

  it("catches a planted synthetic name whose file path is itself a .test.ts fixture", () => {
    const patterns = buildNamedEntityPatterns(["Wobbleton Corp"]);
    const contents = new Map([
      ["packages/core/src/__tests__/some-fixture.test.ts", 'company: "Wobbleton Corp"'],
    ]);
    expect(findNamedEntityViolations(contents, patterns)).toEqual([
      { file: "packages/core/src/__tests__/some-fixture.test.ts" },
    ]);
  });

  it("the scanner's own synthetic-name fixtures (Zorblatt, Wobbleton, ...) do not self-trip", () => {
    // Real confidential terms would never include these — this only proves that IF this
    // very file were scanned (it now would be), its own synthetic fixture data is clean
    // against a representative real-shaped term, i.e. nothing here coincidentally collides.
    const patterns = buildNamedEntityPatterns(["Acme Real Employer Inc"]);
    const contents = new Map([
      [
        "tools/src/hooks/named-entity-scan.test.ts",
        'const doc = { name: "Zorblatt Fenwick", roles_timeline: [{ company: "Wobbleton Corp" }] };',
      ],
    ]);
    expect(findNamedEntityViolations(contents, patterns)).toEqual([]);
  });
});

// ── scanning — never exposes the matched term, only the file path ──────────────
describe("findNamedEntityViolations", () => {
  it("catches a planted synthetic name in a staged framework file — reports path, not the name", () => {
    const patterns = buildNamedEntityPatterns(["Zorblatt Fenwick"]);
    const contents = new Map([["docs/example.md", "Reach out to Zorblatt Fenwick for details."]]);
    const violations = findNamedEntityViolations(contents, patterns);
    expect(violations).toEqual([{ file: "docs/example.md" }]);
    // The violation object must carry only a path — assert no other key could leak the term.
    expect(Object.keys(violations[0] as object)).toEqual(["file"]);
  });

  it("does not flag clean content", () => {
    const patterns = buildNamedEntityPatterns(["Zorblatt Fenwick"]);
    const contents = new Map([["README.md", "This is an ordinary framework document."]]);
    expect(findNamedEntityViolations(contents, patterns)).toEqual([]);
  });

  it("reports only one violation per file even with multiple matching patterns", () => {
    const patterns = buildNamedEntityPatterns(["Zorblatt Fenwick", "Wobbleton"]);
    const contents = new Map([
      ["docs/example.md", "Zorblatt Fenwick works at Wobbleton now."],
    ]);
    expect(findNamedEntityViolations(contents, patterns)).toHaveLength(1);
  });

  it("skips a match covered by the allowlist for that exact (term, path)", () => {
    const patterns = buildNamedEntityPatterns(["booking-style-term-that-is-long-enough"]);
    // Force a single-token pattern deterministically via a >=4-char uncommon term.
    const contents = new Map([["packages/core/src/scanning/liveness.ts", "booking-style-term-that-is-long-enough concept"]]);
    const allowlist = [
      {
        term: "booking-style-term-that-is-long-enough",
        path: "packages/core/src/scanning/**",
        reason: "test",
      },
    ];
    expect(findNamedEntityViolations(contents, patterns, allowlist)).toEqual([]);
  });

  it("does not apply an allowlist entry to a non-matching path", () => {
    const patterns = buildNamedEntityPatterns(["booking-style-term-that-is-long-enough"]);
    const contents = new Map([["docs/cover-letter-fixture.md", "booking-style-term-that-is-long-enough concept"]]);
    const allowlist = [
      {
        term: "booking-style-term-that-is-long-enough",
        path: "packages/core/src/scanning/**",
        reason: "test",
      },
    ];
    expect(findNamedEntityViolations(contents, patterns, allowlist)).toEqual([{ file: "docs/cover-letter-fixture.md" }]);
  });
});

// ── allowlist — dictionary-word invariant ───────────────────────────────────────
describe("validateAllowlistInvariant", () => {
  it("passes when every allowlist term is a common dictionary word", () => {
    const result = validateAllowlistInvariant([
      { term: "booking", path: "packages/core/src/scanning/**", reason: "job-board concept" },
    ]);
    expect(result.valid).toBe(true);
    expect(result.invalidTerms).toEqual([]);
  });

  it("FAILS when an allowlist term is not a dictionary word (a unique name can never be allowlisted)", () => {
    const result = validateAllowlistInvariant([
      { term: "Zorblatt", path: "docs/**", reason: "attempted bypass" },
    ]);
    expect(result.valid).toBe(false);
    expect(result.invalidTerms).toEqual(["Zorblatt"]);
  });

  it("passes on an empty allowlist", () => {
    expect(validateAllowlistInvariant([]).valid).toBe(true);
  });
});

describe("loadAllowlist", () => {
  it("returns empty array when .confidential-allowlist.yml does not exist", () => {
    expect(loadAllowlist("/nonexistent/repo/root")).toEqual([]);
  });

  it("parses a committed allowlist file", () => {
    const dir = tmpDir("selfwright-allowlist");
    try {
      writeFileSync(
        join(dir, ".confidential-allowlist.yml"),
        "entries:\n  - term: booking\n    path: \"packages/core/src/scanning/**\"\n    reason: \"job-board concept\"\n",
      );
      const entries = loadAllowlist(dir);
      expect(entries).toEqual([
        { term: "booking", path: "packages/core/src/scanning/**", reason: "job-board concept" },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns empty array for malformed allowlist YAML rather than throwing", () => {
    const dir = tmpDir("selfwright-allowlist-bad");
    try {
      writeFileSync(join(dir, ".confidential-allowlist.yml"), "{ unclosed");
      expect(() => loadAllowlist(dir)).not.toThrow();
      expect(loadAllowlist(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── glob matcher ─────────────────────────────────────────────────────────────
describe("matchGlob", () => {
  it("matches ** as any depth", () => {
    expect(matchGlob("packages/core/src/scanning/**", "packages/core/src/scanning/liveness.ts")).toBe(true);
    expect(matchGlob("packages/core/src/scanning/**", "packages/core/src/scanning/nested/deep.ts")).toBe(true);
  });

  it("does not match outside the glob scope", () => {
    expect(matchGlob("packages/core/src/scanning/**", "docs/cover-letter-fixture.md")).toBe(false);
  });

  it("normalizes backslashes so Windows paths match forward-slash globs", () => {
    expect(matchGlob("packages/core/src/scanning/**", "packages\\core\\src\\scanning\\liveness.ts")).toBe(true);
  });
});

// ── additive override — .confidential-names.local / env var ────────────────────
describe("loadAdditionalConfidentialNames", () => {
  const ORIGINAL_ENV = process.env["SELFWRIGHT_CONFIDENTIAL_NAMES"];
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env["SELFWRIGHT_CONFIDENTIAL_NAMES"];
    else process.env["SELFWRIGHT_CONFIDENTIAL_NAMES"] = ORIGINAL_ENV;
  });

  it("returns empty array when neither source is present", () => {
    delete process.env["SELFWRIGHT_CONFIDENTIAL_NAMES"];
    expect(loadAdditionalConfidentialNames("/nonexistent/path")).toEqual([]);
  });

  it("reads raw names from the env var as a fallback", () => {
    process.env["SELFWRIGHT_CONFIDENTIAL_NAMES"] = "Zorblatt Fenwick\nWobbleton Corp";
    expect(loadAdditionalConfidentialNames("/nonexistent/path")).toEqual([
      "Zorblatt Fenwick",
      "Wobbleton Corp",
    ]);
  });
});

// ── pre-push ref parsing (git pre-push stdin protocol) ──────────────────────────
describe("parsePrePushRefs", () => {
  it("parses a single ref line", () => {
    const input =
      "refs/heads/main abc123def456 refs/heads/main 0000000000000000000000000000000000000000\n";
    expect(parsePrePushRefs(input)).toEqual([
      { localSha: "abc123def456", remoteSha: "0000000000000000000000000000000000000000" },
    ]);
  });

  it("filters out an all-zero local sha (branch deletion)", () => {
    const input =
      "refs/heads/gone 0000000000000000000000000000000000000000 refs/heads/gone abc123\n";
    expect(parsePrePushRefs(input)).toEqual([]);
  });

  it("parses multiple ref lines", () => {
    const input = [
      "refs/heads/a sha-a refs/heads/a remote-a",
      "refs/heads/b sha-b refs/heads/b remote-b",
    ].join("\n");
    expect(parsePrePushRefs(input)).toEqual([
      { localSha: "sha-a", remoteSha: "remote-a" },
      { localSha: "sha-b", remoteSha: "remote-b" },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(parsePrePushRefs("")).toEqual([]);
  });
});
