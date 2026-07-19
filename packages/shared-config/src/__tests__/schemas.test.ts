// Exercises the schema-only subpath barrel (T5.10, packages/shared-config/src/schemas.ts)
// directly within this package — the only other consumer is @selfwright/api-contract in a
// different package, which would leave this file's own coverage at 0% otherwise.
import { describe, expect, it } from "vitest";
import {
  ModelRoleSchema,
  ModelsConfigSchema,
  ScanTargetSchema,
  ScanTargetsConfigSchema,
  DEFAULT_QUEUE_AGING_WINDOW_DAYS,
  SettingsSchema,
} from "../schemas.js";

describe("schemas.ts — schema-only subpath barrel", () => {
  it("re-exports the same ModelRoleSchema/ModelsConfigSchema behavior as the main barrel", () => {
    expect(ModelRoleSchema.parse("score")).toBe("score");
    expect(ModelsConfigSchema.parse({ default: "sonnet", roles: { score: "sonnet" } })).toEqual({
      default: "sonnet",
      roles: { score: "sonnet" },
    });
  });

  it("re-exports the same ScanTargetSchema/ScanTargetsConfigSchema behavior as the main barrel", () => {
    const target = { company: "Acme", provider: "greenhouse" };
    expect(ScanTargetSchema.parse(target)).toEqual(target);
    expect(ScanTargetsConfigSchema.parse({ targets: [target] })).toEqual({ targets: [target] });
  });

  it("re-exports the same SettingsSchema/DEFAULT_QUEUE_AGING_WINDOW_DAYS as the main barrel", () => {
    expect(DEFAULT_QUEUE_AGING_WINDOW_DAYS).toBe(30);
    expect(SettingsSchema.parse({ queue: { aging_window_days: 14 } })).toEqual({
      queue: { aging_window_days: 14 },
    });
  });

  it("rejects an invalid settings document the same way the main barrel's schema does", () => {
    expect(SettingsSchema.safeParse({ queue: { aging_window_days: 0 } }).success).toBe(false);
  });
});
