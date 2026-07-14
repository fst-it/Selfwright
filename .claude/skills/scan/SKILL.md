---
name: scan
description: Scan configured job sources (company career pages and public ATS boards) for new postings, dedupe, check liveness, score fit, and update the pipeline queue. Use when the user wants to discover new roles, run a job scan, or check for new postings from tracked companies.
argument-hint: "[--targets <path>] [--dry-run]"
---

# scan

Runs Selfwright's deterministic scanner (`packages/core/src/scanning/`, ADR 0007) against the
companies/providers configured in `config/scan-targets.yml`: fetches postings from 19 providers
(ATS boards: Greenhouse, Lever, Ashby, Workday, SmartRecruiters, BambooHR, Oracle Fusion,
Recruitee, Personio, Workable, Breezy; aggregators: Adzuna, Arbeitnow, Remotive, Himalayas,
WeWorkRemotely, RemoteOK; a generic schema.org fetcher; and a Playwright browser provider for
bot-gated Workday tenants), dedupes, classifies liveness, scores 6-dimension scan-time fit
(reusing the same rubric as the `score` skill), and appends new, live, non-degenerate matches to
the pipeline queue. Fully deterministic — no LLM call, no LinkedIn scraping.

## How to run it

Requires `SELFWRIGHT_DATA_DIR` set (writes `pipeline/queue.yml` and `pipeline/scan-history.yml`
there).

```
pnpm selfwright scan [--targets <path>] [--dry-run]
```

- `--targets` — path to the scan-targets config (default `config/scan-targets.yml`). Each entry
  needs `company`, `provider` (one of `greenhouse|lever|ashby|workday|smartrecruiters|bamboohr|
  oracle|recruitee|personio|workable|breezy|adzuna|arbeitnow|remotive|himalayas|weworkremotely|
  remoteok|generic|workday-browser`), and either `careersUrl` or an explicit `api` URL.
- `--dry-run` — fetch, dedupe, and score, but don't write `queue.yml`/`scan-history.yml`. Use
  this first when adding a new target to confirm it resolves and fetches correctly before letting
  it persist to the real pipeline files.

## Interpreting the output

Prints a one-line summary to stderr: fetched / deduped / already-seen / expired / queued counts,
plus a `[scan] warn: ...` line per target that failed (unknown provider, network error, blocked
fetch). A target failing doesn't stop the rest of the scan — each target is isolated.

**A URL is recorded as "seen" forever once scanned, whether or not it gets queued** (in
`scan-history.yml`) — this is intentional (see ADR 0007): it stops an already-triaged-and-rejected
role from resurfacing on the next run. If a target should genuinely be re-scanned (e.g. you want
to re-check liveness), that's not supported by this command as-is; don't try to work around it by
hand-editing `scan-history.yml` without understanding why an entry is there.

**Only postings that clear the non-degeneracy floor get queued** (same rule as the `score`
skill — `archetype !== null`, `grade !== "F"`) — an expired or non-matching posting is recorded in
the seen ledger but never reaches `queue.yml`. After a scan, follow up with the `inbox` skill to
see what landed in the queue.
