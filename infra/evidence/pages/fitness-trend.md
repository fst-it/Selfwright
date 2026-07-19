---
title: Fitness trend — checks over time
---

# Fitness-function trend

Passed, failed, and skipped check counts per fitness-runner invocation.
Populated by `pnpm fitness` → `reports/fitness-history.jsonl` → `pnpm sync-db`.

```sql fitness_trend
-- Passed/failed/skipped per fitness-runner run (one row per run_at timestamp).
-- fitness_runs has one row per check per run; aggregate to get run-level counts.
SELECT
    run_at,
    COUNT(*) FILTER (WHERE passed = true  AND skipped = false) AS passed,
    COUNT(*) FILTER (WHERE passed = false AND skipped = false) AS failed,
    COUNT(*) FILTER (WHERE skipped = true)                      AS skipped
FROM selfwright_db.fitness_runs
GROUP BY run_at
ORDER BY run_at
```

<LineChart
    data={fitness_trend}
    x="run_at"
    y={["passed", "failed", "skipped"]}
    title="Fitness checks over time"
    yMin=0
/>

---

## Latest run — per-check status

```sql latest_run
-- All check results from the most recent fitness-runner invocation.
SELECT
    fr.name,
    fr.passed,
    fr.skipped,
    fr.run_at
FROM selfwright_db.fitness_runs AS fr
JOIN (
    SELECT MAX(run_at) AS run_at FROM selfwright_db.fitness_runs
) AS latest ON fr.run_at = latest.run_at
ORDER BY fr.name
```

<DataTable data={latest_run} />
