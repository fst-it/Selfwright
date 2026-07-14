# 0009 — Postgres + pgvector as a rebuildable semantic projection

- Status: Accepted (2026-07-07)
- Supersedes: none. Implements T2.7 (anchor §10 Phase 2, D16).

## Context

D16 calls for one Postgres database, used strictly as a rebuildable projection — never the
master record. Git remains the source of truth for identity, evidence, archetypes, applications,
and drifts (`Selfwright-data/`); Postgres exists only so semantic (vector) search over that data
is possible without re-embedding on every read. If the projection is ever wiped, it must be
fully reconstructable from git by re-running one script.

## Decision

**Image.** `pgvector/pgvector:pg16` — pgvector ships pre-installed, so no extension build step is
needed beyond `CREATE EXTENSION IF NOT EXISTS vector` in migrate(). Added to
`infra/docker-compose.yml` as the `postgres` service, port 5432, named volume `postgres_data`,
`POSTGRES_DB/USER/PASSWORD=selfwright` (password overridable via `POSTGRES_PASSWORD`), and a
`pg_isready` healthcheck.

**Schema** (`packages/adapters/storage-postgres/src/schema.ts`), 768 dimensions to match
`nomic-embed-text`'s output (ADR 0008):

```sql
CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL,
  signals TEXT[], embedding vector(768)
);
CREATE TABLE IF NOT EXISTS archetypes (
  id TEXT PRIMARY KEY, label TEXT NOT NULL, keywords TEXT[], embedding vector(768)
);
CREATE TABLE IF NOT EXISTS cv_bullets (
  id TEXT PRIMARY KEY, role_title TEXT NOT NULL, company TEXT NOT NULL,
  bullet TEXT NOT NULL, evidence_ids TEXT[], embedding vector(768)
);
```

`evidence` and `archetypes` are populated by `tools/sync-db.ts` today. `cv_bullets` is created
now (schema stability) but left unpopulated — no CV-bullet-level embedding pipeline exists yet;
populating it is future work once a bullet-level semantic-search use case lands, not part of T2.7.

**Adapter** (`@selfwright/adapter-storage-postgres`) exposes exactly four functions:
`migrate(sql)`, `upsertEvidence(sql, item, embedding)`, `upsertArchetype(sql, item, embedding)`,
`searchByEmbedding(sql, table, embedding, topK)`. `item` is a plain row type
(`EvidenceRow`/`ArchetypeRow`) local to this package, not the domain `EvidenceEntry`/`Archetype`
types from `@selfwright/core` — the adapter only knows the projection's shape; mapping from the
richer domain types happens in the caller (`tools/sync-db.ts`), keeping the adapter decoupled
from truth-layer schema changes. `searchByEmbedding` validates `table` against a fixed allowlist
before interpolating it as an identifier (via the `postgres` library's `sql(identifier)` escaping)
— defense in depth, since callers are internal code, not untrusted input. Embeddings are inserted
as pgvector literal strings (`[0.1,0.2,...]::vector`); search orders by cosine distance (`<=>`).

**New dependency.** `postgres` (the `postgres` npm package, aka porsager/postgres) — chosen over
`pg` for its TypeScript-first, template-literal query API (no manual parameter placeholders, no
`@types/pg` needed) and zero required configuration for a straightforward CRUD/query adapter like
this one. This is the one new dependency the Phase 2 plan pre-approved for T2.7.

**`tools/sync-db.ts`.** A standalone script (`pnpm sync-db`, i.e. `tsx tools/sync-db.ts`) —
deliberately not a turbo task, since it depends on live infra (Postgres + Ollama) rather than
being a pure build/test/typecheck step:

1. Requires `SELFWRIGHT_DATA_DIR` and `SELFWRIGHT_POSTGRES_URL`; exits with a clear error if
   either is unset.
2. Connects via `postgres(url)`, runs `migrate()` (idempotent).
3. Loads evidence + archetypes via `TruthLoader` (`@selfwright/adapter-storage-git`).
4. Embeds each record's text (`claim + detail + keywords` for evidence; `label + related_titles +
   match_keywords` for archetypes) via Ollama's `POST /api/embed` (the current endpoint — the
   older `/api/embeddings` is superseded), model `nomic-embed-text`.
5. UPSERTs via the adapter — re-running the script is a no-op state-wise beyond refreshed
   embeddings, so it's safe to schedule or re-run after any evidence/archetype edit in git.
6. After each upsert loop, calls `pruneEvidence`/`pruneArchetypes` (exported from the adapter) to
   DELETE rows whose `id` is no longer present in the current git truth, returning the deleted
   count. This ensures the projection never accumulates stale rows for records removed from git.

**`SELFWRIGHT_POSTGRES_URL`** convention: `postgresql://selfwright:selfwright@localhost:5432/selfwright`
by default (`.env.example` at repo root, alongside `POSTGRES_PASSWORD` and `SELFWRIGHT_MEMORY_URL`
for T2.8).

## What stays in git

Applications state, the scan queue, drift entries, evidence registry, archetypes, identity — all
of it stays exactly where it already lives, in `Selfwright-data/`. Nothing in this ADR moves any
of that data's source of truth into Postgres; Postgres only ever holds a queryable, disposable
copy plus its embeddings.

## Consequences

- Anyone can delete the `postgres_data` volume and fully rebuild the projection with
  `docker compose up postgres -d && pnpm sync-db`, as long as Ollama's `nomic-embed-text` model is
  pulled and `SELFWRIGHT_DATA_DIR`/`SELFWRIGHT_POSTGRES_URL` are set.
- Embeddings never touch a cloud LLM — `nomic-embed-text` runs locally via Ollama, so
  `sync-db` introduces no new API-key dependency (consistent with D-1/D13).
- T2.8's mem0 service (ADR 0010) reuses this same Postgres instance as its vector store backend.
