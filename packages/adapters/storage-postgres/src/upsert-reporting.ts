import type { Sql } from "./types.js";

export type ApplicationRow = {
  readonly id: string;
  readonly company: string;
  readonly role: string;
  readonly status: string;
  readonly discovered: string | null;
  readonly promoted: string | null;
  readonly applied: string | null;
  readonly last_update: string | null;
  readonly fit_score: number | null;
  readonly ats_overall: number | null;
};

export type FitnessRunRow = {
  readonly run_at: string;
  readonly name: string;
  readonly passed: boolean;
  readonly skipped: boolean;
};

export async function upsertApplication(sql: Sql, row: ApplicationRow): Promise<void> {
  await sql`
    INSERT INTO applications (id, company, role, status, discovered, promoted, applied, last_update, fit_score, ats_overall)
    VALUES (
      ${row.id}, ${row.company}, ${row.role}, ${row.status},
      ${row.discovered}, ${row.promoted}, ${row.applied}, ${row.last_update},
      ${row.fit_score}, ${row.ats_overall}
    )
    ON CONFLICT (id) DO UPDATE SET
      company     = EXCLUDED.company,
      role        = EXCLUDED.role,
      status      = EXCLUDED.status,
      discovered  = EXCLUDED.discovered,
      promoted    = EXCLUDED.promoted,
      applied     = EXCLUDED.applied,
      last_update = EXCLUDED.last_update,
      fit_score   = EXCLUDED.fit_score,
      ats_overall = EXCLUDED.ats_overall
  `;
}

export async function upsertFitnessRun(sql: Sql, row: FitnessRunRow): Promise<void> {
  await sql`
    INSERT INTO fitness_runs (run_at, name, passed, skipped)
    VALUES (${row.run_at}, ${row.name}, ${row.passed}, ${row.skipped})
    ON CONFLICT (run_at, name) DO NOTHING
  `;
}
