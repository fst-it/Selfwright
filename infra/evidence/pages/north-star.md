---
title: North-star metric — interview-conversion funnel
---

# North-star: interview-conversion funnel

The north-star metric is **interviews per 10 submitted applications**.
This mirrors `computeNorthStar()` in `packages/core/src/services/north-star.ts` exactly —
that file is the canonical definition; the SQL below must stay in sync with it.

```sql north_star
-- Mirror of computeNorthStar() in packages/core/src/services/north-star.ts
-- SUBMITTED_STATUSES = applied, interview, offer, rejected, withdrawn
-- INTERVIEWED_STATUSES = interview, offer
-- ratePerTen = Math.round((interviews / submitted) * 10 * 100) / 100
--            = ROUND((interviews::numeric / submitted) * 10, 2)
SELECT
    COUNT(*) FILTER (WHERE status IN ('applied', 'interview', 'offer', 'rejected', 'withdrawn'))
        AS submitted,
    COUNT(*) FILTER (WHERE status IN ('interview', 'offer'))
        AS interviews,
    CASE
        WHEN COUNT(*) FILTER (
                WHERE status IN ('applied', 'interview', 'offer', 'rejected', 'withdrawn')
             ) = 0
        THEN NULL
        ELSE ROUND(
            COUNT(*) FILTER (WHERE status IN ('interview', 'offer'))::numeric
            / COUNT(*) FILTER (WHERE status IN ('applied', 'interview', 'offer', 'rejected', 'withdrawn'))
            * 10,
            2
        )
    END AS rate_per_ten
FROM selfwright_db.applications
```

<BigValue data={north_star} value="submitted" title="Submitted" />
<BigValue data={north_star} value="interviews" title="Reached interview" />
<BigValue data={north_star} value="rate_per_ten" title="Interviews per 10 submitted" />

---

## By-status breakdown

```sql status_breakdown
SELECT
    status,
    COUNT(*) AS count
FROM selfwright_db.applications
GROUP BY status
ORDER BY count DESC
```

<DataTable data={status_breakdown} />

<BarChart
    data={status_breakdown}
    x="status"
    y="count"
    title="Applications by status"
/>
