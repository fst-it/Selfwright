import { describe, it, expect } from "vitest";
import { GapSchema, GapsFileSchema } from "../gaps.js";

const BASE_GAP = {
  id: "GAP-LIVE-TRADING",
  title: "Live trading-desk execution gap",
  honest_gap: "Never managed live order routing in production.",
  frame: "Deep understanding of upstream position data; gap is at execution layer.",
  tag: "claim" as const,
  evidence_ids: ["EVD-ACME-POSITIONPNL"],
  company_specific: true,
};

describe("GapSchema", () => {
  it("parses a valid gap", () => {
    const result = GapSchema.parse(BASE_GAP);
    expect(result.id).toBe("GAP-LIVE-TRADING");
    expect(result.company_specific).toBe(true);
  });

  it("defaults evidence_ids to []", () => {
    const result = GapSchema.parse({
      ...BASE_GAP,
      evidence_ids: undefined,
    });
    expect(result.evidence_ids).toEqual([]);
  });

  it("defaults company_specific to false", () => {
    const result = GapSchema.parse({
      ...BASE_GAP,
      company_specific: undefined,
    });
    expect(result.company_specific).toBe(false);
  });

  it("rejects invalid GAP-* id", () => {
    expect(() => GapSchema.parse({ ...BASE_GAP, id: "GAP_BAD" })).toThrow();
    expect(() => GapSchema.parse({ ...BASE_GAP, id: "bad-id" })).toThrow();
  });

  it("rejects empty honest_gap", () => {
    expect(() => GapSchema.parse({ ...BASE_GAP, honest_gap: "" })).toThrow();
  });

  it("rejects invalid tag level", () => {
    expect(() => GapSchema.parse({ ...BASE_GAP, tag: "medium" })).toThrow();
  });
});

describe("GapsFileSchema", () => {
  it("parses an array of gaps", () => {
    const result = GapsFileSchema.parse([BASE_GAP]);
    expect(result).toHaveLength(1);
  });

  it("accepts an empty array", () => {
    expect(GapsFileSchema.parse([])).toEqual([]);
  });
});
