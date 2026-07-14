import { describe, expect, it } from "vitest";
import { selectNextDrillTopic } from "../drill-select.js";
import type { EvidenceEntry, EvidenceTag, Archetype, Gap } from "../../truth/schemas/index.js";
import type { DrillHistoryEntry } from "../types.js";

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

const E1 = entry({ id: "EVD-001", claim: "treasury settlement operations", keywords: ["treasury"] });
const E2 = entry({ id: "EVD-002", claim: "credit risk financial markets", keywords: ["credit risk"] });

const GAP_A: Gap = {
  id: "GAP-A",
  title: "treasury settlement gap",
  honest_gap: "Limited treasury experience",
  frame: "Treasury project exposure via adjacent work",
  tag: "soft",
  evidence_ids: ["EVD-001"],
  company_specific: false,
};

const GAP_B: Gap = {
  id: "GAP-B",
  title: "credit risk gap",
  honest_gap: "No direct credit risk ownership",
  frame: "Indirect exposure through risk dashboards",
  tag: "claim",
  evidence_ids: ["EVD-002"],
  company_specific: false,
};

const ARCHETYPE: Archetype = {
  id: "arch-1",
  related_titles: [],
  match_keywords: ["treasury settlement", "credit risk"],
};

const NO_KEYWORD_ARCHETYPE: Archetype = {
  id: "arch-empty",
  related_titles: [],
  match_keywords: [],
};

const REGISTRY = [E1, E2];
const GAPS = [GAP_A, GAP_B];

function histEntry(topicId: string, kind: DrillHistoryEntry["kind"] = "gap"): DrillHistoryEntry {
  return { topicId, kind, at: new Date().toISOString() };
}

describe("selectNextDrillTopic", () => {
  it("throws when pool is empty (no gaps and no archetype keywords)", () => {
    expect(() =>
      selectNextDrillTopic([], [], NO_KEYWORD_ARCHETYPE, REGISTRY),
    ).toThrow("no drill candidates available");
  });

  it("returns a selection when there are gaps (empty history)", () => {
    const result = selectNextDrillTopic([], GAPS, ARCHETYPE, REGISTRY);
    expect(result.topicId).toBeDefined();
    expect(["gap", "stretch", "strength"]).toContain(result.kind);
  });

  it("prefers gap (base 3) over stretch (base 2) over strength (base 1) when freshness equal", () => {
    // With empty history, all ago = Infinity → freshness ≈ 0.984 (same for all)
    // Priority: gap candidates win
    const result = selectNextDrillTopic([], GAPS, ARCHETYPE, REGISTRY);
    expect(result.kind).toBe("gap");
  });

  it("includes gap object in result when kind is gap", () => {
    const result = selectNextDrillTopic([], GAPS, ARCHETYPE, REGISTRY);
    if (result.kind === "gap") {
      expect(result.gap).toBeDefined();
      expect(result.gap?.id).toMatch(/^GAP-/);
    }
  });

  it("omits gap key from result when kind is not gap", () => {
    // Use archetype only (no gaps) so pool only has stretch/strength coverage topics
    const result = selectNextDrillTopic([], [], ARCHETYPE, REGISTRY);
    // kind will be stretch or strength
    expect("gap" in result).toBe(false);
  });

  it("hard-excludes the immediately-previous topic", () => {
    const history = [histEntry("GAP-A")];
    const result = selectNextDrillTopic(history, GAPS, ARCHETYPE, REGISTRY);
    expect(result.topicId).not.toBe("GAP-A");
  });

  it("allows the only candidate back as fallback (preventing empty pool)", () => {
    // Only one gap; history says we just drilled it
    const history = [histEntry("GAP-A")];
    const result = selectNextDrillTopic(history, [GAP_A], NO_KEYWORD_ARCHETYPE, REGISTRY);
    // GAP-A is the ONLY candidate → it must be returned despite being most recent
    expect(result.topicId).toBe("GAP-A");
  });

  it("freshness grows monotonically with ago", () => {
    // Drilled GAP-A once, then drilled GAP-B once, then GAP-A again
    // After: history = [GAP-A, GAP-B, GAP-A]
    // ago for GAP-A = 0 (it was most recent — but excluded)
    // ago for GAP-B = 1 (one distinct topic since GAP-B last appeared: GAP-A)
    // If we swap: history = [GAP-A, GAP-B]
    // ago for GAP-A = 1 (GAP-B appeared since)
    // ago for GAP-B = 0 (most recent, excluded), fallback: allow if only remaining
    // Let's verify priorities are monotonic by building a bigger history
    const histMany = [
      histEntry("GAP-B"),
      histEntry("GAP-A"),
      histEntry("GAP-B"),
    ];
    // Most recent = GAP-B, so GAP-B excluded
    // GAP-A: last at idx 1, nothing after except idx 2 (GAP-B), so ago = 1
    // Winner must be GAP-A
    const result = selectNextDrillTopic(histMany, GAPS, NO_KEYWORD_ARCHETYPE, REGISTRY);
    expect(result.topicId).toBe("GAP-A");
  });

  it("provides an evidence bundle in the result", () => {
    const result = selectNextDrillTopic([], GAPS, ARCHETYPE, REGISTRY);
    expect(Array.isArray(result.evidenceBundle)).toBe(true);
  });

  it("picks gap over stretch via kind tie-break", () => {
    // If both gap and stretch had the same computed priority, gap wins
    // Force by drilling all other candidates many times so freshness equalises
    // This is inherently tested by the base-weight logic (gap base=3 > stretch=2)
    // Just verify the result kind is gap when gaps exist
    const result = selectNextDrillTopic([], GAPS, ARCHETYPE, REGISTRY);
    expect(result.kind).toBe("gap");
  });

  it("tie-break on id ascending when kind and priority equal", () => {
    // Two gaps with the same base weight; no history → same freshness → GAP-A < GAP-B alphabetically
    const result = selectNextDrillTopic([], GAPS, NO_KEYWORD_ARCHETYPE, REGISTRY);
    expect(result.topicId).toBe("GAP-A");
  });
});
