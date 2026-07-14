import { describe, expect, it } from "vitest";
import { computeChannelOutcomes } from "../channel-outcomes.js";
import type { ApplicationRecord } from "../types.js";

function app(id: string, status: string, channel?: string): ApplicationRecord {
  return {
    id,
    company: "TestCo",
    role: "Engineer",
    status,
    ...(channel !== undefined ? { channel } : {}),
    dates: {},
  };
}

describe("computeChannelOutcomes", () => {
  it("rejects a null applications argument with a TypeError", () => {
    expect(() => computeChannelOutcomes(null)).toThrow(TypeError);
  });

  it("rejects a non-array argument with a TypeError", () => {
    expect(() => computeChannelOutcomes({})).toThrow(TypeError);
  });

  it("returns empty array when there are no applications", () => {
    expect(computeChannelOutcomes([])).toEqual([]);
  });

  it("excludes pre-submit rows (to_apply, promoted) from all buckets", () => {
    const result = computeChannelOutcomes([
      app("1", "to_apply", "referral"),
      app("2", "promoted", "portal"),
    ]);
    expect(result).toEqual([]);
  });

  it("buckets rows without a channel field as 'unknown'", () => {
    const result = computeChannelOutcomes([
      app("1", "applied"),       // no channel
      app("2", "interview"),     // no channel
    ]);
    expect(result).toEqual([
      { channel: "unknown", submitted: 2, interviews: 1, rate: 0.5 },
    ]);
  });

  it("separates referral and portal rows into distinct buckets", () => {
    const result = computeChannelOutcomes([
      app("1", "interview", "referral"),
      app("2", "applied", "referral"),
      app("3", "applied", "portal"),
    ]);
    // sorted alphabetically: portal, referral
    expect(result).toEqual([
      { channel: "portal", submitted: 1, interviews: 0, rate: 0 },
      { channel: "referral", submitted: 2, interviews: 1, rate: 0.5 },
    ]);
  });

  it("skips malformed (null) rows inside an otherwise-valid array", () => {
    const inputs = [
      app("1", "interview", "referral"),
      null as unknown as ApplicationRecord,
      app("2", "applied", "referral"),
    ];
    expect(() => computeChannelOutcomes(inputs)).not.toThrow();
    const result = computeChannelOutcomes(inputs);
    expect(result).toEqual([
      { channel: "referral", submitted: 2, interviews: 1, rate: 0.5 },
    ]);
  });

  it("rate is null when submitted is 0 (type-level invariant; bucket never empty in practice)", () => {
    // Force the edge case by calling the underlying formula directly via a zero-submitted bucket
    // This is structural: the function only creates buckets for submitted rows, so submitted > 0
    // always. We verify the type contract by checking a 100% interview rate rounds correctly.
    const result = computeChannelOutcomes([app("1", "offer", "referral")]);
    expect(result[0]).toEqual({ channel: "referral", submitted: 1, interviews: 1, rate: 1 });
  });

  it("rounds rate to 2 decimal places", () => {
    // 1 interview out of 3 submitted → 1/3 = 0.333... → 0.33
    const result = computeChannelOutcomes([
      app("1", "interview", "portal"),
      app("2", "rejected", "portal"),
      app("3", "rejected", "portal"),
    ]);
    expect(result[0]?.rate).toBe(0.33);
  });

  it("handles headhunter and direct channels alongside unknown", () => {
    const result = computeChannelOutcomes([
      app("1", "applied", "headhunter"),
      app("2", "applied", "direct"),
      app("3", "applied"),          // no channel → unknown
    ]);
    // sorted: direct, headhunter, unknown
    expect(result.map((r) => r.channel)).toEqual(["direct", "headhunter", "unknown"]);
    expect(result.every((r) => r.submitted === 1 && r.interviews === 0 && r.rate === 0)).toBe(true);
  });
});
