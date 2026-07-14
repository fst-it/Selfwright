// Debrief read/append helpers over <dataDir>/coaching/debriefs.yml.
// Shared by apps/cli and apps/web so the YAML read-modify-write convention lives
// in exactly one place (ADR 0019). Callers own git commit / validation.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { DebriefsFileSchema } from "@selfwright/core";
import type { Debrief } from "@selfwright/core";

export const DEBRIEFS_REL = join("coaching", "debriefs.yml");

async function tryReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/** Read the raw (unparsed) contents of debriefs.yml, or null if it doesn't exist. */
export async function readDebriefsRaw(dataDir: string): Promise<string | null> {
  return tryReadFile(join(dataDir, DEBRIEFS_REL));
}

/**
 * Load debriefs from <dataDir>/coaching/debriefs.yml.
 * Best-effort (never-crash convention): returns [] when the file is missing,
 * unparseable, or invalid. Callers that need strict validation (e.g. debrief
 * add) validate the new entry separately before appending.
 */
export async function loadDebriefs(dataDir: string): Promise<Debrief[]> {
  const raw = await readDebriefsRaw(dataDir);
  if (raw === null) return [];
  try {
    const parsed: unknown = parseYaml(raw);
    return DebriefsFileSchema.parse(parsed).debriefs;
  } catch {
    return [];
  }
}

/**
 * Append a new debrief entry to <dataDir>/coaching/debriefs.yml.
 * Read-modify-write; preserves existing entries.
 */
export async function appendDebrief(dataDir: string, entry: Debrief): Promise<void> {
  const existing = await loadDebriefs(dataDir);
  existing.push(entry);
  const debriefPath = join(dataDir, DEBRIEFS_REL);
  await mkdir(dirname(debriefPath), { recursive: true });
  await writeFile(debriefPath, stringifyYaml({ debriefs: existing }), "utf-8");
}
