import type { Sql } from "./types.js";

// Postgres + pgvector is a rebuildable projection of the git truth (ADR 0009) — never
// source of truth — so migrate() is intentionally idempotent (CREATE ... IF NOT EXISTS).
export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;

  await sql`
    CREATE TABLE IF NOT EXISTS evidence (
      id        TEXT PRIMARY KEY,
      title     TEXT NOT NULL,
      kind      TEXT NOT NULL,
      signals   TEXT[],
      embedding vector(768)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS archetypes (
      id        TEXT PRIMARY KEY,
      label     TEXT NOT NULL,
      keywords  TEXT[],
      embedding vector(768)
    )
  `;

  // applications: BI/funnel projection of the YAML applications ledger (no embedding — BI use only).
  await sql`
    CREATE TABLE IF NOT EXISTS applications (
      id          TEXT PRIMARY KEY,
      company     TEXT NOT NULL,
      role        TEXT NOT NULL,
      status      TEXT NOT NULL,
      discovered  DATE NULL,
      promoted    DATE NULL,
      applied     DATE NULL,
      last_update DATE NULL,
      fit_score   REAL NULL,
      ats_overall REAL NULL
    )
  `;

  // fitness_runs: one row per check per fitness-runner invocation (BI/trend use only).
  await sql`
    CREATE TABLE IF NOT EXISTS fitness_runs (
      run_at  TIMESTAMPTZ NOT NULL,
      name    TEXT        NOT NULL,
      passed  BOOLEAN     NOT NULL,
      skipped BOOLEAN     NOT NULL,
      PRIMARY KEY (run_at, name)
    )
  `;

  // cv_bullets is not yet populated by tools/sync-db.ts — reserved for a future CV-bullet-level embedding pipeline.
  await sql`
    CREATE TABLE IF NOT EXISTS cv_bullets (
      id           TEXT PRIMARY KEY,
      role_title   TEXT NOT NULL,
      company      TEXT NOT NULL,
      bullet       TEXT NOT NULL,
      evidence_ids TEXT[],
      embedding    vector(768)
    )
  `;
}
