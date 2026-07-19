import { describe, it, expect } from "vitest";
import { parseSkillArray } from "./extraction.js";

describe("parseSkillArray", () => {
  it("parses a clean single-array response correctly", () => {
    const result = parseSkillArray('["Python", "Docker", "Kubernetes"]');
    expect(result).toEqual(["python", "docker", "kubernetes"]);
  });

  it("extracts the last bracket group when junk brackets precede the array", () => {
    // Regression: greedy /\[[\s\S]*\]/ spanned from "[1]" to the last "]", producing invalid JSON.
    const result = parseSkillArray(
      'Based on [1], the required skills are: ["Python", "Docker"]',
    );
    expect(result).toEqual(["python", "docker"]);
  });

  it("returns null for a genuinely malformed/non-JSON response without throwing", () => {
    expect(parseSkillArray("not json at all")).toBeNull();
  });
});
