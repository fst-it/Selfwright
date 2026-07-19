import { describe, it, expect } from "vitest";
import { migrateCareerPlanOverlay } from "../legacy-overlay.js";

describe("migrateCareerPlanOverlay", () => {
  it("migrates career_plan's real object shape (mode: replace) to canonical drift_applications", () => {
    // Verbatim shape from career_plan's Globex overlay fixture
    // (20-applications/2026-06-globex-ctrm-architect/cv-overlay.json).
    const raw = {
      archetype: "ctrm-enterprise-architect",
      inject_drifts: [
        { id: "DRIFT-GLOBEX-DESKLATENCY", role: "Acme Corp", mode: "replace", replace_bullet: 2 },
      ],
    };
    const overlay = migrateCareerPlanOverlay(raw);
    expect(overlay.archetype).toBe("ctrm-enterprise-architect");
    expect(overlay.drift_applications).toEqual([
      {
        id: "DRIFT-GLOBEX-DESKLATENCY",
        mode: "replace",
        target: { role: "Acme Corp", bullet: 2 },
        allow_high_risk: false,
      },
    ]);
    expect(overlay).not.toHaveProperty("inject_drifts");
  });

  it("migrates legacy mode 'append' with a role to canonical mode 'inject'", () => {
    const raw = {
      inject_drifts: [{ id: "DRIFT-SYN-001", role: "Globex", mode: "append" }],
    };
    const overlay = migrateCareerPlanOverlay(raw);
    expect(overlay.drift_applications).toEqual([
      { id: "DRIFT-SYN-001", mode: "inject", target: { role: "Globex" }, allow_high_risk: false },
    ]);
  });

  it("throws for legacy mode 'append' with no role — canonical 'inject' requires target.role", () => {
    // A role-less "append" is not a shape career_plan's own drift-inject.mjs
    // produces (it always resolves a role first) — and the canonical schema
    // requires target.role for "inject", so this must fail validation rather
    // than silently produce an untargeted drift_applications entry.
    const raw = { inject_drifts: [{ id: "DRIFT-SYN-002", mode: "append" }] };
    expect(() => migrateCareerPlanOverlay(raw)).toThrow();
  });

  it("migrates a bare drift-id string (old Selfwright-native stub) to keywords-only", () => {
    const raw = { inject_drifts: ["DRIFT-SYN-003"] };
    const overlay = migrateCareerPlanOverlay(raw);
    expect(overlay.drift_applications).toEqual([
      { id: "DRIFT-SYN-003", mode: "keywords-only", allow_high_risk: false },
    ]);
  });

  it("migrates an entry with an unrecognized mode conservatively to keywords-only", () => {
    const raw = { inject_drifts: [{ id: "DRIFT-SYN-004", role: "Acme Corp", mode: "something-new" }] };
    const overlay = migrateCareerPlanOverlay(raw);
    expect(overlay.drift_applications).toEqual([
      { id: "DRIFT-SYN-004", mode: "keywords-only", allow_high_risk: false },
    ]);
  });

  it("passes drift_applications through unchanged when already canonical", () => {
    const raw = {
      drift_applications: [{ id: "DRIFT-SYN-005", mode: "keywords-only", allow_high_risk: true }],
    };
    const overlay = migrateCareerPlanOverlay(raw);
    expect(overlay.drift_applications).toEqual([
      { id: "DRIFT-SYN-005", mode: "keywords-only", allow_high_risk: true },
    ]);
  });

  it("is a no-op for an overlay with neither inject_drifts nor drift_applications", () => {
    const raw = { archetype: "ctrm-enterprise-architect", headline: "Enterprise Architect" };
    const overlay = migrateCareerPlanOverlay(raw);
    expect(overlay).toEqual(raw);
    expect(overlay.drift_applications).toBeUndefined();
  });

  it("ignores a non-array inject_drifts value rather than crashing", () => {
    const raw = { inject_drifts: "not-an-array" };
    const overlay = migrateCareerPlanOverlay(raw);
    expect(overlay.drift_applications).toBeUndefined();
  });

  it("throws a Zod error when a migrated entry is still invalid (missing id)", () => {
    const raw = { inject_drifts: [{ role: "Acme Corp", mode: "replace", replace_bullet: 0 }] };
    expect(() => migrateCareerPlanOverlay(raw)).toThrow();
  });

  it("handles a raw overlay that is not an object", () => {
    expect(migrateCareerPlanOverlay(null)).toEqual({});
    expect(migrateCareerPlanOverlay(undefined)).toEqual({});
  });
});
