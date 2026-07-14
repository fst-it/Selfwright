# Selfwright — agent instructions

Read `CONSTITUTION.md` (the governing principles) and `docs/adr/` (the architectural decision
record) first. This file is the cross-tool brief; `CLAUDE.md` and `.cursor/rules` add
tool-specific config.

## What this is
An open-core, local-first personal career/expertise platform. TypeScript-first hexagonal modular
monolith. The domain core is pure TS (no frameworks); adapters implement ports.

## Hard rules
- **NEVER commit anything under `data/`** (gitignored, private). Never print or commit secrets/PII.
- **Truth floor:** never fabricate a fact/number/title/system. Outward claims trace to the truth
  layer (the Selfwright-data repo / local `data/`). Honesty walls are absolute. Human submits
  applications — no auto-submit.
- No data leaves the machine except the configured model gateway (LiteLLM). No other third party.
- The data-leak gate and the fitness functions (`docs/fitness-functions.md`, from Phase 0) are law.

## How we work
- One task per branch → PR → merge → delete. Never push to `main` (after the founding setup).
  Conventional commits; keep the co-author line.
- TDD for deterministic code; evals for LLM code. No merge below the coverage gate.
- Strict TypeScript (no `any`). No TODO/stub/placeholder/skipped tests in merged code.
- Run `pnpm typecheck && pnpm test && pnpm fitness` before every commit (once Phase 0 lands them).
- Record significant architectural decisions as ADRs in `docs/adr/`.
- Version bumps + CHANGELOG entries per `docs/VERSIONING.md` (ADR 0018).

## Commands (after Phase 0)
- `pnpm install` / `build` / `test` / `lint` / `typecheck` / `fitness`
- `docker compose -f infra/docker-compose.yml up -d` (LiteLLM; later Postgres/Ollama/Metabase)
- `selfwright <cmd>` (CLI)

## Models
Build on **Sonnet 4.6 Max**. Use **Sonnet 5** (`claude-sonnet-5`) for T2.6/T2.7/T2.8 design
decisions (Ollama quality eval, Postgres+pgvector schema, mem0 memory architecture). Escalate to
**Opus** only for: domain/bounded-context design, the data-leak/privacy boundary, eval-harness
design, and truth-layer migration logic. Use **Haiku/local** for mechanical steps.
