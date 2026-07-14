# 0015 — Reporting layer: north-star first, fitness trend persistence, dual-tool BI evaluation

- Status: Accepted (2026-07-09)
- Supersedes: none. Implements T3.4 (anchor §10 Phase 3, runbook §8; decision D18).

## Context

T3.4 asks for the BI layer (anchor §7.2/§9): Metabase + Evidence.dev over the Postgres
projection per D18 ("run both, keep one — learn, then decide"), the fitness suite tracked over
time, and the north-star metric (interview-conversion rate per 10 applications,
`docs/metrics.md`) shipped before any broader BI. Anchor §8 constrains Metabase specifically:
AGPL dependencies stay at arm's length — separate service, never linked into the core.

Two prior decisions shape everything here. ADR 0006 removed per-call USD cost from the default
path (subscription-only, co-piloted), so "dashboards" cannot mean spend dashboards — the
load-bearing quantities are funnel outcomes (the north-star) and platform health (the fitness
suite). ADR 0009 made Postgres a rebuildable projection of the git truth, never a source of
truth — which is exactly the posture a BI layer wants: dashboards read a disposable mirror, and
nothing in `packages/core` or `apps/` ever reads back from the reporting tables.

## Decision

### North-star before BI

`computeNorthStar(applications)` is a pure core function (`services/north-star.ts`):
`submitted` = applications whose status is one of applied/interview/offer/rejected/withdrawn;
`interviews` = status interview or offer; `ratePerTen` = interviews/submitted × 10 (null when
nothing submitted). It surfaces in `selfwright metrics` (text + JSON) with no database required —
the metric must be readable even if the owner never starts a container. Known, documented
limitation (`docs/metrics.md`): status history is not tracked, so an application that interviewed
and later closed counts as submitted-but-not-interviewed; the metric is a floor, not an exact
count. Fixing that would require an application status-history ledger — deferred until the
undercount demonstrably matters.

### Fitness trend: persist locally, chart from the projection

`fitness/src/runner.ts` appends one JSON record per run (timestamp + per-check name/passed/
skipped) to `reports/fitness-history.jsonl` — same gitignored-local convention as
`usage.jsonl`, best-effort (a write failure never changes the runner's output or exit code; the
gate's semantics are sacred). `tools/sync-db.ts` upserts the history into a `fitness_runs`
projection table (idempotent on run_at+name), alongside a new `applications` funnel table synced
from `applications.yml`. Both tables follow ADR 0009: local container, rebuildable, write-only
from the sync tool's perspective, no embeddings (BI rows, not retrieval rows).

### D18: two tools, one evaluation, explicit exit criteria

- **Metabase** — separate compose service only (official image, own app-database inside the
  existing postgres container, reached only by a human browser on :3000). The AGPL boundary is
  enforced structurally: no SDK, no API call, no import anywhere in `packages/` or `apps/`.
- **Evidence.dev** — `infra/evidence/`, a standalone npm project deliberately OUTSIDE the pnpm
  workspace (its dependency tree must not enter the monorepo lockfile; MIT, so the isolation is
  hygiene, not license law). Two pages: the north-star funnel (SQL mirrors `north-star.ts`,
  which stays the canonical definition) and the fitness trend.
- `docs/design/reporting-evaluation-d18.md` holds the evaluation criteria and window; the loser
  is removed (compose service or project dir). Running both indefinitely is explicitly not an
  outcome — D18 is "learn, then decide," and this ADR is the "learn" half.

## What is NOT changed

No new fitness function (the suite's own trend is now data, but the gate set is unchanged). No
scheduler — sync and dashboards are owner-run. No dashboard writes back to anything. Core stays
I/O-free; the north-star computation takes plain records and is surfaced by the CLI, mirroring
every other service.

## Consequences

- The north-star is now computable in one command and chartable in two tools, anchoring anchor
  §14's "judge progress by applications sent and conversations had."
- Fitness history turns the suite from a gate into a trend — regressions in flakiness or
  coverage of the gate set become visible over time (anchor §7.2 "fitness results tracked over
  time").
- Two BI tools cost double maintenance until the D18 decision lands — accepted, time-boxed, with
  written exit criteria.

## Amendment — 2026-07-10: sync-db degrades gracefully when the embedding service is down

`tools/sync-db.ts` wraps the evidence + archetype vector sync in a try/catch. When the
embedding service (Ollama) is unreachable — a connection/fetch error rather than an HTTP
error — it logs one warning to stderr and skips the vector section entirely. The
applications and fitness_runs reporting tables always sync afterward, so the D18 dashboards
work with minimal infra: no Ollama required for BI reads.

## Amendment — 2026-07-10: durable telemetry moved to the data repo

`fitness-history.jsonl` and `usage.jsonl` now live under `<dataDir>/telemetry/` (inside the
private Selfwright-data repo) instead of `reports/` (framework-local, gitignored). The data repo
is versioned and pushed, so telemetry survives reformats and machine migrations. Best-effort and
skip-on-no-data-dir semantics are unchanged. `reports/mcp-errors.jsonl` remains framework-local.

## Amendment — 2026-07-13: D18 closed (owner decision)

D18 is closed. No single winner was required. All four optional services — Metabase,
Evidence.dev, Ollama, and mem0 — are now optional Docker Compose profiles, default off,
shipped in T5.12. Profiles: `reporting-evidence` (Evidence.dev, :3001), `reporting-metabase`
(Metabase BI, :3000, AGPL arm's-length), `embeddings` (Ollama, :11434), `memory` (mem0 +
Ollama, :8050). `docker compose up -d` with no flags starts postgres only.

The cockpit (ADR 0016 rewritten, T5.10) is the primary reporting and workflow surface.
Evidence.dev may be iframe-embedded in the cockpit's Reporting page when its profile is on;
Metabase is link-out only (opening `:3000` in a browser). The "double maintenance until D18
lands" cost noted in the Consequences section is resolved: neither tool runs by default, so
neither needs operational attention unless the owner opts in.

The two amendments above (sync-db graceful degradation; durable telemetry) continue to hold
unchanged under this posture. `docs/design/reporting-evaluation-d18.md` records the
evaluation criteria that informed this outcome.

## Alternatives considered

- **One tool now, remove the other.** Rejected at D18 close: the two tools serve different
  use cases (GUI exploration vs. versioned dashboards-as-code), and making both optional
  costs nothing when neither runs by default. The original rejection rationale still applies;
  the new resolution is lower-friction than removing either.
- **Fitness history straight into Postgres from the runner.** Rejected: the runner must work
  with zero infrastructure (CI, fresh clones); JSONL locally + sync mirrors the
  usage-telemetry pattern already in place.
- **A status-history ledger for exact interview counting.** Rejected as speculative scope; the
  documented undercount is honest and the ledger can be added when it matters.
