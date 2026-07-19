import { describe, it, expect } from "vitest";
import { OntologySchema } from "../ontology.js";

describe("OntologySchema", () => {
  it("accepts a string value (single synonym)", () => {
    const result = OntologySchema.parse({ "data warehouse": "data platform" });
    expect(result["data warehouse"]).toBe("data platform");
  });

  it("accepts an array of synonyms", () => {
    const result = OntologySchema.parse({
      "enterprise architecture": ["EA", "solution architecture", "systems architecture"],
    });
    expect(result["enterprise architecture"]).toHaveLength(3);
  });

  it("accepts null (reserved / placeholder key)", () => {
    const result = OntologySchema.parse({ placeholder_key: null });
    expect(result["placeholder_key"]).toBeNull();
  });

  it("accepts a mixed ontology", () => {
    const data = {
      "data platform": ["data lake", "data warehouse"],
      "stream processing": "event streaming",
      tbd: null,
    };
    const result = OntologySchema.parse(data);
    expect(Object.keys(result)).toHaveLength(3);
  });

  it("rejects empty-string keys", () => {
    expect(() => OntologySchema.parse({ "": "value" })).toThrow();
  });

  it("rejects non-string, non-array, non-null values", () => {
    expect(() => OntologySchema.parse({ key: 42 })).toThrow();
    expect(() => OntologySchema.parse({ key: true })).toThrow();
  });

  it("accepts an empty object", () => {
    expect(OntologySchema.parse({})).toEqual({});
  });
});
