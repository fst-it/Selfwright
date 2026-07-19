import { describe, it, expect } from "vitest";
import { traceClaims, tokenize, entryTokens } from "../trace.js";
import { ADVERSARIAL_BROAD_REGISTRY } from "../adversarial-corpus.js";
import type { EvidenceEntry } from "../schemas/index.js";

// ── R1: property/fuzz tests for traceClaims (Phase 3 truth-floor hardening
// round 3) ────────────────────────────────────────────────────────────────
// Bounds the clause-overlap threshold residual with randomized coverage
// instead of tightening the threshold (owner decision: bound with tests, do
// NOT tighten — tightening over-rejects real compound writing). No external
// fuzz-testing library — a small seeded PRNG keeps this dependency-free and
// fully deterministic: a failure always reproduces from the printed seed,
// there is no CI flakiness.
//
// Two invariants are asserted over many random inputs:
//  1. A randomly-generated clause-graft fabrication (an unseen number, an
//     invented proper noun, grafted onto a real evidence clause via "and")
//     must always be rejected — bounds false negatives.
//  2. A randomly-composed sentence built entirely from real evidence claim
//     text must always be traced — bounds false positives (over-rejection
//     of legitimate compound writing).

// Deterministic seeded PRNG (mulberry32).
function mulberry32(seed: number): () => number {
  let a = seed;
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  const item = arr[Math.floor(rng() * arr.length)];
  if (item === undefined) throw new Error("pick() called on an empty array");
  return item;
}

function randomInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

// Deliberately fictional/unrelated vocabulary — verified below (module-load
// self-check) to share zero tokens with ADVERSARIAL_BROAD_REGISTRY, so a
// fabricated clause built from this pool can never accidentally pass on a
// coincidental real-vocabulary collision.
const NONSENSE_PROPER_NOUNS = [
  "Zorblex", "Quantarium", "Blorptech", "Nimbus9", "Velcrona",
  "Draxineer", "Photonyx", "Kelviron", "Substrata", "Omnivance",
] as const;
const NONSENSE_VERB_PHRASES = [
  "quietly fabricated",
  "secretly authored",
  "personally invented",
  "independently devised",
] as const;
const NONSENSE_FILLER_WORDS = ["protocol", "generating", "undisclosed", "royalties"] as const;
const RANDOM_TENS_WORDS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"] as const;
const RANDOM_ONES_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"] as const;

// Self-check: the fabrication vocabulary must never overlap the real
// registry vocabulary, or a "must always be rejected" assertion below could
// pass by accident (a false negative in the TEST, not the production code)
// if a future edit to the registry introduces a colliding word. Fails loud
// at module load rather than producing a silently-unsound fuzz corpus.
const REGISTRY_VOCAB = new Set(
  ADVERSARIAL_BROAD_REGISTRY.flatMap((e: EvidenceEntry) => [...entryTokens(e)]),
);
const FABRICATION_VOCAB = new Set(
  [...NONSENSE_PROPER_NOUNS, ...NONSENSE_VERB_PHRASES, ...NONSENSE_FILLER_WORDS].flatMap(
    (w) => [...tokenize(w)],
  ),
);
for (const w of FABRICATION_VOCAB) {
  if (REGISTRY_VOCAB.has(w)) {
    throw new Error(
      `Fuzz harness invariant violated: fabrication vocabulary word "${w}" collides with ` +
        "ADVERSARIAL_BROAD_REGISTRY's real vocabulary — the fuzz corpus is no longer " +
        "guaranteed adversarial. Pick a different filler word.",
    );
  }
}

function randomUnseenFigure(rng: () => number): string {
  const scale = pick(rng, ["million", "billion"] as const);
  if (rng() < 0.5) {
    const n = randomInt(rng, 100, 999);
    return `$${n} ${scale}`;
  }
  // Exercise R3's spelled-out compound-cardinal handling too.
  const tens = pick(rng, RANDOM_TENS_WORDS);
  const ones = rng() < 0.5 ? `-${pick(rng, RANDOM_ONES_WORDS)}` : "";
  return `${tens}${ones} ${scale} dollars`;
}

function fabricatedClause(rng: () => number): string {
  const verb = pick(rng, NONSENSE_VERB_PHRASES);
  const noun = pick(rng, NONSENSE_PROPER_NOUNS);
  const figure = randomUnseenFigure(rng);
  return `${verb} the ${noun} protocol generating ${figure} in undisclosed royalties`;
}

// Real generated prose from an LLM/co-pilot rephrases registry YAML notes
// into flowing sentences — it would never reproduce a semicolon-delimited
// internal note verbatim. Normalizing ";" to "," keeps the generator honest
// to what a real artifact looks like, rather than asserting against raw
// registry-YAML shorthand punctuation splitClauses was never designed to
// parse (a semicolon-separated trailing fragment can legitimately carry too
// few of an entry's distinguishing words to independently clear the ≥2
// overlap bar on its own — a pre-existing, accepted threshold trade-off, not
// a bug this fuzz test is targeting).
function realSentenceFrom(entry: EvidenceEntry): string {
  return entry.claim.replace(/;/g, ",");
}

describe("traceClaims() — R1 fuzz: randomized clause-graft fabrication must always be rejected", () => {
  const SEEDS = Array.from({ length: 40 }, (_, i) => i * 97 + 13);

  for (const seed of SEEDS) {
    it(`rejects a randomly-generated fabrication grafted onto a real evidence clause (seed ${seed})`, () => {
      const rng = mulberry32(seed);
      const realEntry = pick(rng, ADVERSARIAL_BROAD_REGISTRY);
      const text = `${realSentenceFrom(realEntry)}, and ${fabricatedClause(rng)}.`;
      const result = traceClaims(text, ADVERSARIAL_BROAD_REGISTRY);
      expect(result.ok).toBe(false);
    });
  }
});

describe("traceClaims() — R1 fuzz: randomized legitimate compound sentences must always trace", () => {
  const SEEDS = Array.from({ length: 40 }, (_, i) => i * 53 + 7);

  for (const seed of SEEDS) {
    it(`traces a randomly-composed compound sentence built from two real evidence entries (seed ${seed})`, () => {
      const rng = mulberry32(seed);
      const a = pick(rng, ADVERSARIAL_BROAD_REGISTRY);
      let b = pick(rng, ADVERSARIAL_BROAD_REGISTRY);
      let guard = 0;
      while (b.id === a.id && guard++ < 10) b = pick(rng, ADVERSARIAL_BROAD_REGISTRY);
      const text = `${realSentenceFrom(a)} and ${realSentenceFrom(b)}.`;
      const result = traceClaims(text, ADVERSARIAL_BROAD_REGISTRY);
      expect(result.ok).toBe(true);
    });
  }
});
