import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  SETTINGS_REL,
  readSettingsRawText,
  parseSettings,
  stringifySettings,
  writeSettingsFile,
} from "../settings-store.js";

function makeDataDir(): string {
  return mkdtempSync(join(tmpdir(), "sw-settings-store-"));
}

describe("settings-store", () => {
  it("readSettingsRawText returns null when the file doesn't exist", async () => {
    const dir = makeDataDir();
    try {
      expect(await readSettingsRawText(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parseSettings returns status:absent for null (missing file)", () => {
    expect(parseSettings(null)).toEqual({ status: "absent" });
  });

  it("parseSettings returns status:corrupt for malformed YAML", () => {
    expect(parseSettings("::: not valid yaml [")).toEqual({ status: "corrupt" });
  });

  it("parseSettings returns status:corrupt for schema-invalid content", () => {
    expect(parseSettings("queue:\n  aging_window_days: -5\n")).toEqual({ status: "corrupt" });
  });

  it("parseSettings returns status:ok with the validated document for valid content", () => {
    expect(parseSettings("queue:\n  aging_window_days: 14\n")).toEqual({
      status: "ok",
      settings: { queue: { aging_window_days: 14 } },
    });
  });

  it("stringifySettings round-trips through parseSettings", () => {
    const settings = { queue: { aging_window_days: 21 } };
    expect(parseSettings(stringifySettings(settings))).toEqual({ status: "ok", settings });
  });

  it("writeSettingsFile writes raw text at SETTINGS_REL and readSettingsRawText reads it back", async () => {
    const dir = makeDataDir();
    try {
      await writeSettingsFile(dir, "queue:\n  aging_window_days: 7\n");
      expect(await readSettingsRawText(dir)).toBe("queue:\n  aging_window_days: 7\n");
      expect(readFileSync(join(dir, SETTINGS_REL), "utf-8")).toBe("queue:\n  aging_window_days: 7\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writeSettingsFile overwrites existing content", async () => {
    const dir = makeDataDir();
    try {
      writeFileSync(join(dir, SETTINGS_REL), "queue:\n  aging_window_days: 7\n");
      await writeSettingsFile(dir, "queue:\n  aging_window_days: 30\n");
      expect(await readSettingsRawText(dir)).toBe("queue:\n  aging_window_days: 30\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
