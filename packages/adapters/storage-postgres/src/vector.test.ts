import { describe, it, expect } from "vitest";
import { toVectorLiteral } from "./vector.js";

describe("toVectorLiteral", () => {
  it("formats a numeric array as a pgvector literal", () => {
    expect(toVectorLiteral([0.1, 0.2, 0.3])).toBe("[0.1,0.2,0.3]");
  });

  it("formats an empty array", () => {
    expect(toVectorLiteral([])).toBe("[]");
  });

  it("formats a single-element array", () => {
    expect(toVectorLiteral([1])).toBe("[1]");
  });
});
