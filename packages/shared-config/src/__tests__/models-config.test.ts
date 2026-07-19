import { describe, expect, it } from "vitest";
import { loadModelsConfig } from "../index.js";

describe("loadModelsConfig", () => {
  it("parses the real config/models.yml", () => {
    const config = loadModelsConfig("../../config/models.yml");
    expect(config.roles["cover-final"]).toBeDefined();
    expect(typeof config.default).toBe("string");
  });

  it("throws a clear error for a missing file", () => {
    expect(() => loadModelsConfig("../../config/does-not-exist.yml")).toThrow(
      /Failed to load models config/,
    );
  });
});
