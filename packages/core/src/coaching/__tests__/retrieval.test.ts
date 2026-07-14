import { describe, expect, it } from "vitest";
import { expandTerm, relevance, selectEvidenceForTopic } from "../retrieval.js";
import type { EvidenceEntry, EvidenceTag, Ontology } from "../../truth/schemas/index.js";

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

const E1 = entry({ id: "EVD-001", claim: "Led treasury operations and settlement processes", keywords: ["treasury", "settlement"] });
const E2 = entry({ id: "EVD-002", claim: "Built credit risk models for financial markets", keywords: ["credit risk", "financial risk"], tag: "hard" });
const E3 = entry({ id: "EVD-003", claim: "Managed regulatory reporting workflows", keywords: ["regulatory", "reporting"] });

const ONTOLOGY: Ontology = {
  "financial risk": ["credit risk", "market risk"],
  "settlement": "back office",
};

describe("expandTerm", () => {
  it("returns just the term when no ontology", () => {
    expect(expandTerm("treasury")).toEqual(["treasury"]);
  });

  it("returns just the term when no ontology entry matches", () => {
    expect(expandTerm("treasury", ONTOLOGY)).toEqual(["treasury"]);
  });

  it("forward lookup: expands to synonyms from the canonical entry", () => {
    const result = expandTerm("financial risk", ONTOLOGY);
    expect(result).toContain("financial risk");
    expect(result).toContain("credit risk");
    expect(result).toContain("market risk");
  });

  it("reverse lookup: if term is a value, adds the canonical key and siblings", () => {
    // "credit risk" is a value of "financial risk", so bidirectional expansion
    const result = expandTerm("credit risk", ONTOLOGY);
    expect(result).toContain("credit risk");
    expect(result).toContain("financial risk"); // canonical key found via reverse
    expect(result).toContain("market risk"); // sibling
  });

  it("deduplicates case-insensitively, preserving first-occurrence casing", () => {
    // "Financial Risk" (capitalised) → adds it; forward lookup adds "credit risk"/"market risk"
    const result = expandTerm("Financial Risk", ONTOLOGY);
    expect(result[0]).toBe("Financial Risk"); // original casing preserved
    // Must not contain a second "financial risk" in any casing
    const lowers = result.map((s) => s.toLowerCase());
    expect(lowers.filter((s) => s === "financial risk")).toHaveLength(1);
  });

  it("handles string-value ontology entries (not array)", () => {
    const result = expandTerm("settlement", ONTOLOGY);
    expect(result).toContain("back office");
  });
});

describe("relevance", () => {
  it("scores zero for a completely unrelated entry", () => {
    const r = relevance(["quantum computing"], E1);
    expect(r.overlap).toBe(0);
    expect(r.keywordHits).toBe(0);
  });

  it("counts token overlap correctly", () => {
    // "settlement" tokenises to {"settlement"}; E1's claim + keywords contain "settlement"
    const r = relevance(["settlement"], E1);
    expect(r.overlap).toBeGreaterThan(0);
    expect(r.overlapTokens).toContain("settlement");
  });

  it("counts keyword hits when query term matches an entry keyword exactly", () => {
    const r = relevance(["treasury"], E1);
    expect(r.keywordHits).toBe(1); // "treasury" in E1.keywords
  });

  it("keyword hits use ontology-expanded query terms", () => {
    // Expand "financial risk" → ["financial risk", "credit risk", "market risk"]
    // E2.keywords contains "credit risk" and "financial risk"
    const r = relevance(["financial risk"], E2, ONTOLOGY);
    // At least 2 expanded terms match E2 keywords ("financial risk" and "credit risk")
    expect(r.keywordHits).toBeGreaterThanOrEqual(2);
  });

  it("score = overlap + 2*keywordHits + tagWeight", () => {
    // E2 has tag "hard" → tagWeight = 1.0
    const r = relevance(["credit risk"], E2, ONTOLOGY);
    expect(r.score).toBeCloseTo(r.overlap + 2 * r.keywordHits + 1.0);
  });

  it("tag weight: hard > soft > claim", () => {
    const eHard = entry({ id: "EVD-H", claim: "treasury settlement", tag: "hard" });
    const eSoft = entry({ id: "EVD-S", claim: "treasury settlement", tag: "soft" });
    const eClaim = entry({ id: "EVD-C", claim: "treasury settlement", tag: "claim" });
    const rH = relevance(["treasury"], eHard);
    const rS = relevance(["treasury"], eSoft);
    const rC = relevance(["treasury"], eClaim);
    expect(rH.score).toBeGreaterThan(rS.score);
    expect(rS.score).toBeGreaterThan(rC.score);
  });

  it("returns sorted overlapTokens", () => {
    const r = relevance(["treasury settlement"], E1);
    const sorted = [...r.overlapTokens].sort();
    expect(r.overlapTokens).toEqual(sorted);
  });
});

describe("selectEvidenceForTopic", () => {
  const registry = [E1, E2, E3];

  it("filters out entries with zero token overlap", () => {
    const result = selectEvidenceForTopic("quantum computing", registry);
    expect(result).toHaveLength(0);
  });

  it("returns entries sorted by score desc", () => {
    const result = selectEvidenceForTopic("financial risk credit risk", registry, ONTOLOGY);
    const scores = result.map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("deterministic tie-break: id ascending when scores equal", () => {
    const eA = entry({ id: "EVD-AAA", claim: "treasury operations", tag: "soft" });
    const eB = entry({ id: "EVD-BBB", claim: "treasury operations", tag: "soft" });
    const result = selectEvidenceForTopic("treasury", [eB, eA]);
    // Scores are equal; eA (EVD-AAA) should come first
    expect(result[0]?.id).toBe("EVD-AAA");
    expect(result[1]?.id).toBe("EVD-BBB");
  });

  it("respects the cap", () => {
    const result = selectEvidenceForTopic("treasury settlement credit risk", registry, ONTOLOGY, 2);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it("accepts an array input (expands each term)", () => {
    const result = selectEvidenceForTopic(["treasury", "credit risk"], registry, ONTOLOGY);
    expect(result.length).toBeGreaterThan(0);
  });

  it("includes [keyword match] in why when there are keyword hits", () => {
    const result = selectEvidenceForTopic("treasury", [E1], ONTOLOGY);
    const hit = result.find((r) => r.id === "EVD-001");
    expect(hit?.why).toContain("[keyword match]");
  });

  it("omits [keyword match] from why when there are no keyword hits", () => {
    // Query that gets token overlap but no keyword hit
    const noKwEntry = entry({ id: "EVD-NK", claim: "treasury operations workflow", keywords: [] });
    const result = selectEvidenceForTopic("treasury", [noKwEntry]);
    expect(result[0]?.why).not.toContain("[keyword match]");
  });
});
