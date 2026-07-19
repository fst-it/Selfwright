import { describe, expect, it } from "vitest";
import { loadScanTargets } from "../index.js";
import { ScanTargetSchema } from "../scan-targets.js";

describe("loadScanTargets", () => {
  it("parses the real config/scan-targets.yml", () => {
    const config = loadScanTargets("../../config/scan-targets.yml");
    expect(config.targets.length).toBeGreaterThan(0);
    expect(config.targets[0]?.company).toBeDefined();
    expect(config.targets[0]?.provider).toBeDefined();
  });

  it("throws a clear error for a missing file", () => {
    expect(() => loadScanTargets("../../config/does-not-exist.yml")).toThrow(
      /Failed to load scan targets config/,
    );
  });
});

describe("ScanTargetSchema hardening", () => {
  it("accepts a target with a known provider and valid careersUrl", () => {
    const result = ScanTargetSchema.safeParse({
      company: "Acme Corp",
      provider: "greenhouse",
      careersUrl: "https://boards.greenhouse.io/acme",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown provider string", () => {
    const result = ScanTargetSchema.safeParse({
      company: "Acme Corp",
      provider: "unknown-future-ats",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain("provider");
    }
  });

  it("rejects a non-URL careersUrl", () => {
    const result = ScanTargetSchema.safeParse({
      company: "Acme Corp",
      provider: "generic",
      careersUrl: "not-a-url",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain("careersUrl");
    }
  });

  it("rejects unknown keys (strict mode)", () => {
    const result = ScanTargetSchema.safeParse({
      company: "Acme Corp",
      provider: "greenhouse",
      unknownExtraField: true,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a generic target without careersUrl or api (both optional)", () => {
    const result = ScanTargetSchema.safeParse({
      company: "Example Co",
      provider: "generic",
    });
    expect(result.success).toBe(true);
  });
});
