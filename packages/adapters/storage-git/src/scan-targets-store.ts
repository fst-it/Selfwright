// Scan-targets read/write helpers over <dataDir>/pipeline/scan-targets.yml
// (T5.11, /api/scan-targets). Follows the same audited git-commit path as
// settings-store.ts/application-store.ts (ADR 0019): caller composes
// read -> validate -> write -> commit -> revert.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { ScanTargetsConfigSchema } from "@selfwright/shared-config";
import type { ScanTargetsConfig } from "@selfwright/shared-config";

export const SCAN_TARGETS_REL = join("pipeline", "scan-targets.yml");

/** Read pipeline/scan-targets.yml raw text, or null if it doesn't exist. */
export async function readScanTargetsRawText(dataDir: string): Promise<string | null> {
  try {
    return await readFile(join(dataDir, SCAN_TARGETS_REL), "utf-8");
  } catch {
    return null;
  }
}

/**
 * Discriminated parse result — distinguishes "file absent" (safe to default
 * to { targets: [] }) from "file present but unparseable or schema-invalid"
 * (corrupt). Collapsing both to defaults (the pre-T5.16 behavior) let a
 * read-modify-write PUT silently overwrite a recoverable broken file with a
 * fresh default document.
 */
export type ParseScanTargetsResult =
  | { status: "absent" }
  | { status: "ok"; config: ScanTargetsConfig }
  | { status: "corrupt" };

/** Parse+validate raw pipeline/scan-targets.yml text. Never throws (never-crash convention). */
export function parseScanTargets(raw: string | null): ParseScanTargetsResult {
  if (raw === null) return { status: "absent" };
  try {
    const parsed: unknown = parseYaml(raw);
    const result = ScanTargetsConfigSchema.safeParse(parsed);
    return result.success ? { status: "ok", config: result.data } : { status: "corrupt" };
  } catch {
    return { status: "corrupt" };
  }
}

/** Serialize a validated scan-targets document to YAML text. */
export function stringifyScanTargets(config: ScanTargetsConfig): string {
  return stringifyYaml(config);
}

/**
 * Write raw text to pipeline/scan-targets.yml. Low-level (no validation) —
 * used both for the validated write path and for fail-closed revert.
 */
export async function writeScanTargetsFile(dataDir: string, raw: string): Promise<void> {
  await writeFile(join(dataDir, SCAN_TARGETS_REL), raw, "utf-8");
}
