# 0010 — mem0 memory, self-hosted, exposed via MCP

- Status: Accepted (2026-07-07)
- Supersedes: none. Implements T2.8 (anchor §10 Phase 2, D19).

## Context

D19 splits Selfwright's memory into two tiers: `AGENTS.md` for durable, human-authored
instructions (how to work in this repo — model policy, constraints, architecture), and mem0 for
dynamic, episodic memory (things learned during sessions — preferences confirmed, project facts,
corrections) that should carry forward without a human re-writing a doc every time. This ADR
covers the mem0 half: how it's hosted, and how it's reached from any MCP-capable harness.

## Decision — which mem0 deployment path was taken, and why

Two paths were evaluated before writing any code (per the truth-floor requirement — a Haiku
research pass read mem0's actual docs and source rather than assuming):

- **Official self-hosted image** (`mem0/mem0-api-server`, or building `server/Dockerfile` from
  source): confirmed to **require `OPENAI_API_KEY`** for its default LLM/embedder config, with no
  documented way to substitute a local provider without modifying `server/requirements.txt` and
  `server/main.py` and rebuilding the image — an ongoing maintenance burden to track upstream, and
  a hard violation of D-1 (no default cloud-key dependency) unless rebuilt every time.
- **Custom FastAPI wrapper around the `mem0ai` Python library** (`infra/mem0-service/`): the
  library itself (confirmed via `mem0/memory/main.py`) supports `provider: "ollama"` for both
  `llm` and `embedder`, and `provider: "pgvector"` for the vector store — all locally satisfiable
  with services we already run (T2.6's Ollama, T2.7's Postgres).

**Path taken: the custom FastAPI wrapper.** It's the only path that's local-only without a
rebuild-and-maintain commitment, and it lets the service's HTTP contract be exactly what
`MemoryPort` needs — no translation layer for endpoints Selfwright doesn't use.

## Architecture

```
Mem0Adapter (TS, packages/adapters/memory-mem0)
  --HTTP--> infra/mem0-service (FastAPI, Python)
              --Memory.from_config()--> mem0ai library
                llm:       ollama / llama3.2:3b       (T2.6's Ollama service)
                embedder:  ollama / nomic-embed-text  (768d, matches T2.7's schema)
                vector_store: pgvector                (T2.7's Postgres, collection "mem0_memories")
```

`infra/mem0-service/` (`Dockerfile` + `requirements.txt` + `main.py`) is added to
`infra/docker-compose.yml` as the `mem0` service, `depends_on: [postgres, ollama]` (both
`service_healthy`), port 8050 (matching `SELFWRIGHT_MEMORY_URL=http://localhost:8050` in
`.env.example` from T2.7). It exposes three endpoints Selfwright actually uses:

- `POST /memories` — `{content, metadata?}` → one `MemoryEntry`. Calls `memory.add(content,
  user_id="selfwright", metadata=metadata, infer=False)`. `infer=False` is deliberate: with
  inference on, mem0 runs its own LLM step to decide what facts to extract and may return zero,
  one, or several results per call — incompatible with `MemoryPort.add()`'s one-entry-per-call
  contract. `infer=False` stores the content verbatim, always returning exactly one result.
- `POST /search` — `{query, top_k?}` → `{results: [{entry, score}]}`. Calls
  `memory.search(query, user_id="selfwright", top_k=...)`.
- `POST /memories/list` — `{filter?}` → `{results: [MemoryEntry]}`. Calls `memory.get_all(filters=
  {"user_id": "selfwright"}, top_k=1000)`, then filters client-side on the metadata dict — mem0's
  own `filters` param only validates against `user_id`/`agent_id`/`run_id`, not arbitrary
  metadata, so metadata matching happens in the service itself.

Selfwright has no multi-tenant concept, so every memory is scoped to one fixed `user_id`
(`"selfwright"`) — `MemoryPort` doesn't expose a user dimension, and there's only one user.

**`packages/core/src/ports/memory.ts`** — `MemoryEntry`, `MemorySearchResult`, `MemoryPort`
(`add`/`search`/`list`), exported from `@selfwright/core`.

**`packages/adapters/memory-mem0`** (`Mem0Adapter`) implements `MemoryPort` against the FastAPI
service above using built-in `fetch` — no new npm dependency. `baseUrl` is a constructor arg.

## MCP tools

`apps/mcp/src/index.ts` gains two tools:

- **`memory_add`** — `{content, metadata?}` → the stored `MemoryEntry` as JSON text.
- **`memory_search`** — `{query, top_k?}` → `MemorySearchResult[]` as JSON text.

Both guard on `SELFWRIGHT_MEMORY_URL`: `getMemoryAdapter()` returns `null` when the env var is
unset, and both tool handlers return a descriptive error string (`isError: true`) rather than
throwing — the existing 7 tools (score/ats/tailor/cover/check_cover/research/check_research/
inbox/scan) must keep working with or without mem0 running, matching D-1 (no adapter is ever
instantiated by default; here, "default" means "without the env var explicitly set").

**Known limit on `memory_list`:** `list_memories()` calls `memory.get_all(..., top_k=10000)`.
mem0's `get_all()` has no cursor/offset parameter, so results are capped at 10 000; if that cap
is hit, the service prints a warning to stderr. This is a known, explicitly documented limit rather
than a silent one — it is tracked here ahead of `memory_list` ever being wired to an MCP tool.

**Deliberately deferred:** `memory_list` is not exposed as an MCP tool yet, even though
`Mem0Adapter.list()` (and the underlying `/memories/list` endpoint) is fully implemented —
`MemoryPort`'s interface commits to all three methods, so the adapter can't be a partial
implementation, but the MCP surface stays at two tools until a real use case for listing (rather
than searching) memories from an agent session shows up. Also deferred to Phase 3: tiered recall
and selective top-k cost control (D19's "tiered + selective recall" isn't built yet — this ADR
only covers plain add/search).

## Relationship to AGENTS.md

`AGENTS.md` stays the durable, version-controlled instruction set — model policy, constraints,
what never to bypass. mem0 is for things that would otherwise only live in a chat transcript:
confirmed preferences, project facts learned mid-session, corrections — the same category of
thing this session's own memory system already tracks manually. Nothing here changes how
`AGENTS.md` is written or read; mem0 is additive, reached only through the two MCP tools above.

## Optional bearer-token auth

The mem0 FastAPI service (`infra/mem0-service/main.py`) supports an optional bearer-token auth
mechanism, off by default (open access, matching the rest of the local stack's "trust the local
network" posture) but available for anyone who wants to harden it. mem0 is the first persistent,
write-capable service in the local stack (litellm and ollama are stateless proxies), which is why
auth was added here first.

- Set `MEM0_SERVICE_TOKEN` in the environment (or `.env`) to enable auth on the service. Every
  endpoint except `GET /health` (used by the Docker healthcheck) requires `Authorization: Bearer
  <token>`. If the variable is unset or empty, auth is not enforced and a warning is printed to
  stderr at startup.
- Set `SELFWRIGHT_MEMORY_TOKEN` to the same value so `Mem0Adapter` (and therefore the MCP tools
  `memory_add`/`memory_search`) includes the header in every request to the service.
- Both variables are documented in `.env.example`.

## Consequences

- `docker compose up postgres ollama mem0 -d` (in that dependency order, though `depends_on`
  handles it) plus pulling `nomic-embed-text` and `llama3.2:3b` is required before mem0 is usable.
- Because `infer=False` is used for every add, mem0's own LLM-based memory consolidation/dedup
  logic never runs — Selfwright treats each `memory_add` call as one discrete, already-formed
  fact, not a raw conversation turn to be distilled. If future work wants mem0's LLM-side
  consolidation, that's a deliberate follow-up, not something this ADR enables silently.
- Losing the `mem0`/`postgres` containers loses stored memories (mem0's Postgres collection isn't
  covered by T2.7's `sync-db` — it's mem0's own store, not the evidence/archetype projection).
  This is an accepted risk for now: memory is a convenience layer, not the truth store.
