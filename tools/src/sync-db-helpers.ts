/**
 * Pure guard helpers extracted from tools/sync-db.ts so they can be unit-tested
 * without a live Postgres connection.  sync-db.ts imports these at runtime.
 */

/**
 * Returns true when an error indicates that the embedding service (Ollama) is
 * unreachable — i.e. a network/connection failure rather than a logic or HTTP error.
 * Used by sync-db.ts to degrade gracefully: skip the vector sync and continue
 * syncing the reporting tables (applications, fitness_runs).
 */
export function isEmbedConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  // Node native fetch throws TypeError('fetch failed') for ECONNREFUSED/unreachable hosts
  if (msg.includes("fetch failed")) return true;
  if (msg.includes("econnrefused")) return true;
  if (msg.includes("econnreset")) return true;
  if (msg.includes("etimedout")) return true;
  // Node fetch also sets err.cause to the underlying system error
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const causeMsg = cause.message.toLowerCase();
    if (causeMsg.includes("econnrefused") || causeMsg.includes("fetch failed")) return true;
  }
  return false;
}

/** Returns true when the YAML-parsed array entry is a non-null object (valid application row candidate). */
export function isValidApplicationEntry(entry: unknown): entry is Record<string, unknown> {
  return entry !== null && typeof entry === "object";
}

/**
 * Returns true when a parsed JSON value looks like a valid fitness-history record:
 * a non-null object with a `results` array property.
 */
export function isValidFitnessRecord(
  record: unknown,
): record is { runAt: string; results: unknown[] } {
  return (
    record !== null &&
    typeof record === "object" &&
    Array.isArray((record as Record<string, unknown>)["results"])
  );
}
