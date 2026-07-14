import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  SCAN_TARGETS_REL,
  readScanTargetsRawText,
  parseScanTargets,
  stringifyScanTargets,
  writeScanTargetsFile,
} from "../scan-targets-store.js";

function makeDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-scan-targets-store-"));
  mkdirSync(join(dir, "pipeline"), { recursive: true });
  return dir;
}

const SAMPLE_YAML = "targets:\n  - company: Acme\n    provider: greenhouse\n";

describe("scan-targets-store", () => {
  it("readScanTargetsRawText returns null when the file doesn't exist", async () => {
    const dir = makeDataDir();
    try {
      expect(await readScanTargetsRawText(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parseScanTargets returns status:absent for null (missing file)", () => {
    expect(parseScanTargets(null)).toEqual({ status: "absent" });
  });

  it("parseScanTargets returns status:corrupt for malformed YAML", () => {
    expect(parseScanTargets("::: not valid yaml [")).toEqual({ status: "corrupt" });
  });

  it("parseScanTargets returns status:corrupt for schema-invalid content", () => {
    // 'company' is required — missing it fails validation
    expect(parseScanTargets("targets:\n  - provider: greenhouse\n")).toEqual({ status: "corrupt" });
  });

  it("parseScanTargets returns status:ok with the validated document for valid content", () => {
    const result = parseScanTargets(SAMPLE_YAML);
    if (result.status !== "ok") throw new Error("expected status:ok");
    expect(result.config.targets).toHaveLength(1);
    expect(result.config.targets[0]?.company).toBe("Acme");
    expect(result.config.targets[0]?.provider).toBe("greenhouse");
  });

  it("parseScanTargets preserves the disabled field when present", () => {
    const raw = "targets:\n  - company: Acme\n    provider: greenhouse\n    disabled: true\n";
    const result = parseScanTargets(raw);
    if (result.status !== "ok") throw new Error("expected status:ok");
    expect(result.config.targets[0]?.disabled).toBe(true);
  });

  it("stringifyScanTargets round-trips through parseScanTargets", () => {
    const config = { targets: [{ company: "Beta", provider: "lever" as const }] };
    expect(parseScanTargets(stringifyScanTargets(config))).toEqual({ status: "ok", config });
  });

  it("writeScanTargetsFile writes raw text at SCAN_TARGETS_REL and readScanTargetsRawText reads it back", async () => {
    const dir = makeDataDir();
    try {
      await writeScanTargetsFile(dir, SAMPLE_YAML);
      expect(await readScanTargetsRawText(dir)).toBe(SAMPLE_YAML);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writeScanTargetsFile overwrites existing content", async () => {
    const dir = makeDataDir();
    try {
      writeFileSync(join(dir, SCAN_TARGETS_REL), SAMPLE_YAML);
      const newYaml = "targets:\n  - company: Delta\n    provider: ashby\n";
      await writeScanTargetsFile(dir, newYaml);
      expect(await readScanTargetsRawText(dir)).toBe(newYaml);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
