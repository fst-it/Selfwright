import type { Sql } from "./types.js";

export async function pruneEvidence(sql: Sql, currentIds: readonly string[]): Promise<number> {
  const result = await sql`
    DELETE FROM evidence WHERE NOT (id = ANY(${sql.array([...currentIds])}::text[]))
  `;
  return result.count;
}

export async function pruneArchetypes(sql: Sql, currentIds: readonly string[]): Promise<number> {
  const result = await sql`
    DELETE FROM archetypes WHERE NOT (id = ANY(${sql.array([...currentIds])}::text[]))
  `;
  return result.count;
}
