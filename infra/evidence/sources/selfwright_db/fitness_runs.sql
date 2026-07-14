-- Exports all fitness_runs rows so inline page queries can use selfwright_db.fitness_runs in DuckDB.
SELECT
    run_at,
    name,
    passed,
    skipped
FROM fitness_runs
