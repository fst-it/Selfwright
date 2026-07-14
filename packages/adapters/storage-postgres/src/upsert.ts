import type { Sql } from "./types.js";
import { toVectorLiteral } from "./vector.js";

export type EvidenceRow = {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly signals: readonly string[];
};

export type ArchetypeRow = {
  readonly id: string;
  readonly label: string;
  readonly keywords: readonly string[];
};

export async function upsertEvidence(
  sql: Sql,
  item: EvidenceRow,
  embedding: readonly number[],
): Promise<void> {
  const vector = toVectorLiteral(embedding);
  await sql`
    INSERT INTO evidence (id, title, kind, signals, embedding)
    VALUES (${item.id}, ${item.title}, ${item.kind}, ${sql.array([...item.signals])}, ${vector}::vector)
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      kind = EXCLUDED.kind,
      signals = EXCLUDED.signals,
      embedding = EXCLUDED.embedding
  `;
}

export async function upsertArchetype(
  sql: Sql,
  item: ArchetypeRow,
  embedding: readonly number[],
): Promise<void> {
  const vector = toVectorLiteral(embedding);
  await sql`
    INSERT INTO archetypes (id, label, keywords, embedding)
    VALUES (${item.id}, ${item.label}, ${sql.array([...item.keywords])}, ${vector}::vector)
    ON CONFLICT (id) DO UPDATE SET
      label = EXCLUDED.label,
      keywords = EXCLUDED.keywords,
      embedding = EXCLUDED.embedding
  `;
}
