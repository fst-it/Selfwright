import { describe, expect, it } from "vitest";
import { computeNorthStar } from "../north-star.js";
import type { ApplicationRecord } from "../types.js";

function app(id: string, status: string): ApplicationRecord {
  return { id, company: "TestCo", role: "Engineer", status, dates: {} };
}

describe("computeNorthStar", () => {
  it("returns null ratePerTen when there are no submitted applications", () => {
    const result = computeNorthStar([app("1", "to_apply"), app("2", "promoted")]);
    expect(result).toEqual({ submitted: 0, interviews: 0, ratePerTen: null });
  });

  it("returns null ratePerTen when the applications array is empty", () => {
    const result = computeNorthStar([]);
    expect(result).toEqual({ submitted: 0, interviews: 0, ratePerTen: null });
  });

  it("counts all five submitted statuses", () => {
    const applications = [
      app("1", "applied"),
      app("2", "interview"),
      app("3", "offer"),
      app("4", "rejected"),
      app("5", "withdrawn"),
    ];
    const result = computeNorthStar(applications);
    expect(result.submitted).toBe(5);
  });

  it("counts interview and offer as interviewed, not other statuses", () => {
    const applications = [
      app("1", "applied"),
      app("2", "interview"),
      app("3", "offer"),
      app("4", "rejected"),
      app("5", "withdrawn"),
    ];
    const result = computeNorthStar(applications);
    expect(result.interviews).toBe(2); // interview + offer
  });

  it("computes ratePerTen as (interviews / submitted) * 10 rounded to 2 decimals", () => {
    // 2 interviews out of 10 submitted → 2.00 per 10
    const applications = [
      app("1", "interview"),
      app("2", "offer"),
      ...Array.from({ length: 8 }, (_, i) => app(`r${i}`, "rejected")),
    ];
    const result = computeNorthStar(applications);
    expect(result.submitted).toBe(10);
    expect(result.interviews).toBe(2);
    expect(result.ratePerTen).toBe(2);
  });

  it("rounds ratePerTen to 2 decimal places", () => {
    // 1 interview out of 3 submitted → (1/3)*10 = 3.333... → 3.33
    const applications = [app("1", "interview"), app("2", "rejected"), app("3", "rejected")];
    const result = computeNorthStar(applications);
    expect(result.submitted).toBe(3);
    expect(result.interviews).toBe(1);
    expect(result.ratePerTen).toBe(3.33);
  });

  it("excludes to_apply, promoted, and unknown statuses from submitted count", () => {
    const applications = [
      app("1", "to_apply"),
      app("2", "promoted"),
      app("3", "unknown_status"),
      app("4", "applied"),
    ];
    const result = computeNorthStar(applications);
    expect(result.submitted).toBe(1);
    expect(result.interviews).toBe(0);
    expect(result.ratePerTen).toBe(0);
  });

  // ADR 0017 FF-INPUT: the null-YAML-row class must reject with a typed error, never an
  // unhandled null-deref ("Cannot read properties of null").
  it("rejects a null applications argument with a typed TypeError, not a null-deref", () => {
    expect(() => computeNorthStar(null)).toThrow(TypeError);
  });

  it("rejects a non-array applications argument with a typed TypeError", () => {
    expect(() => computeNorthStar({})).toThrow(TypeError);
  });

  it("skips a malformed (null) row inside an otherwise-valid array instead of crashing", () => {
    const applications = [app("1", "applied"), null as unknown as ApplicationRecord, app("2", "interview")];
    expect(() => computeNorthStar(applications)).not.toThrow();
    const result = computeNorthStar(applications);
    expect(result.submitted).toBe(2);
    expect(result.interviews).toBe(1);
  });
});
