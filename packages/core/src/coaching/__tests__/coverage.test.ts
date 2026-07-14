import { describe, expect, it } from "vitest";
import { computeCoverageGaps, computeCoverageGapsForKeywords } from "../coverage.js";
import type { EvidenceEntry, EvidenceTag, Archetype, Gap, Ontology } from "../../truth/schemas/index.js";

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

// "treasury settlement" → token overlap for topics containing those words
const E1 = entry({
  id: "EVD-001",
  claim: "Led treasury operations and settlement processes daily",
  keywords: ["treasury", "settlement"],
});
const E2 = entry({
  id: "EVD-002",
  claim: "Built credit risk models for financial markets",
  keywords: ["credit risk", "financial risk"],
  tag: "hard",
});
const E3 = entry({
  id: "EVD-003",
  claim: "Managed regulatory compliance workflows quarterly",
  keywords: ["regulatory"],
  tag: "claim",
});

const ARCHETYPE: Archetype = {
  id: "arch-1",
  related_titles: [],
  match_keywords: ["treasury settlement", "credit risk", "blockchain"],
};

const GAPS: Gap[] = [
  {
    id: "GAP-BLOCKCHAIN",
    title: "blockchain distributed ledger",
    honest_gap: "No blockchain experience",
    frame: "Learning blockchain concepts via courses",
    tag: "soft",
    evidence_ids: [],
    company_specific: false,
  },
];

const ONTOLOGY: Ontology = {
  "financial risk": ["credit risk", "market risk"],
};

describe("computeCoverageGapsForKeywords", () => {
  it("marks a topic as covered when any entry has a keyword hit", () => {
    // topic "treasury" exactly matches E1.keywords[0] → keywordHit → covered
    // (compound phrase "treasury settlement" would NOT hit because E1.keywords has separate words)
    const result = computeCoverageGapsForKeywords(["treasury"], [E1]);
    expect(result).toHaveLength(1);
    expect(result[0]?.coverage).toBe("covered");
  });

  it("marks a topic as partial when no keyword hit but sufficient token overlap", () => {
    // "regulatory compliance" has token overlap with E3's claim but E3's keyword is just "regulatory"
    // The query "regulatory compliance" doesn't have full keyword match, but has overlap
    // E3 keywords = ["regulatory"] — if query term isn't "regulatory" exactly, no keyword hit
    // Let's test with a topic that overlaps tokens but keyword array doesn't match exactly
    const eNoKw = entry({
      id: "EVD-NK",
      claim: "deep treasury settlement management operations workflow system",
      keywords: [],
    });
    // Topic "treasury operations" → tokens {treasury, operations}; entry has those tokens → overlap = 2 >= MIN_KEYWORD_OVERLAP
    // No keyword match → partial
    const result = computeCoverageGapsForKeywords(["treasury operations"], [eNoKw]);
    expect(result[0]?.coverage).toBe("partial");
  });

  it("marks a topic as uncovered when no token overlap or keyword hit", () => {
    const result = computeCoverageGapsForKeywords(["blockchain distributed ledger"], [E1, E2]);
    expect(result[0]?.coverage).toBe("uncovered");
  });

  it("returns empty evidenceIds for uncovered topics", () => {
    const result = computeCoverageGapsForKeywords(["blockchain"], [E1]);
    expect(result[0]?.evidenceIds).toEqual([]);
  });

  it("returns up to 3 evidenceIds sorted by score desc for covered topics", () => {
    const extra = entry({ id: "EVD-004", claim: "treasury settlement ledger balances", keywords: ["treasury", "settlement"], tag: "hard" });
    const result = computeCoverageGapsForKeywords(["treasury settlement"], [E1, extra]);
    const c = result[0];
    expect(c?.coverage).toBe("covered");
    expect(c?.evidenceIds.length).toBeLessThanOrEqual(3);
    // Higher score (hard tag) should come first
    expect(c?.evidenceIds[0]).toBe("EVD-004");
  });

  it("bestScore is the max score across all registry entries", () => {
    const result = computeCoverageGapsForKeywords(["treasury settlement"], [E1, E2]);
    expect(result[0]?.bestScore).toBeGreaterThan(0);
  });

  it("bestScore is 0 when registry is empty", () => {
    const result = computeCoverageGapsForKeywords(["treasury settlement"], []);
    expect(result[0]?.bestScore).toBe(0);
  });

  it("links existingGapId when gap title has token overlap >= 2 with the topic", () => {
    // GAPS[0].title = "blockchain distributed ledger"
    // topic = "blockchain distributed" → tokens {blockchain, distributed} → overlap = 2
    const result = computeCoverageGapsForKeywords(
      ["blockchain distributed"],
      [E1],
      undefined,
      GAPS,
    );
    expect(result[0]?.existingGapId).toBe("GAP-BLOCKCHAIN");
    expect(result[0]?.suggestedGapId).toBeUndefined();
  });

  it("links existingGapId via substring match", () => {
    // topic = "blockchain distributed ledger" matches gap title exactly (substring both ways)
    const result = computeCoverageGapsForKeywords(
      ["blockchain distributed ledger"],
      [E1],
      undefined,
      GAPS,
    );
    expect(result[0]?.existingGapId).toBe("GAP-BLOCKCHAIN");
  });

  it("sets suggestedGapId for uncovered topics without an existing gap", () => {
    const result = computeCoverageGapsForKeywords(["cloud architecture"], [E1]);
    expect(result[0]?.coverage).toBe("uncovered");
    expect(result[0]?.suggestedGapId).toMatch(/^GAP-/);
    expect(result[0]?.existingGapId).toBeUndefined();
  });

  it("suggestedGapId does not exceed 24 chars", () => {
    const result = computeCoverageGapsForKeywords(
      ["extremely long topic name for testing truncation"],
      [],
    );
    expect(result[0]?.suggestedGapId?.length).toBeLessThanOrEqual(24);
  });

  it("suggestedGapId collision: appends -2, -3 when id already exists", () => {
    // The existing gap id "GAP-CLOUD" collides with the generated slug for topic "cloud".
    // The gap title "azure kubernetes workloads" must NOT match topic "cloud" via token overlap
    // or substring, so that existingGapId stays unset and suggestedGapId is generated.
    const existingGaps: Gap[] = [
      {
        id: "GAP-CLOUD",
        title: "azure kubernetes workloads",
        honest_gap: "gap",
        frame: "frame",
        tag: "soft",
        evidence_ids: [],
        company_specific: false,
      },
    ];
    const result = computeCoverageGapsForKeywords(["cloud"], [], undefined, existingGaps);
    // "cloud" slug = "GAP-CLOUD" → already taken → "GAP-CLOUD-2"
    expect(result[0]?.suggestedGapId).toBe("GAP-CLOUD-2");
  });

  it("does not set suggestedGapId for covered topics", () => {
    const result = computeCoverageGapsForKeywords(["treasury settlement"], [E1]);
    expect(result[0]?.suggestedGapId).toBeUndefined();
  });

  it("handles ontology expansion for keyword hits", () => {
    // "financial risk" expands to ["financial risk", "credit risk", "market risk"]
    // E2.keywords = ["credit risk", "financial risk"] → keyword hit after expansion
    const result = computeCoverageGapsForKeywords(["financial risk"], [E2], ONTOLOGY);
    expect(result[0]?.coverage).toBe("covered");
  });
});

describe("computeCoverageGaps", () => {
  it("delegates to computeCoverageGapsForKeywords using archetype.match_keywords", () => {
    const result = computeCoverageGaps(ARCHETYPE, [E1, E2, E3], ONTOLOGY, GAPS);
    // ARCHETYPE.match_keywords = ["treasury settlement", "credit risk", "blockchain"]
    expect(result).toHaveLength(3);

    const treasury = result.find((c) => c.topic === "treasury settlement");
    const creditRisk = result.find((c) => c.topic === "credit risk");
    const blockchain = result.find((c) => c.topic === "blockchain");

    expect(treasury?.coverage).toBe("covered");
    expect(creditRisk?.coverage).toBe("covered");
    // blockchain has an existing gap
    expect(blockchain?.existingGapId).toBe("GAP-BLOCKCHAIN");
  });
});
