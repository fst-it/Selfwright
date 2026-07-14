// Application status read/update helpers over <dataDir>/applications/applications.yml.
// Used by apps/web's status-update write action (ADR 0019). The optimistic-lock
// content-hash check is the caller's responsibility (compare hashApplicationsContent
// of the raw text read here against the value submitted with the form).
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export const APPLICATIONS_REL = join("applications", "applications.yml");

/** SHA-256 hex digest of raw file content — used as the optimistic-lock token. */
export function hashApplicationsContent(raw: string): string {
  return createHash("sha256").update(raw, "utf-8").digest("hex");
}

/** Read applications.yml raw text, or null if it doesn't exist. */
export async function readApplicationsRaw(dataDir: string): Promise<string | null> {
  try {
    return await readFile(join(dataDir, APPLICATIONS_REL), "utf-8");
  } catch {
    return null;
  }
}

export async function writeApplicationsRaw(dataDir: string, raw: string): Promise<void> {
  await writeFile(join(dataDir, APPLICATIONS_REL), raw, "utf-8");
}

export type ApplyStatusUpdateResult =
  | { ok: true; raw: string; previousStatus: string }
  | { ok: false; kind: "NOT_FOUND" | "PARSE_ERROR" };

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

/**
 * Apply a status (+ optional one-line note) update to one application entry,
 * identified by id, and set dates.last_update to `today` (YYYY-MM-DD).
 * Pure function over the raw YAML text — does not touch disk.
 */
export function applyStatusUpdate(
  raw: string,
  id: string,
  status: string,
  note: string | undefined,
  today: string,
): ApplyStatusUpdateResult {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    return { ok: false, kind: "PARSE_ERROR" };
  }
  if (!Array.isArray(parsed)) return { ok: false, kind: "PARSE_ERROR" };

  const idx = parsed.findIndex(
    (a: unknown) => isRecord(a) && a["id"] === id,
  );
  if (idx < 0) return { ok: false, kind: "NOT_FOUND" };

  const app = parsed[idx] as Record<string, unknown>;
  const previousStatus = typeof app["status"] === "string" ? app["status"] : "";
  app["status"] = status;
  if (note !== undefined && note.length > 0) {
    app["notes"] = note;
  }
  const existingDates = isRecord(app["dates"]) ? app["dates"] : {};
  app["dates"] = { ...existingDates, last_update: today };

  return { ok: true, raw: stringifyYaml(parsed), previousStatus };
}
