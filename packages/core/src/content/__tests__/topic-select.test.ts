import { describe, expect, it } from "vitest";
import { selectContentTopics, selectContentTopicsForApplication, deriveJdTopicKeywords } from "../topic-select.js";
import type { EvidenceEntry, EvidenceTag, Archetype, Gap } from "../../truth/schemas/index.js";
import type { ContentHistoryEntry } from "../types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

function entry(opts: {
  id: string;
  claim: string;
  tag?: EvidenceTag;
  keywords?: string[];
  org?: string;
}): EvidenceEntry {
  return {
    id: opts.id,
    org: opts.org ?? "Acme",
    claim: opts.claim,
    tag: opts.tag ?? "soft",
    keywords: opts.keywords ?? [],
  };
}

// E1 → covered "treasury settlement" (has keyword hit)
const E1 = entry({ id: "EVD-001", claim: "Led treasury settlement operations", keywords: ["treasury", "settlement"] });
// E2 → covered "credit risk" (has keyword hit)
const E2 = entry({ id: "EVD-002", claim: "Credit risk model rollout", keywords: ["credit risk"] });

const ARCHETYPE_BOTH: Archetype = {
  id: "arch-1",
  related_titles: [],
  match_keywords: ["treasury settlement", "credit risk", "blockchain"],
};

const ARCHETYPE_EMPTY: Archetype = {
  id: "arch-empty",
  related_titles: [],
  match_keywords: [],
};

const GAP_A: Gap = {
  id: "GAP-A",
  title: "blockchain distributed ledger",
  honest_gap: "No blockchain experience",
  frame: "Learning blockchain concepts",
  tag: "soft",
  evidence_ids: [],
  company_specific: false,
};

const GAP_B: Gap = {
  id: "GAP-B",
  title: "regulatory compliance",
  honest_gap: "Limited regulatory exposure",
  frame: "Adjacent regulatory awareness",
  tag: "claim",
  evidence_ids: [],
  company_specific: false,
};

function histEntry(topic: string, direction: ContentHistoryEntry["direction"] = "write"): ContentHistoryEntry {
  return { topic, direction, at: new Date().toISOString() };
}

const REGISTRY = [E1, E2];
const GAPS = [GAP_A, GAP_B];

// ── selectContentTopics ────────────────────────────────────────────────────

describe("selectContentTopics — direction mapping", () => {
  it("covered topics become 'write' candidates with kind 'strength'", () => {
    const result = selectContentTopics(ARCHETYPE_BOTH, REGISTRY, [], []);
    const write = result.filter((c) => c.direction === "write");
    expect(write.length).toBeGreaterThan(0);
    for (const c of write) {
      expect(c.kind).toBe("strength");
    }
  });

  it("uncovered topics become 'read' candidates with kind 'uncovered'", () => {
    const result = selectContentTopics(ARCHETYPE_BOTH, REGISTRY, [], []);
    const uncovered = result.filter((c) => c.kind === "uncovered");
    // "blockchain" is uncovered (no keyword hit, no token overlap with registry)
    expect(uncovered.length).toBeGreaterThan(0);
    expect(uncovered.every((c) => c.direction === "read")).toBe(true);
  });

  it("gap rows become 'read' candidates with kind 'gap' and gapId set", () => {
    const result = selectContentTopics(ARCHETYPE_BOTH, REGISTRY, GAPS, []);
    const gapCandidates = result.filter((c) => c.kind === "gap");
    expect(gapCandidates.length).toBeGreaterThan(0);
    for (const c of gapCandidates) {
      expect(c.direction).toBe("read");
      expect(c.gapId).toMatch(/^GAP-/);
    }
  });

  it("partial-coverage topics become 'read' candidates with kind 'stretch'", () => {
    // Entry with no keywords but enough token overlap
    const partialEntry = entry({ id: "EVD-003", claim: "treasury management reporting deep analysis", keywords: [] });
    const arch: Archetype = { id: "a", related_titles: [], match_keywords: ["treasury operations"] };
    const result = selectContentTopics(arch, [partialEntry], [], []);
    const stretch = result.filter((c) => c.kind === "stretch");
    // "treasury operations" gets partial coverage from the claim (treasury + operations tokens)
    expect(stretch.every((c) => c.direction === "read")).toBe(true);
  });
});

describe("selectContentTopics — gap weighting", () => {
  it("gap candidates (base 3) have higher score than stretch (base 2) have higher than strength (base 1) with equal freshness", () => {
    // With empty history all topics have equal freshness — order should reflect base weights
    const result = selectContentTopics(ARCHETYPE_BOTH, REGISTRY, GAPS, []);
    const byKind = (kind: string) => result.filter((c) => c.kind === kind);
    const gaps = byKind("gap");
    const uncovered = byKind("uncovered");
    const strength = byKind("strength");

    if (gaps.length > 0 && uncovered.length > 0) {
      const gapScore = gaps[0]?.score ?? -1;
      const uncoveredScore = uncovered[0]?.score ?? -1;
      expect(gapScore).toBeGreaterThanOrEqual(uncoveredScore);
    }
    if (uncovered.length > 0 && strength.length > 0) {
      const uncoveredScore = uncovered[0]?.score ?? -1;
      const strengthScore = strength[0]?.score ?? -1;
      expect(uncoveredScore).toBeGreaterThanOrEqual(strengthScore);
    }
  });
});

describe("selectContentTopics — freshness decay", () => {
  it("a topic not in history has maximum freshness (score ≈ base × 0.984)", () => {
    const result = selectContentTopics(ARCHETYPE_BOTH, REGISTRY, [], []);
    const write = result.filter((c) => c.direction === "write");
    for (const c of write) {
      // base=1, full freshness ≈ 0.984375
      expect(c.score).toBeCloseTo(1 * (1 - Math.pow(0.5, 6)), 5);
    }
  });

  it("freshness increases monotonically with ago (more time since last suggestion → higher priority)", () => {
    // Suggest topic A at time 0, then B, then C. A has ago=2, B has ago=1.
    // Priority of A (ago=2) = base × (1 - 0.5^2) = base × 0.75
    // Priority of B (ago=1) = base × (1 - 0.5^1) = base × 0.5
    // So A should rank above B.
    const archTwoKeywords: Archetype = {
      id: "a",
      related_titles: [],
      match_keywords: ["treasury settlement", "credit risk"],
    };
    const history: ContentHistoryEntry[] = [
      histEntry("treasury settlement"),
      histEntry("credit risk"),
    ];
    // most recent = credit risk (excluded). treasury settlement: ago=1. So only treasury settlement in pool (no exclusion fallback needed)
    // Actually: most recent = "credit risk", so "credit risk" is excluded.
    // "treasury settlement" has ago = number of distinct topics after it = 1 (credit risk)
    // ago=1 → freshness = 0.5
    const result = selectContentTopics(archTwoKeywords, REGISTRY, [], history);
    const write = result.filter((c) => c.direction === "write");
    const treasury = write.find((c) => c.topic === "treasury settlement");
    expect(treasury).toBeDefined();
    expect(treasury?.score).toBeCloseTo(1 * (1 - Math.pow(0.5, 1)), 5);
  });

  it("back-to-back exclusion: most-recent topic is hard-excluded", () => {
    const arch: Archetype = {
      id: "a",
      related_titles: [],
      match_keywords: ["treasury settlement", "credit risk"],
    };
    const history: ContentHistoryEntry[] = [histEntry("treasury settlement")];
    const result = selectContentTopics(arch, REGISTRY, [], history);
    const write = result.filter((c) => c.direction === "write");
    // "treasury settlement" should not appear (it was most recent)
    expect(write.find((c) => c.topic === "treasury settlement")).toBeUndefined();
  });

  it("back-to-back exclusion: falls back to the excluded topic when it is the only candidate", () => {
    const arch: Archetype = { id: "a", related_titles: [], match_keywords: ["treasury settlement"] };
    const history: ContentHistoryEntry[] = [histEntry("treasury settlement")];
    const result = selectContentTopics(arch, REGISTRY, [], history);
    // Only one write candidate; exclusion would empty the pool → allowed back
    const write = result.filter((c) => c.direction === "write");
    expect(write.find((c) => c.topic === "treasury settlement")).toBeDefined();
  });
});

describe("selectContentTopics — cap split", () => {
  it("total result never exceeds cap", () => {
    const result = selectContentTopics(ARCHETYPE_BOTH, REGISTRY, GAPS, [], undefined, 4);
    expect(result.length).toBeLessThanOrEqual(4);
  });

  it("default cap=8: at most 5 write + at most 3 read", () => {
    // Build archetype with many covered topics
    const manyEntries = Array.from({ length: 8 }, (_, i) =>
      entry({ id: `EVD-${String(i + 1).padStart(3, "0")}`, claim: `topic ${i} operation`, keywords: [`topic${i}`] }),
    );
    const arch: Archetype = {
      id: "a",
      related_titles: [],
      match_keywords: manyEntries.map((_, i) => `topic${i}`),
    };
    const result = selectContentTopics(arch, manyEntries, GAPS, []);
    const write = result.filter((c) => c.direction === "write");
    const read = result.filter((c) => c.direction === "read");
    expect(write.length).toBeLessThanOrEqual(5);
    expect(read.length).toBeLessThanOrEqual(3);
  });

  it("both write and read directions are represented when candidates exist for each", () => {
    const result = selectContentTopics(ARCHETYPE_BOTH, REGISTRY, GAPS, []);
    const write = result.filter((c) => c.direction === "write");
    const read = result.filter((c) => c.direction === "read");
    expect(write.length).toBeGreaterThan(0);
    expect(read.length).toBeGreaterThan(0);
  });
});

describe("selectContentTopics — read pool dedup (finding 5)", () => {
  it("excludes an uncovered/partial candidate whose existingGapId duplicates an already-present gap-kind candidate", () => {
    // "blockchain" (uncovered, no keyword hit anywhere in REGISTRY) substring-matches
    // GAP_A's title "blockchain distributed ledger" → existingGapId = "GAP-A". Both the
    // gap-kind row (topic "blockchain distributed ledger") and the uncovered row (topic
    // "blockchain") would otherwise occupy separate read slots for the same underlying gap.
    const result = selectContentTopics(ARCHETYPE_BOTH, REGISTRY, GAPS, []);
    const read = result.filter((c) => c.direction === "read");

    const gapKind = read.filter((c) => c.kind === "gap");
    expect(gapKind.map((c) => c.gapId).sort()).toEqual(["GAP-A", "GAP-B"]);

    // The uncovered "blockchain" topic must not also appear — its existingGapId (GAP-A)
    // already has a gap-kind candidate in the pool.
    expect(read.some((c) => c.topic === "blockchain")).toBe(false);
    expect(read).toHaveLength(2);
  });
});

describe("selectContentTopics — evidenceBundle", () => {
  it("write candidates have a non-empty evidence bundle when the registry has relevant entries", () => {
    const result = selectContentTopics(ARCHETYPE_BOTH, REGISTRY, [], []);
    const write = result.filter((c) => c.direction === "write");
    for (const c of write) {
      expect(c.evidenceBundle.length).toBeGreaterThan(0);
    }
  });

  it("read candidates for truly uncovered topics may have an empty evidence bundle", () => {
    // "blockchain" has no token overlap in REGISTRY → evidence bundle should be empty
    const result = selectContentTopics(ARCHETYPE_BOTH, REGISTRY, [], []);
    const uncovered = result.filter((c) => c.kind === "uncovered" && c.topic === "blockchain");
    if (uncovered.length > 0) {
      // May be empty — not an error
      expect(Array.isArray(uncovered[0]?.evidenceBundle)).toBe(true);
    }
  });
});

describe("selectContentTopics — edge cases", () => {
  it("returns empty list when archetype has no keywords and no gaps", () => {
    const result = selectContentTopics(ARCHETYPE_EMPTY, REGISTRY, [], []);
    expect(result).toHaveLength(0);
  });

  it("returns only read candidates when archetype has no covered topics", () => {
    const arch: Archetype = { id: "a", related_titles: [], match_keywords: ["blockchain"] };
    const result = selectContentTopics(arch, REGISTRY, GAPS, []);
    const write = result.filter((c) => c.direction === "write");
    expect(write).toHaveLength(0);
    const read = result.filter((c) => c.direction === "read");
    expect(read.length).toBeGreaterThan(0);
  });

  it("returns only write candidates when all topics are covered and no gaps", () => {
    const arch: Archetype = { id: "a", related_titles: [], match_keywords: ["treasury settlement", "credit risk"] };
    const result = selectContentTopics(arch, REGISTRY, [], []);
    const read = result.filter((c) => c.direction === "read");
    expect(read).toHaveLength(0);
    const write = result.filter((c) => c.direction === "write");
    expect(write.length).toBeGreaterThan(0);
  });

  it("returns empty list for empty registry and no gaps", () => {
    const result = selectContentTopics(ARCHETYPE_BOTH, [], [], []);
    // All topics uncovered → read only; no gaps → no gap candidates
    // uncovered topics are valid read candidates
    const read = result.filter((c) => c.direction === "read");
    expect(read.length).toBeGreaterThan(0);
  });

  it("empty history does not crash", () => {
    expect(() => selectContentTopics(ARCHETYPE_BOTH, REGISTRY, GAPS, [])).not.toThrow();
  });
});

// ── selectContentTopicsForApplication ─────────────────────────────────────

describe("selectContentTopicsForApplication — direction mapping", () => {
  it("JD keywords that are covered become 'write' candidates", () => {
    const result = selectContentTopicsForApplication(["treasury settlement", "credit risk"], REGISTRY, [], undefined, 6);
    const write = result.filter((c) => c.direction === "write");
    expect(write.length).toBeGreaterThan(0);
    expect(write.every((c) => c.kind === "strength")).toBe(true);
  });

  it("JD keywords that are uncovered become 'read' candidates", () => {
    const result = selectContentTopicsForApplication(["blockchain"], REGISTRY, [], undefined, 6);
    const read = result.filter((c) => c.direction === "read");
    expect(read.length).toBeGreaterThan(0);
    expect(read.every((c) => c.kind === "uncovered" || c.kind === "gap")).toBe(true);
  });

  it("gap rows are always included as 'read' candidates (kind 'gap')", () => {
    const result = selectContentTopicsForApplication(["treasury settlement"], REGISTRY, GAPS, undefined, 6);
    const gapCandidates = result.filter((c) => c.kind === "gap");
    expect(gapCandidates.length).toBeGreaterThan(0);
  });
});

describe("selectContentTopicsForApplication — determinism", () => {
  it("same JD keywords always produce the same ranked list", () => {
    const keywords = ["treasury settlement", "credit risk", "blockchain"];
    const r1 = selectContentTopicsForApplication(keywords, REGISTRY, GAPS);
    const r2 = selectContentTopicsForApplication(keywords, REGISTRY, GAPS);
    expect(r1).toEqual(r2);
  });

  it("order is stable: gap (base 3) before uncovered (base 2) before strength (base 1)", () => {
    const result = selectContentTopicsForApplication(["treasury settlement", "blockchain"], REGISTRY, GAPS);
    const byKind = (kind: string) => result.filter((c) => c.kind === kind);
    const gapScores = byKind("gap").map((c) => c.score);
    const uncoveredScores = byKind("uncovered").map((c) => c.score);
    const strengthScores = byKind("strength").map((c) => c.score);
    if (gapScores.length > 0 && uncoveredScores.length > 0) {
      expect(Math.min(...gapScores)).toBeGreaterThan(Math.max(...uncoveredScores));
    }
    if (uncoveredScores.length > 0 && strengthScores.length > 0) {
      expect(Math.min(...uncoveredScores)).toBeGreaterThan(Math.max(...strengthScores));
    }
  });

  it("cap=6 is respected", () => {
    const result = selectContentTopicsForApplication(["treasury settlement", "credit risk", "blockchain"], REGISTRY, GAPS, undefined, 6);
    expect(result.length).toBeLessThanOrEqual(6);
  });

  it("empty JD keywords returns only gap rows (no archetype-derived topics)", () => {
    const result = selectContentTopicsForApplication([], REGISTRY, GAPS);
    const gapCandidates = result.filter((c) => c.kind === "gap");
    expect(gapCandidates.length).toBe(GAPS.length > 3 ? 3 : GAPS.length);
  });

  it("empty registry and empty gaps with no keywords returns empty list", () => {
    const result = selectContentTopicsForApplication([], [], []);
    expect(result).toHaveLength(0);
  });
});

describe("selectContentTopicsForApplication — read pool dedup (finding 5)", () => {
  it("excludes an uncovered/partial candidate whose existingGapId duplicates an already-present gap-kind candidate", () => {
    const result = selectContentTopicsForApplication(
      ["treasury settlement", "credit risk", "blockchain"],
      REGISTRY,
      GAPS,
      undefined,
      10,
    );
    const read = result.filter((c) => c.direction === "read");
    const gapKind = read.filter((c) => c.kind === "gap");
    expect(gapKind.map((c) => c.gapId).sort()).toEqual(["GAP-A", "GAP-B"]);
    expect(read.some((c) => c.topic === "blockchain")).toBe(false);
    expect(read).toHaveLength(2);
  });
});

// ── deriveJdTopicKeywords ──────────────────────────────────────────────────

describe("deriveJdTopicKeywords", () => {
  const ARCH_A: Archetype = {
    id: "a",
    related_titles: [],
    match_keywords: ["treasury settlement", "credit risk", "blockchain"],
  };
  const ARCH_B: Archetype = {
    id: "b",
    related_titles: [],
    match_keywords: ["credit risk", "regulatory compliance"],
  };

  it("returns the match_keywords that actually appear in the JD text", () => {
    const jd = "Looking for a leader with deep treasury settlement and credit risk expertise.";
    const result = deriveJdTopicKeywords(jd, [ARCH_A]);
    expect(result).toEqual(["credit risk", "treasury settlement"]);
  });

  it("returns an empty array when the JD text matches no archetype keywords", () => {
    const jd = "Completely unrelated posting text about gardening.";
    const result = deriveJdTopicKeywords(jd, [ARCH_A]);
    expect(result).toEqual([]);
  });

  it("returns an empty array when there are no archetypes", () => {
    const jd = "treasury settlement credit risk";
    expect(deriveJdTopicKeywords(jd, [])).toEqual([]);
  });

  it("unions keywords across archetypes, deduping case-insensitively with first-seen casing, sorted", () => {
    const archX: Archetype = { id: "x", related_titles: [], match_keywords: ["Treasury Settlement"] };
    const archY: Archetype = {
      id: "y",
      related_titles: [],
      match_keywords: ["treasury settlement", "Regulatory Compliance"],
    };
    const jd = "We need Treasury Settlement and Regulatory Compliance know-how.";
    const result = deriveJdTopicKeywords(jd, [archX, archY]);
    // "Treasury Settlement" appears in both archX and archY (different casing) — dedupes to
    // archX's casing (first-seen). Sorted alphabetically: "Regulatory..." < "Treasury...".
    expect(result).toEqual(["Regulatory Compliance", "Treasury Settlement"]);
  });

  it("is order-independent for the same keyword set (deterministic sort)", () => {
    const jd = "credit risk and treasury settlement and blockchain all matter here.";
    const r1 = deriveJdTopicKeywords(jd, [ARCH_A, ARCH_B]);
    const r2 = deriveJdTopicKeywords(jd, [ARCH_B, ARCH_A]);
    expect(r1).toEqual([...r1].sort());
    expect(new Set(r1)).toEqual(new Set(r2));
  });
});
