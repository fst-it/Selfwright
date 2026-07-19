import { describe, it, expect } from "vitest";
import { traceClaims, extractQuantityPhrases } from "../trace.js";
import type { EvidenceEntry } from "../schemas/index.js";

// Uses only real EVD-* IDs from $SELFWRIGHT_DATA_DIR/truth/evidence/registry.yml
const REGISTRY: EvidenceEntry[] = [
  {
    id: "EVD-ACME-LEADERSHIP",
    org: "Acme Corp",
    claim: "Leads enterprise architecture function; functional direction over 120+ architects",
    tag: "soft",
    keywords: [
      "enterprise architecture",
      "central architecture team",
      "application portfolio management",
      "APM",
      "federated organisation",
    ],
  },
  {
    id: "EVD-ACME-CTRM",
    org: "Acme Corp",
    claim: "Own enterprise CTRM strategy: multi-vendor buy-vs-build hybrid target architecture",
    tag: "soft",
    keywords: [
      "CTRM",
      "ETRM",
      "buy vs build",
      "hybrid target architecture",
      "physical trade lifecycle",
    ],
  },
  {
    id: "EVD-ACME-POSITIONPNL",
    org: "Acme Corp",
    claim: "Lead architect for global Position PnL product; re-architected to under 30-minute latency",
    tag: "soft",
    keywords: ["position", "distributed systems", "latency", "data product", "high throughput"],
  },
  {
    id: "EVD-ACME-AIVALUE",
    org: "Acme Corp",
    claim: "Built the business case attributing $55M value to AI and data initiatives",
    tag: "soft",
    keywords: ["GenAI", "AI strategy", "business case", "value", "front office"],
  },
];

describe("traceClaims()", () => {
  it("traces a sentence matching EVD-ACME-LEADERSHIP keywords", () => {
    const text =
      "Leads enterprise architecture at Acme Corp across data and integration domains.";
    const result = traceClaims(text, REGISTRY);
    expect(result.traceable).toHaveLength(1);
    expect(result.traceable[0]?.evidenceIds).toContain("EVD-ACME-LEADERSHIP");
    expect(result.untraceable).toHaveLength(0);
    expect(result.ok).toBe(true);
  });

  it("traces a CTRM sentence to EVD-ACME-CTRM", () => {
    const text =
      "Defined enterprise CTRM strategy using buy vs build approach for the physical trade lifecycle.";
    const result = traceClaims(text, REGISTRY);
    expect(result.traceable.some((t) => t.evidenceIds.includes("EVD-ACME-CTRM"))).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("flags a sentence with no registry overlap", () => {
    const text = "Enjoys weekend hiking and cooking with family.";
    const result = traceClaims(text, REGISTRY);
    expect(result.untraceable).toHaveLength(1);
    expect(result.ok).toBe(false);
  });

  it("skips short non-numeric sentences (fewer than 4 content words)", () => {
    const result = traceClaims("Yes.", REGISTRY);
    expect(result.traceable).toHaveLength(0);
    expect(result.untraceable).toHaveLength(0);
    expect(result.ok).toBe(true);
  });

  it("does not skip short sentences with numeric content (metric claims)", () => {
    // "Raised $22M" has only 2 content words but contains a digit — must not be
    // silently skipped; it should appear as untraceable since no EVD entry matches.
    const result = traceClaims("Raised $22M in Series A.", REGISTRY);
    expect(result.untraceable).toHaveLength(1);
    expect(result.ok).toBe(false);
  });

  it("handles empty text", () => {
    const result = traceClaims("", REGISTRY);
    expect(result.traceable).toHaveLength(0);
    expect(result.untraceable).toHaveLength(0);
    expect(result.ok).toBe(true);
  });

  it("handles empty registry — all substantive sentences untraceable", () => {
    const text =
      "Leads enterprise architecture function with global scope and distributed teams.";
    const result = traceClaims(text, []);
    expect(result.untraceable).toHaveLength(1);
    expect(result.ok).toBe(false);
  });

  it("returns multiple evidenceIds when a sentence overlaps several entries", () => {
    const text =
      "Leads enterprise architecture covering application portfolio management and CTRM strategy.";
    const result = traceClaims(text, REGISTRY);
    expect(result.traceable[0]?.evidenceIds.length).toBeGreaterThan(1);
  });

  it("handles multi-sentence text correctly", () => {
    const sentences = [
      "Leads enterprise architecture across data integration domains.",
      "Defined CTRM strategy using buy vs build hybrid target architecture.",
    ];
    const result = traceClaims(sentences.join(" "), REGISTRY);
    expect(result.traceable).toHaveLength(2);
    expect(result.ok).toBe(true);
  });

  it("sentence with only stop words and short tokens is skipped", () => {
    const result = traceClaims("I am.", REGISTRY);
    expect(result.traceable).toHaveLength(0);
    expect(result.untraceable).toHaveLength(0);
  });

  it("traceable result includes the original sentence text", () => {
    const text = "Leads enterprise architecture and application portfolio management.";
    const result = traceClaims(text, REGISTRY);
    expect(result.traceable[0]?.sentence).toBe(text.trim());
  });
});

// ── F2 regression: fabricated numbers/clauses riding real keyword overlap ────
// Phase 3 adversarial review. Each of these three confirmed artifacts
// currently returned ok:true from traceClaims prior to the fix — real
// keyword overlap with a genuine registry entry let a fabricated figure or a
// grafted, unrelated clause ride through unexamined. All three must now be
// rejected as untraceable.
describe("traceClaims() — F2: numeric-claim and clause-graft detection", () => {
  it("rejects a fabricated latency figure riding on real Position PnL keyword overlap", () => {
    // Real evidence: "under 30-minute latency". Fabricated: "sub-second" —
    // shares "position", "product", "architected", "distributed", "systems",
    // "data", "high", "throughput", "latency" with EVD-ACME-POSITIONPNL,
    // which was enough to trace before the numeric-claim check existed.
    const text =
      "Re-architected the Position PnL data product to sub-second latency using distributed systems for high throughput.";
    const result = traceClaims(text, REGISTRY);
    expect(result.ok).toBe(false);
    expect(result.untraceable).toHaveLength(1);
  });

  it("rejects a fabricated dollar figure riding on real AI-value keyword overlap", () => {
    // Real evidence: "$55M". Fabricated: "$900M" — shares "attributing",
    // "value", "ai", "data", "initiatives", "front office" with
    // EVD-ACME-AIVALUE.
    const text = "Attributing $900M in value to AI and data initiatives across the front office.";
    const result = traceClaims(text, REGISTRY);
    expect(result.ok).toBe(false);
    expect(result.untraceable).toHaveLength(1);
  });

  it("rejects a fabricated clause grafted onto a real one via a coordinating conjunction", () => {
    // Clause 1 ("Leads enterprise architecture at Acme Corp") is real and
    // traces to EVD-ACME-LEADERSHIP. Clause 2 ("personally built a
    // proprietary blockchain settlement network spanning 40 countries")
    // shares zero vocabulary with any registry entry — a wholesale graft
    // that whole-sentence bag-of-words overlap let ride through before.
    const text =
      "Leads enterprise architecture at Acme Corp and personally built a proprietary blockchain settlement network spanning 40 countries.";
    const result = traceClaims(text, REGISTRY);
    expect(result.ok).toBe(false);
    expect(result.untraceable).toHaveLength(1);
  });

  it("still traces a real compound claim whose second clause is a short continuation, not a graft", () => {
    // Regression guard: clause-splitting must not over-reject a legitimate
    // compound sentence where the second clause is too short/generic to be
    // an independent assertion (see MIN_SENTENCE_CONTENT_WORDS exemption).
    const text =
      "Leads enterprise architecture at Acme Corp across data and integration domains.";
    const result = traceClaims(text, REGISTRY);
    expect(result.ok).toBe(true);
    expect(result.traceable).toHaveLength(1);
  });

  it("still traces a real $-figure claim formatted differently from the evidence (formatting-robust)", () => {
    // "55 million" and "$55m" must normalize identically to "$55M" in the
    // evidence entry's claim text — the numeric check must not be defeated
    // by legitimate formatting variance either.
    const text = "Built the business case attributing 55 million in value to AI and data initiatives.";
    const result = traceClaims(text, REGISTRY);
    expect(result.ok).toBe(true);
    expect(result.traceable).toHaveLength(1);
  });
});

// ── Minor fix: splitSentences must not split mid-decimal ─────────────────────
describe("splitSentencesViaTraceClaims — decimal-safe splitting", () => {
  it("does not fragment a decimal dollar figure ($2.5M) into two false sentence boundaries", () => {
    // Before the fix, "Saved $2.5M this year." split into "Saved $2." and
    // "5M this year." — corrupting the number and breaking any downstream
    // numeric check. With a registry entry whose claim contains the same
    // figure, the sentence must trace as ONE sentence, not two fragments.
    const registryWithDecimal: EvidenceEntry[] = [
      {
        id: "EVD-SYN-DECIMAL",
        org: "SyntheticCo",
        claim: "Saved $2.5M this year through vendor consolidation efforts",
        tag: "hard",
        keywords: ["saved", "vendor", "consolidation"],
      },
    ];
    const result = traceClaims("Saved $2.5M this year through vendor consolidation.", registryWithDecimal);
    expect(result.traceable).toHaveLength(1);
    expect(result.untraceable).toHaveLength(0);
    expect(result.traceable[0]?.sentence).toBe("Saved $2.5M this year through vendor consolidation.");
  });
});

// ── F2 round 2 regression: spelled-out numbers + clause overlap threshold ───
// Phase 3 adversarial re-review. The exact confirmed bypass artifact was NOT
// reproducible against a narrow 1-3 entry synthetic registry (the
// sentence-level ids>=2 threshold alone rejected it there, masking this bug
// class entirely) — it only reproduces against a broad, multi-entry
// registry whose vocabulary overlaps across many unrelated topics, exactly
// like the real ~30-entry evidence registry. BROAD_REGISTRY mirrors that
// vocabulary breadth (several unrelated entries sharing common words like
// "built"/"system"/"trading"/"platform") without depending on the private
// data directory at test time.
const BROAD_REGISTRY: EvidenceEntry[] = [
  {
    id: "EVD-BROAD-CTRM",
    org: "SyntheticCo",
    claim:
      "Own enterprise CTRM strategy: multi-vendor buy-vs-build hybrid target architecture across the physical trade lifecycle",
    tag: "soft",
    keywords: ["CTRM", "ETRM", "buy vs build", "hybrid target architecture", "physical trade lifecycle"],
  },
  {
    id: "EVD-BROAD-POSITIONPNL",
    org: "SyntheticCo",
    claim: "Lead architect for the global Position PnL trading system; re-architected daily to under 30-minute latency",
    tag: "soft",
    keywords: ["position", "P&L", "latency", "data product", "distributed systems", "trading system"],
  },
  {
    id: "EVD-BROAD-AIVALUE",
    org: "SyntheticCo",
    claim: "Built the business case attributing $55M value to AI and data initiatives",
    tag: "soft",
    keywords: ["GenAI", "AI strategy", "business case", "value", "front office"],
  },
  {
    id: "EVD-BROAD-BACKOFFICE",
    org: "SyntheticCo",
    claim:
      "Designed end-to-end commodity trade process flows for a trading house; middle/back office settlement to the financial ledger",
    tag: "soft",
    keywords: ["trade lifecycle", "back office", "middle office", "settlement", "derivatives"],
  },
  {
    id: "EVD-BROAD-ARCHPLATFORM",
    org: "SyntheticCo",
    claim: "Designed and hands-on built an AI-augmented enterprise-architecture platform; now leads the small team that evolves it",
    tag: "soft",
    keywords: ["architecture decision records", "platform", "distributed systems", "microservices"],
  },
  {
    id: "EVD-BROAD-DATAPLATFORM",
    org: "SyntheticCo",
    claim:
      "Built the data & analytics function from two to thirty people; integrated SAP, legacy ERP, Salesforce and banking data into a Snowflake-based data platform",
    tag: "hard",
    keywords: ["data platform", "lakehouse", "Snowflake", "data governance"],
  },
];

describe("traceClaims() — F2 round 2: spelled-out numbers and clause overlap vs a broad registry", () => {
  it("rejects the exact confirmed bypass artifact against a broad, multi-entry registry", () => {
    // Confirmed pre-fix: returned ok:true. Root causes: (1) "two billion" /
    // "three" produced zero quantity phrases (digit-only extraction), so the
    // numeric-corroboration check never fired; (2) clauseSupported's ≥1
    // overlap bar let almost any clause find ONE incidentally-shared word
    // ("built", "settlement", "trading", "system") with some broad-registry
    // entry.
    const text =
      "You personally built a proprietary blockchain settlement system processing two billion dollars daily and hold three undisclosed patents in autonomous trading systems.";
    const result = traceClaims(text, BROAD_REGISTRY);
    expect(result.ok).toBe(false);
    expect(result.untraceable).toHaveLength(1);
  });

  it("extractQuantityPhrases recognizes a spelled-out cardinal + scale word identically to the digit form", () => {
    expect(extractQuantityPhrases("processing two billion dollars daily")).toEqual(["money:2000000000"]);
    expect(extractQuantityPhrases("processing 2 billion dollars daily")).toEqual(["money:2000000000"]);
    expect(extractQuantityPhrases("a billion dollars in losses")).toEqual(["money:1000000000"]);
  });

  it("extractQuantityPhrases recognizes a bare spelled-out cardinal (two..ten) as a quantity claim", () => {
    expect(extractQuantityPhrases("hold three undisclosed patents")).toEqual(["num:3"]);
  });

  it("does not treat 'one'/'a'/'an' as a bare quantity claim outside a scale-word phrase (too common in ordinary prose)", () => {
    expect(extractQuantityPhrases("one of the reasons I applied")).toEqual([]);
    expect(extractQuantityPhrases("a strong candidate for this role")).toEqual([]);
  });

  it("still traces a real compound sentence whose second clause independently clears the ≥2 overlap bar", () => {
    // Guard against over-rejection: raising clauseSupported's threshold to
    // match the sentence-level bar must not reject a real compound claim
    // where BOTH clauses genuinely trace to evidence on their own.
    const text =
      "Built the data & analytics function into a Snowflake-based data platform and led the business case attributing $55M value to AI and data initiatives.";
    const result = traceClaims(text, BROAD_REGISTRY);
    expect(result.ok).toBe(true);
  });

  it("still traces a strongly evidenced claim even though one word incidentally also appears in an unrelated entry", () => {
    // "Built" also appears in EVD-BROAD-ARCHPLATFORM's claim, but this
    // sentence's real, multi-word match is EVD-BROAD-DATAPLATFORM — the
    // ≥2 threshold must not cause a false rejection of a genuinely strong
    // match just because a single word happens to recur elsewhere.
    const text =
      "Built the data platform integrating SAP, legacy ERP, Salesforce and banking data into a Snowflake-based platform.";
    const result = traceClaims(text, BROAD_REGISTRY);
    expect(result.ok).toBe(true);
  });

  it("still traces a spelled-out small cardinal that matches a digit genuinely present in the evidence", () => {
    const registryWithCount: EvidenceEntry[] = [
      {
        id: "EVD-BROAD-TEAM",
        org: "SyntheticCo",
        claim: "Led a team of 3 principal architects across the platform organisation",
        tag: "hard",
        keywords: ["team", "architects", "platform organisation"],
      },
    ];
    const text = "Led a team of three principal architects across the platform organisation.";
    const result = traceClaims(text, registryWithCount);
    expect(result.ok).toBe(true);
  });

  it("rejects a spelled-out figure that does not match the real digit in the evidence (formatting-robust in both directions)", () => {
    const registryWithCount: EvidenceEntry[] = [
      {
        id: "EVD-BROAD-TEAM",
        org: "SyntheticCo",
        claim: "Led a team of 3 principal architects across the platform organisation",
        tag: "hard",
        keywords: ["team", "architects", "platform organisation"],
      },
    ];
    const text = "Led a team of seven principal architects across the platform organisation.";
    const result = traceClaims(text, registryWithCount);
    expect(result.ok).toBe(false);
  });
});

// ── R3: compound cardinals twenty..ninety-nine (Phase 3 truth-floor
// hardening round 3) ─────────────────────────────────────────────────────
// WORD_CARDINALS/BARE_CARDINAL_RE only recognized spelled cardinals up to
// "ten" — "twenty billion dollars" or "forty countries" produced zero
// quantity phrases and rode through untraced exactly like the pre-fix "two
// billion" gap the round-2 fix closed.
describe("extractQuantityPhrases() — R3: compound cardinals twenty..ninety-nine", () => {
  it("recognizes a compound tens word + scale word identically to the digit form", () => {
    expect(extractQuantityPhrases("processing twenty billion dollars daily")).toEqual([
      "money:20000000000",
    ]);
    expect(extractQuantityPhrases("processing 20 billion dollars daily")).toEqual([
      "money:20000000000",
    ]);
  });

  it("recognizes a bare compound tens word as a quantity claim", () => {
    expect(extractQuantityPhrases("expanded operations across forty countries")).toEqual(["num:40"]);
  });

  it("recognizes a hyphenated compound cardinal (tens-ones) as a quantity claim", () => {
    expect(extractQuantityPhrases("hold twenty-one undisclosed patents")).toEqual(["num:21"]);
  });

  it("recognizes a space-separated compound cardinal (tens ones) as a quantity claim", () => {
    expect(extractQuantityPhrases("hold twenty one undisclosed patents")).toEqual(["num:21"]);
  });

  it("does not misread a compound-tens ordinal as a bare cardinal quantity", () => {
    // "twenty-first" is an ordinal (the 21st), not a cardinal quantity claim
    // of "20" — a false extraction here would reject ordinary prose like
    // "leading transformation in the twenty-first century" as an untraceable
    // numeric claim.
    expect(extractQuantityPhrases("leading transformation in the twenty-first century")).toEqual([]);
  });

  it("rejects a fabricated compound-cardinal figure grafted onto a real clause against a broad, multi-entry registry", () => {
    // Same structure as the confirmed round-2 bypass artifact, using
    // compound tens words ("twenty billion", "forty ... patents") instead
    // of two..ten, against BROAD_REGISTRY (see round-2 describe block above)
    // whose vocabulary breadth mirrors the real ~30-entry registry.
    const text =
      "You personally built a proprietary blockchain settlement system processing twenty billion dollars daily and hold forty undisclosed patents in autonomous trading systems.";
    const result = traceClaims(text, BROAD_REGISTRY);
    expect(result.ok).toBe(false);
    expect(result.untraceable).toHaveLength(1);
  });

  it("still traces a legitimate compound spelled-out number that genuinely matches the digit in the evidence", () => {
    const registryWithCount: EvidenceEntry[] = [
      {
        id: "EVD-BROAD-TEAM2",
        org: "SyntheticCo",
        claim: "Led a team of 42 principal architects across the platform organisation",
        tag: "hard",
        keywords: ["team", "architects", "platform organisation"],
      },
    ];
    const text = "Led a team of forty-two principal architects across the platform organisation.";
    const result = traceClaims(text, registryWithCount);
    expect(result.ok).toBe(true);
  });

  it("rejects a compound spelled-out figure that does not match the real digit in the evidence", () => {
    const registryWithCount: EvidenceEntry[] = [
      {
        id: "EVD-BROAD-TEAM2",
        org: "SyntheticCo",
        claim: "Led a team of 42 principal architects across the platform organisation",
        tag: "hard",
        keywords: ["team", "architects", "platform organisation"],
      },
    ];
    const text = "Led a team of forty-three principal architects across the platform organisation.";
    const result = traceClaims(text, registryWithCount);
    expect(result.ok).toBe(false);
  });
});
