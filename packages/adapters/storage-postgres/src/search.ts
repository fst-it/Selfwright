import type { Sql } from "./types.js";
import { toVectorLiteral } from "./vector.js";

export type SearchTable = "evidence" | "archetypes" | "cv_bullets";

const SEARCHABLE_TABLES: ReadonlySet<SearchTable> = new Set([
  "evidence",
  "archetypes",
  "cv_bullets",
]);

// searchByEmbedding currently has no caller in product code (only its own unit test) — it is a library primitive ready for whichever future feature needs semantic search over these tables.
export async function searchByEmbedding(
  sql: Sql,
  table: SearchTable,
  embedding: readonly number[],
  topK: number,
): Promise<readonly Record<string, unknown>[]> {
  if (!SEARCHABLE_TABLES.has(table)) {
    throw new Error(`searchByEmbedding: unknown table "${table}"`);
  }
  const vector = toVectorLiteral(embedding);
  return sql`
    SELECT *, embedding <=> ${vector}::vector AS distance
    FROM ${sql(table)}
    ORDER BY distance ASC
    LIMIT ${topK}
  `;
}
