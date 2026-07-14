# Reporting evaluation — D18 (Metabase vs Evidence.dev)

Decision D18 in the anchor: "Reporting = Metabase + Evidence.dev (run both, keep one — learn, then decide)."
This is an evaluation, not a commitment. Both tools run simultaneously; one will be removed after the window.

## The two tools

**Metabase** (port 3000, `infra/docker-compose.yml`)

GUI-driven business intelligence. No code required to build or modify dashboards — everything is
point-and-click in the browser, including filters, drill-through, and chart types. Connects to any
SQL database; supports scheduled question emails and mobile-responsive layouts. License: AGPL v3.

Selfwright deployment: connects to the `selfwright` Postgres database via a read-only connection
configured manually in the Metabase GUI. Its own application state lives in a separate `metabase`
database (same Postgres instance, different DB). Per anchor §8, Metabase is arm's-length: a
separate Docker service, never imported or called programmatically by any code in `packages/` or
`apps/`.

**Evidence.dev** (port 3001, `infra/evidence/`)

Code-first SQL + markdown reports. Dashboard pages live in `infra/evidence/pages/` as plain
markdown files with SQL code blocks and component tags. Versioned in git alongside the codebase;
diffs are reviewable. Components (`<LineChart>`, `<DataTable>`, `<BigValue>`) render in a SvelteKit
app. Standalone npm project — not part of the pnpm workspace. License: MIT.

Selfwright deployment: queries the `selfwright` Postgres projection tables directly. Pages live in
the repo and can be reviewed in PRs alongside schema changes. Evidence runs containerized on Node 22
(`docker compose up -d evidence`); the host Node v24 is not supported by Evidence v40.

Evidence is served as a **static build** (not the Vite dev server). The container runs
`npm run sources` (pulls data from Postgres at build time), `evidence build` (pre-renders HTML with
data baked in), then `npx serve` (plain static HTTP server). Data is a snapshot; refresh it by
rebuilding the container after a new `pnpm sync-db`:
`docker compose --env-file .env -f infra/docker-compose.yml up -d --force-recreate evidence`.

## Evaluation criteria

| Criterion | What to measure |
|---|---|
| Setup friction | Time from `docker compose up` / `npm install` to first working dashboard |
| Iteration speed | How fast is it to add a new chart or adjust a query? |
| Maintenance cost | What breaks when the schema changes, and what does fixing it cost? |
| Git/markdown fit | Does it fit the existing markdown + git workflow, or fight it? |
| License posture | AGPL arm's-length adds operational overhead; MIT in-repo is cleaner for the open-core path |
| Mobile/remote readability | Readable on iPhone over Tailscale (relevant to T3.6)? |

## Usage questions to answer during the evaluation window (2-4 weeks)

1. Can a new dashboard page or chart be added in under 15 minutes?
2. Does the fitness-trend chart update automatically after `pnpm fitness && pnpm sync-db`?
3. Is the Metabase mobile view usable on an iPhone over a Tailscale tunnel?
4. Does `npm run build` in `infra/evidence/` produce a static site that Tailscale-serve can host?
5. Which requires more work after a `fitness_runs` column rename?

## Decision rule

- If Evidence.dev answers questions 1, 2, 4, and 5 satisfactorily: keep Evidence, remove Metabase.
- If Metabase is stronger on mobile (question 3) and setup friction is lower (question 1): keep
  Metabase, remove `infra/evidence/`.
- If both are satisfactory for different use cases, document the split in an ADR and keep both.

## What to remove when the loser is chosen

**If removing Metabase:** delete the `metabase` service block from `infra/docker-compose.yml`,
remove the `./postgres-init` volume mount from the `postgres` service, and delete
`infra/postgres-init/`. Drop the DB first:
```
docker exec -it selfwright-postgres-1 dropdb -U selfwright metabase
```

**If removing Evidence.dev:** delete `infra/evidence/` (including `node_modules/` if installed).
No compose or schema changes needed.

## Outcome — D18 closed (2026-07-13)

Owner decision: no single winner required. Both tools become optional Docker Compose profiles,
default off (shipped in T5.12). `docker compose up -d` starts postgres only; reporting tools
are opt-in via named profiles:

- `reporting-evidence` — Evidence.dev on port 3001
- `reporting-metabase` — Metabase on port 3000

Neither tool runs by default, so neither needs operational attention unless the owner explicitly
enables its profile. The cockpit (ADR 0016 rewritten) is the primary reporting surface.
Evidence.dev may be iframe-embedded in the cockpit's Reporting page when its profile is on;
Metabase is link-out only.

The "removal" instructions above no longer apply: there is nothing to remove. Both services
remain in the compose file as named profiles, dormant by default, available on demand.
