import { describe, it, expect } from "vitest";
import {
  hashApplicationsContent,
  applyStatusUpdate,
  readApplicationsRaw,
  writeApplicationsRaw,
  APPLICATIONS_REL,
} from "../application-store.js";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const SYNTHETIC = [
  {
    id: "APP-001",
    company: "Acme Corp",
    role: "Principal Engineer",
    status: "applied",
    dates: { applied: "2026-06-01", last_update: "2026-06-01" },
  },
  {
    id: "APP-002",
    company: "Beta Ltd",
    role: "Staff Engineer",
    status: "interview",
    dates: { applied: "2026-05-15", last_update: "2026-05-20" },
    notes: "existing note",
  },
];

describe("hashApplicationsContent", () => {
  it("is deterministic for the same content", () => {
    const raw = stringifyYaml(SYNTHETIC);
    expect(hashApplicationsContent(raw)).toBe(hashApplicationsContent(raw));
  });

  it("differs when content differs", () => {
    const a = stringifyYaml(SYNTHETIC);
    const b = stringifyYaml([...SYNTHETIC, { id: "APP-003" }]);
    expect(hashApplicationsContent(a)).not.toBe(hashApplicationsContent(b));
  });
});

describe("applyStatusUpdate", () => {
  it("updates status, sets dates.last_update, and returns the previous status", () => {
    const raw = stringifyYaml(SYNTHETIC);
    const result = applyStatusUpdate(raw, "APP-001", "interview", undefined, "2026-07-11");
    if (!result.ok) throw new Error("expected ok");
    expect(result.previousStatus).toBe("applied");

    const parsed: unknown = parseYaml(result.raw);
    const updated = (parsed as Array<{ id: string; status: string; dates: { last_update: string } }>).find(
      (a) => a.id === "APP-001",
    );
    expect(updated?.status).toBe("interview");
    expect(updated?.dates.last_update).toBe("2026-07-11");
  });

  it("sets notes when a non-empty note is provided", () => {
    const raw = stringifyYaml(SYNTHETIC);
    const result = applyStatusUpdate(raw, "APP-001", "interview", "moved to onsite", "2026-07-11");
    if (!result.ok) throw new Error("expected ok");
    const parsed: unknown = parseYaml(result.raw);
    const updated = (parsed as Array<{ id: string; notes?: string }>).find((a) => a.id === "APP-001");
    expect(updated?.notes).toBe("moved to onsite");
  });

  it("leaves existing notes untouched when no note is provided", () => {
    const raw = stringifyYaml(SYNTHETIC);
    const result = applyStatusUpdate(raw, "APP-002", "offer", undefined, "2026-07-11");
    if (!result.ok) throw new Error("expected ok");
    const parsed: unknown = parseYaml(result.raw);
    const updated = (parsed as Array<{ id: string; notes?: string }>).find((a) => a.id === "APP-002");
    expect(updated?.notes).toBe("existing note");
  });

  it("returns NOT_FOUND for an unknown id", () => {
    const raw = stringifyYaml(SYNTHETIC);
    const result = applyStatusUpdate(raw, "NO-SUCH-ID", "interview", undefined, "2026-07-11");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("NOT_FOUND");
  });

  it("returns PARSE_ERROR for unparseable YAML", () => {
    const result = applyStatusUpdate("::: not yaml [", "APP-001", "interview", undefined, "2026-07-11");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("PARSE_ERROR");
  });

  it("returns PARSE_ERROR when the YAML root is not an array", () => {
    const result = applyStatusUpdate("just: a-map\n", "APP-001", "interview", undefined, "2026-07-11");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("PARSE_ERROR");
  });
});

describe("readApplicationsRaw / writeApplicationsRaw", () => {
  it("round-trips through the data dir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sw-app-store-"));
    mkdirSync(join(dir, "applications"), { recursive: true });
    try {
      expect(await readApplicationsRaw(dir)).toBeNull();
      const raw = stringifyYaml(SYNTHETIC);
      await writeApplicationsRaw(dir, raw);
      expect(await readApplicationsRaw(dir)).toBe(raw);
      expect(APPLICATIONS_REL).toContain("applications.yml");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
