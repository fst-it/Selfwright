import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readDebriefsRaw, loadDebriefs, appendDebrief, DEBRIEFS_REL } from "../debrief-store.js";
import type { Debrief } from "@selfwright/core";

function makeDataDir(): string {
  return mkdtempSync(join(tmpdir(), "sw-debrief-store-"));
}

describe("debrief-store", () => {
  it("readDebriefsRaw / loadDebriefs return null / [] when the file doesn't exist", async () => {
    const dir = makeDataDir();
    try {
      expect(await readDebriefsRaw(dir)).toBeNull();
      expect(await loadDebriefs(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("appendDebrief creates the file (mkdir -p) and loadDebriefs reads it back", async () => {
    const dir = makeDataDir();
    try {
      const entry: Debrief = { application_id: "APP-001", date: "2026-06-15", round: "HR screen" };
      await appendDebrief(dir, entry);

      const raw = await readDebriefsRaw(dir);
      expect(raw).not.toBeNull();

      const loaded = await loadDebriefs(dir);
      expect(loaded).toHaveLength(1);
      expect(loaded[0]).toEqual(entry);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("appendDebrief preserves existing entries (read-modify-write)", async () => {
    const dir = makeDataDir();
    try {
      await appendDebrief(dir, { application_id: "APP-001", date: "2026-06-01" });
      await appendDebrief(dir, { application_id: "APP-002", date: "2026-06-15" });

      const loaded = await loadDebriefs(dir);
      expect(loaded.map((d) => d.application_id)).toEqual(["APP-001", "APP-002"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loadDebriefs returns [] (never throws) for malformed YAML", async () => {
    const dir = makeDataDir();
    mkdirSync(join(dir, "coaching"), { recursive: true });
    try {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(join(dir, DEBRIEFS_REL), "::: not valid yaml [", "utf-8");
      expect(await loadDebriefs(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loadDebriefs returns [] for a file that doesn't match DebriefsFileSchema", async () => {
    const dir = makeDataDir();
    mkdirSync(join(dir, "coaching"), { recursive: true });
    try {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(join(dir, DEBRIEFS_REL), "not_debriefs: []\n", "utf-8");
      expect(await loadDebriefs(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
