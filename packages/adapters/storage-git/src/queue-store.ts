// Queue read/dismiss helpers over <dataDir>/pipeline/queue.yml (T5.10, ADR
// 0024). Kept symmetric with application-store.ts/settings-store.ts: this
// module only reads/mutates the raw YAML text; the caller (apps/web)
// composes read -> mutate -> write -> commit -> revert, same as every other
// write route.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { QueueEntry } from "@selfwright/core";

export const QUEUE_REL = join("pipeline", "queue.yml");

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

/** SHA-256 hex digest of raw file content — used as the promote route's optimistic-lock token (mirrors hashApplicationsContent). */
export function hashQueueContent(raw: string): string {
  return createHash("sha256").update(raw, "utf-8").digest("hex");
}

/** Read queue.yml raw text, or null if it doesn't exist. */
export async function readQueueRaw(dataDir: string): Promise<string | null> {
  try {
    return await readFile(join(dataDir, QUEUE_REL), "utf-8");
  } catch {
    return null;
  }
}

export async function writeQueueRaw(dataDir: string, raw: string): Promise<void> {
  await writeFile(join(dataDir, QUEUE_REL), raw, "utf-8");
}

export type RemoveQueueEntryResult =
  | { ok: true; raw: string; entry: QueueEntry }
  | { ok: false; kind: "NOT_FOUND" | "PARSE_ERROR" };

/**
 * Remove one queue entry by id (used by both dismiss and promote — promote
 * removes the entry from the queue in the same way dismiss does, then
 * additionally appends the mapped ApplicationRecord elsewhere). Pure over
 * the raw YAML text; a missing queue.yml (raw === null) or an id that isn't
 * present both report NOT_FOUND (there is no entry to remove either way).
 */
export function removeQueueEntry(raw: string | null, id: string): RemoveQueueEntryResult {
  if (raw === null) return { ok: false, kind: "NOT_FOUND" };

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    return { ok: false, kind: "PARSE_ERROR" };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed["queue"])) {
    return { ok: false, kind: "PARSE_ERROR" };
  }

  const queue = parsed["queue"] as QueueEntry[];
  const idx = queue.findIndex((e) => isRecord(e) && e["id"] === id);
  if (idx < 0) return { ok: false, kind: "NOT_FOUND" };

  const removed = queue[idx] as QueueEntry;
  const remaining = [...queue.slice(0, idx), ...queue.slice(idx + 1)];

  return { ok: true, raw: stringifyYaml({ queue: remaining }), entry: removed };
}
