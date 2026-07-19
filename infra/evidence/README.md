# Selfwright — Evidence.dev dashboards

D18 evaluation project (run alongside Metabase, keep one — see `docs/design/reporting-evaluation-d18.md`).

This is a **standalone npm project**. It is NOT part of the pnpm workspace and must be installed
and run separately. Its lockfile and dependencies never enter the monorepo install.

## Running (Docker — recommended)

The supported way to run Evidence is via Docker Compose from the repo root:

```
docker compose --env-file .env -f infra/docker-compose.yml up -d evidence
```

This runs Evidence on **Node 22** in a container, independent of the host Node version. The host's
Node v24 is not supported by Evidence v40 and will not work for local `npm run dev`.

Evidence is served as a **static build**: the container runs `npm run sources` (fetches data from
Postgres), then `evidence build` (bakes the data into pre-rendered HTML), then serves the output
on port 3001 with `serve`. Data is a snapshot taken at build time. To refresh after a new
`pnpm sync-db`, rebuild the container:

```
docker compose --env-file .env -f infra/docker-compose.yml up -d --force-recreate evidence
```

The first start installs dependencies and builds the site (~2-5 min). Evidence will be available
at **http://localhost:3001** once the log shows `Accepting connections at`.

Check logs:
```
docker logs selfwright-evidence-1 -f
```

## Prerequisites

Postgres must be running and the projection tables populated:

```
docker compose --env-file .env -f infra/docker-compose.yml up -d postgres
pnpm sync-db
```

## Pages

- `/` — overview and links
- `/north-star` — interview-conversion funnel (submitted, interviews, rate per 10)
- `/fitness-trend` — fitness-check counts per run + latest-run per-check table

## D18 note

This is one of two tools being evaluated (Metabase = port 3000, Evidence = port 3001).
The evaluation window is 2-4 weeks. Whichever is not selected will have its
service/project removed; see `docs/design/reporting-evaluation-d18.md` for criteria.
