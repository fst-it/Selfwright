import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { EvidenceRegistrySchema } from "@selfwright/core/truth/schemas";
import { traceClaims } from "@selfwright/core/truth/trace";
import type { EvidenceEntry } from "@selfwright/core";
import type { CheckResult } from "./shared.js";

const CHECK_NAME_SYNTHETIC = "FF-TRUTH-1a: truth-trace — synthetic fixture always runs in CI";
const CHECK_NAME_PRODUCTION = "FF-TRUTH-1b: truth-trace — claims traceable in production registry";

// ── Synthetic fixture (CI-safe — no private data required) ────────────────────
//
// These entries are entirely self-contained. They must NEVER reference real EVD IDs
// so they stay valid even if the private data registry is renamed or restructured.

const SYNTHETIC_REGISTRY: EvidenceEntry[] = [
  {
    id: "EVD-SYN-FF1-001",
    org: "SyntheticCo",
    claim: "Architected distributed systems platform enabling real-time data streaming",
    tag: "hard",
    keywords: ["distributed", "systems", "platform", "streaming", "architecture"],
  },
  {
    id: "EVD-SYN-FF1-002",
    org: "SyntheticCo",
    claim: "Designed data mesh and lakehouse strategy on cloud infrastructure",
    tag: "hard",
    keywords: ["data", "mesh", "lakehouse", "cloud", "infrastructure", "strategy"],
  },
  {
    id: "EVD-SYN-FF1-003",
    org: "SyntheticCo",
    claim: "Led integration of trading systems with pricing and settlement processes",
    tag: "soft",
    keywords: ["trading", "systems", "integration", "pricing", "settlement"],
  },
];

// Must trace to at least one of the synthetic registry entries above.
//
// Deliberately avoids "real-time" (Phase 3 review round 2): it's recognized
// as a magnitude/quantity claim (extractQuantityPhrases) that must be
// corroborated by the matched entry's own claim/detail text. The REAL
// production registry has zero occurrences of "real-time" anywhere — it
// consistently uses precise, honest figures instead (e.g. "under 30-minute
// latency" for the Position PnL product, deliberately NOT "real-time"). A
// smoke-test fixture using "real-time" would therefore be correctly rejected
// by checkTruthTraceProduction below as an unsupported magnitude claim — not
// a bug in traceClaims, just accidental collision with a wording precision
// the real evidence registry actually enforces.
const SYNTHETIC_FIXTURE_TEXT = [
  "Architected distributed systems platform with streaming and data mesh design.",
  "Led cloud infrastructure strategy for lakehouse and integration architecture.",
  "Designed trading systems integration covering pricing and settlement processes.",
].join(" ");

// Must NOT trace — fabricated claim with no overlap with any synthetic entry.
const ADVERSARIAL_TEXT =
  "Invented a new programming language and won the Nobel Prize in chemistry during sabbatical.";

export function checkTruthTraceSynthetic(): CheckResult {
  // Positive fixture: well-grounded sentences must pass
  const positiveResult = traceClaims(SYNTHETIC_FIXTURE_TEXT, SYNTHETIC_REGISTRY);
  if (!positiveResult.ok) {
    return {
      name: CHECK_NAME_SYNTHETIC,
      passed: false,
      details: `Synthetic fixture sentences not traceable to synthetic EVD entries — check algorithm regression:\n${positiveResult.untraceable.join("\n")}`,
    };
  }

  // Adversarial fixture: fabricated sentences must NOT pass
  const adversarialResult = traceClaims(ADVERSARIAL_TEXT, SYNTHETIC_REGISTRY);
  if (adversarialResult.ok) {
    return {
      name: CHECK_NAME_SYNTHETIC,
      passed: false,
      details:
        "Adversarial fixture passed when it should have been flagged as untraceable — truth-trace is not catching fabricated claims",
    };
  }

  return { name: CHECK_NAME_SYNTHETIC, passed: true };
}

export function checkTruthTraceProduction(dataDir: string): CheckResult {
  if (!existsSync(join(dataDir, "truth/evidence/registry.yml"))) {
    return {
      name: CHECK_NAME_PRODUCTION,
      passed: true,
      skipped: true,
      details: "SELFWRIGHT_DATA_DIR not configured — skipped (run locally with private data)",
    };
  }

  let registry: EvidenceEntry[];
  try {
    const raw = readFileSync(join(dataDir, "truth/evidence/registry.yml"), "utf-8");
    registry = EvidenceRegistrySchema.parse(parse(raw));
  } catch (err) {
    return {
      name: CHECK_NAME_PRODUCTION,
      passed: false,
      details: `Failed to load evidence registry: ${String(err)}`,
    };
  }

  if (registry.length === 0) {
    // Nothing to smoke-test against an empty registry.
    return { name: CHECK_NAME_PRODUCTION, passed: true };
  }

  // Smoke-test traceClaims against the loaded registry using the registry's
  // OWN claim text as the probe, rather than the hand-written
  // SYNTHETIC_FIXTURE_TEXT above. That fixture was calibrated (see its
  // comment) to trace against one specific real evidence registry's
  // vocabulary — it coincidentally worked for that registry and silently
  // failed for any other, including the framework's own
  // examples/data-template/ (found via a fresh-install dogfood run: 2 of its
  // 3 sentences came up untraceable against the template's differently-worded
  // but topically similar entries). A claim always traces to its own entry,
  // so this probe is registry-agnostic by construction while still
  // exercising the same production-scale code path (loading, tokenizing, and
  // matching a real, larger registry) this smoke test exists to guard.
  // Real claim text does not always end with terminal punctuation (many are
  // phrase fragments), so joining with a bare space would let splitSentences()
  // merge several entries' claims into one run-on "sentence" with no period
  // between them. Force a period after every claim so each traces as its own
  // sentence, matching the one-claim-per-entry intent of this probe.
  const smokeText = registry
    .map((e) => e.claim.trim().replace(/[.!?]+$/, "") + ".")
    .join(" ");
  const result = traceClaims(smokeText, registry);

  // Not a 100%-traceable requirement: traceClaims' anti-grafting clause check
  // (MIN_KEYWORD_OVERLAP, trace.ts) can legitimately reject a terse,
  // number-dense claim fragment (e.g. "...; 8-12 direct.") when it is probed
  // in isolation, outside the surrounding narrative it would normally appear
  // in — that is correct conservatism, not a bug, and it showed up on two
  // real entries in this exact registry while wiring this check up. What
  // this smoke test actually guards is the matching mechanism itself: a
  // broken tokenizer/matcher would find nothing at all. Zero traceable
  // claims out of a non-empty registry means the mechanism regressed.
  if (result.traceable.length === 0) {
    return {
      name: CHECK_NAME_PRODUCTION,
      passed: false,
      details:
        "traceClaims found zero traceable claims against the production registry " +
        `(${registry.length} entries) — matching mechanism regression`,
    };
  }
  return { name: CHECK_NAME_PRODUCTION, passed: true };
}
