// FF-INPUT (ADR 0017 §3): the null-YAML-row class. Feeds core loaders/validators
// (TruthLoader's building blocks — yaml parsers, Zod schemas — plus sync-db row mapping,
// computeNorthStar, inboxService) null/empty/wrong-type/oversized/malformed inputs and
// asserts each rejects with a typed error (or, for the boolean sync-db type guards, safely
// returns false) — never an unhandled null-deref ("Cannot read properties of null").
// Synthetic inputs only; a property/fuzz test suite implemented as a fitness check function
// (the same shape as every other Tier-1 "self-test over synthetic fixtures" in this runner —
// see FF-TAILOR-1/2/3, FF-GEN-1, FF-SCAN-1/2, FF-DET-1, FF-FIT-1).
import { computeNorthStar, EvidenceEntrySchema, IdentitySchema, inboxService } from "@selfwright/core";
import { parseFrontMatter, parseYaml } from "@selfwright/adapter-storage-git";
import { isValidApplicationEntry, isValidFitnessRecord } from "@selfwright/tools";
import type { CheckResult } from "./shared.js";

const CHECK_NAME = "FF-INPUT: core loaders/validators reject malformed input with a typed error";

// Any thrown Error (TypeError, SyntaxError, ZodError, etc.) counts as "rejected with a
// typed error" — the property under test is "did not silently succeed or throw a bare
// non-Error value", not a specific subclass.
function assertThrows(label: string, fn: () => unknown, failures: string[]): void {
  try {
    fn();
    failures.push(`${label}: expected a throw, but the call succeeded`);
  } catch (err) {
    if (!(err instanceof Error)) {
      failures.push(`${label}: threw a non-Error value (${JSON.stringify(err)}) — not a typed error`);
    }
  }
}

function assertNoThrow(label: string, fn: () => unknown, failures: string[]): void {
  try {
    fn();
  } catch (err) {
    failures.push(`${label}: threw unexpectedly (${err instanceof Error ? err.message : String(err)})`);
  }
}

export function checkFuzzInput(): CheckResult {
  const failures: string[] = [];
  const OVERSIZED = "a".repeat(2_000_000);

  // ── computeNorthStar ────────────────────────────────────────────────────
  assertThrows("computeNorthStar(null)", () => computeNorthStar(null), failures);
  assertThrows(
    "computeNorthStar(undefined)",
    () => computeNorthStar(undefined),
    failures,
  );
  assertThrows("computeNorthStar({})", () => computeNorthStar({}), failures);
  assertNoThrow("computeNorthStar([]) — empty is valid", () => computeNorthStar([]), failures);
  assertNoThrow(
    "computeNorthStar([null, {}]) — isolates bad rows",
    () => computeNorthStar([null, {}] as unknown),
    failures,
  );

  // ── inboxService ────────────────────────────────────────────────────────
  assertThrows("inboxService(null)", () => inboxService(null), failures);
  assertThrows(
    "inboxService({}) — missing required array fields",
    () => inboxService({}),
    failures,
  );
  assertThrows(
    "inboxService(wrong-type applications)",
    () => inboxService({ applications: "x", queue: [], drifts: [] }),
    failures,
  );
  assertNoThrow(
    "inboxService(malformed row) — isolates bad rows",
    () => inboxService({ applications: [null], queue: [], drifts: [] }),
    failures,
  );

  // ── yaml parsers ────────────────────────────────────────────────────────
  assertThrows("parseYaml(null)", () => parseYaml(null), failures);
  assertThrows("parseYaml(undefined)", () => parseYaml(undefined), failures);
  assertThrows("parseYaml(42)", () => parseYaml(42), failures);
  assertThrows("parseYaml('{ unclosed') — malformed YAML", () => parseYaml("{ unclosed"), failures);
  assertNoThrow(
    "parseYaml(oversized) — must not hang or crash uncleanly",
    () => parseYaml(`key: "${OVERSIZED}"`),
    failures,
  );
  assertThrows("parseFrontMatter(null)", () => parseFrontMatter(null), failures);
  assertThrows("parseFrontMatter('') — no front-matter block", () => parseFrontMatter(""), failures);

  // ── Zod schemas ─────────────────────────────────────────────────────────
  assertThrows("IdentitySchema.parse(null)", () => IdentitySchema.parse(null), failures);
  assertThrows("IdentitySchema.parse({})", () => IdentitySchema.parse({}), failures);
  assertThrows(
    "IdentitySchema.parse(wrong types)",
    () => IdentitySchema.parse({ name: 123, years_experience: "seventeen" }),
    failures,
  );
  assertThrows("EvidenceEntrySchema.parse(null)", () => EvidenceEntrySchema.parse(null), failures);
  assertThrows("EvidenceEntrySchema.parse({})", () => EvidenceEntrySchema.parse({}), failures);

  // ── sync-db row mapping (boolean type guards — "reject" means safe false, no throw) ──
  assertNoThrow("isValidApplicationEntry(null)", () => isValidApplicationEntry(null), failures);
  if (isValidApplicationEntry(null)) failures.push("isValidApplicationEntry(null) should be false");
  if (isValidApplicationEntry(undefined)) {
    failures.push("isValidApplicationEntry(undefined) should be false");
  }
  assertNoThrow("isValidFitnessRecord(null)", () => isValidFitnessRecord(null), failures);
  if (isValidFitnessRecord(null)) failures.push("isValidFitnessRecord(null) should be false");
  if (isValidFitnessRecord({ results: "not-an-array" })) {
    failures.push("isValidFitnessRecord with non-array results should be false");
  }

  if (failures.length > 0) {
    return { name: CHECK_NAME, passed: false, details: failures.join("\n") };
  }
  return { name: CHECK_NAME, passed: true };
}
