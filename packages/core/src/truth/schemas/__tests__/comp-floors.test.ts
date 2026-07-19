import { describe, it, expect } from "vitest";
import { CompFloorsSchema, CityFloorSchema } from "../comp-floors.js";

const BASE_META = {
  source: "manual",
  generated: "2026-01-01",
  amsterdam_discretionary_baseline_eur: 160000,
  review_cadence: "quarterly",
  location_tiers: "A/B/C",
};

const BASE_CITY = {
  city: "Amsterdam",
  country: "Netherlands",
  location_tier_points: 100,
  col_index: 1.0,
  floor_a_eur: 160000,
};

describe("CityFloorSchema", () => {
  it("parses a minimal city", () => {
    const result = CityFloorSchema.parse(BASE_CITY);
    expect(result.city).toBe("Amsterdam");
    expect(result.floor_b_eur).toBeUndefined();
  });

  it("accepts all optional fields", () => {
    const result = CityFloorSchema.parse({
      ...BASE_CITY,
      floor_b_eur: 140000,
      regime_floor_a_eur: 150000,
      search: true,
      note: "Main target market.",
    });
    expect(result.floor_b_eur).toBe(140000);
    expect(result.search).toBe(true);
  });

  it("accepts search: false literal", () => {
    const result = CityFloorSchema.parse({ ...BASE_CITY, search: "false" });
    expect(result.search).toBe("false");
  });

  it("rejects empty city name", () => {
    expect(() => CityFloorSchema.parse({ ...BASE_CITY, city: "" })).toThrow();
  });
});

describe("CompFloorsSchema", () => {
  it("parses a valid file", () => {
    const result = CompFloorsSchema.parse({
      meta: BASE_META,
      cities: [BASE_CITY],
    });
    expect(result.cities).toHaveLength(1);
    expect(result.meta.amsterdam_discretionary_baseline_eur).toBe(160000);
  });

  it("rejects empty cities array", () => {
    expect(() =>
      CompFloorsSchema.parse({ meta: BASE_META, cities: [] }),
    ).toThrow();
  });

  it("accepts optional amended and note", () => {
    const result = CompFloorsSchema.parse({
      meta: { ...BASE_META, amended: "2026-06-01", note: "Updated tiers." },
      cities: [BASE_CITY],
    });
    expect(result.meta.amended).toBe("2026-06-01");
  });
});
