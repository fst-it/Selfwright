import { describe, it, expect } from "vitest";
import { parseLabel } from "./classification.js";

describe("parseLabel", () => {
  it("returns the label unchanged for an exact match (baseline)", () => {
    expect(parseLabel("requirement")).toBe("requirement");
  });

  it("correctly extracts a label wrapped in markdown bold markers (bug being fixed)", () => {
    expect(parseLabel("**requirement**")).toBe("requirement");
  });

  it("correctly extracts a label with trailing punctuation (no regression)", () => {
    expect(parseLabel("requirement.")).toBe("requirement");
  });

  it("does not match a label buried in a lengthy verbose response (false-positive guard)", () => {
    const verbose =
      "The answer is a lengthy explanation about how this describes a requirement for the role";
    const result = parseLabel(verbose);
    expect(result).not.toBe("requirement");
    expect(result).not.toBe("perk");
    expect(result).not.toBe("company_info");
    expect(result).not.toBe("other");
  });
});
