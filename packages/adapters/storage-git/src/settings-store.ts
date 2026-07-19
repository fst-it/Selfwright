// Settings read/write helpers over <dataDir>/settings.yml (T5.9, /api/settings).
// Reuses the same audited git-commit path as applications/debriefs (ADR
// 0019): the caller (apps/web) composes read -> validate -> write -> commit
// -> revert. Kept symmetric with application-store.ts/debrief-store.ts.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { SettingsSchema } from "@selfwright/shared-config";
import type { Settings } from "@selfwright/shared-config";

export const SETTINGS_REL = "settings.yml";

/** Read settings.yml raw text, or null if it doesn't exist. */
export async function readSettingsRawText(dataDir: string): Promise<string | null> {
  try {
    return await readFile(join(dataDir, SETTINGS_REL), "utf-8");
  } catch {
    return null;
  }
}

/**
 * Discriminated parse result — distinguishes "file absent" (safe to default)
 * from "file present but unparseable or schema-invalid" (corrupt). Collapsing
 * both to defaults (the pre-T5.16 behavior) let a read-modify-write PUT
 * silently overwrite a recoverable broken file with a fresh default document.
 */
export type ParseSettingsResult =
  | { status: "absent" }
  | { status: "ok"; settings: Settings }
  | { status: "corrupt" };

/** Parse+validate raw settings.yml text. Never throws (never-crash convention). */
export function parseSettings(raw: string | null): ParseSettingsResult {
  if (raw === null) return { status: "absent" };
  try {
    const parsed: unknown = parseYaml(raw);
    const result = SettingsSchema.safeParse(parsed);
    return result.success ? { status: "ok", settings: result.data } : { status: "corrupt" };
  } catch {
    return { status: "corrupt" };
  }
}

/** Serialize a validated settings document to YAML text. */
export function stringifySettings(settings: Settings): string {
  return stringifyYaml(settings);
}

/**
 * Write raw text to settings.yml. Low-level (no validation) — used both for
 * the validated write path and for fail-closed revert of a pre-write snapshot.
 */
export async function writeSettingsFile(dataDir: string, raw: string): Promise<void> {
  await writeFile(join(dataDir, SETTINGS_REL), raw, "utf-8");
}
