# Selfwright — Developer Setup

This covers the framework. The operating manual for day-to-day use is `docs/MANUAL.md`.
Architecture decisions live in `docs/adr/`; the architectural rationale is in `DESIGN.md`.

## Prerequisites

| Tool | Version | Required | Notes |
|------|---------|----------|-------|
| Node.js | 22+ | yes | pinned in `.nvmrc` |
| pnpm | 9+ | yes | workspace manager (`npm install -g pnpm`) |
| Docker or Podman | any recent | optional | Postgres projection, Metabase, Ollama, mem0 |
| Tailscale | any | optional | remote access to the web dashboard |
| ntfy | self-hosted | optional | push notifications |

## Installation

```bash
git clone https://github.com/fst-it/Selfwright.git
cd Selfwright

# Automated setup (recommended) — installs deps, writes .env, installs git hooks:
node scripts/setup.mjs --init-template --data-dir /path/to/your-data-repo

# Or manual:
pnpm install
cp .env.example .env   # edit with your SELFWRIGHT_DATA_DIR
node tools/src/hooks/setup-hooks.ts   # install lefthook + .git/hooks twins
```

After setup, run `pnpm selfwright inbox` (from the repository root) to verify the CLI works end
to end. There is no global `selfwright` link — every CLI command is invoked as
`pnpm selfwright <cmd>`, which runs the root `selfwright` script
(`node apps/cli/dist/index.js`). You can also call `node apps/cli/dist/index.js <cmd>` directly.

## Environment

`SELFWRIGHT_DATA_DIR` points to your private `Selfwright-data` repository (your truth layer,
applications, contacts, drifts). This variable is required for the Tier-2 fitness checks and
for any command that reads your profile. It is not required to build or run the framework
itself.

Optional services read their connection strings from `.env`. See `.env.example`.

## Commands

```bash
pnpm build          # compile all packages and apps (turbo)
pnpm test           # run all tests (vitest via turbo)
pnpm lint           # ESLint across the whole repo
pnpm typecheck      # tsc --noEmit across all packages
pnpm fitness        # run all 33 fitness checks (28 Tier-1 always; 5 Tier-2 need SELFWRIGHT_DATA_DIR)
pnpm format         # Prettier (format only; not a CI gate)
pnpm eval           # LLM quality-equivalence eval harness
pnpm sync-db        # ETL: push truth layer snapshot to Postgres projection
```

The required gate order before a PR: `lint → typecheck → test → fitness`.
Running `pnpm test` also compiles workspace dependencies as a side effect (turbo `^build`),
so `fitness` can assume built artifacts are available.

### Optional services

```bash
# Start Postgres + pgvector + Metabase + Ollama + mem0:
docker compose -f infra/docker-compose.yml up -d

# Run the web dashboard (cockpit):
pnpm --filter @selfwright/web start
# React cockpit (Vite dev server):
pnpm --filter @selfwright/web-ui dev
```

The cockpit is `apps/web` (Hono server, `/api/*` JSON contract, auth, static host) with a
React front-end in `apps/web-ui`. For remote access bind to `127.0.0.1` and route through
Tailscale — the web-safety gate (`FF-WEB-1`) enforces loopback binding.

## Monorepo layout

```
selfwright/
├── apps/
│   ├── api/       — internal Hono API server
│   ├── cli/       — pnpm selfwright <cmd> CLI
│   ├── mcp/       — MCP server (exposes capabilities to Claude Code / Cursor)
│   ├── web/       — dashboard server (auth, /api/* JSON, static host for web-ui)
│   └── web-ui/    — React cockpit (Vite; served by apps/web in production)
├── packages/
│   ├── core/              — pure domain layer (only zod; no adapters, no I/O)
│   ├── api-contract/      — shared Zod schemas for the /api/* contract
│   ├── shared-config/     — config loaders (models.yml, env)
│   ├── shared-logger/     — structured logger
│   ├── shared-notify/     — ntfy notification helpers
│   └── adapters/
│       ├── llm-claude-cli/    — ClaudeCliAdapter (headless, opt-in via --adapter)
│       ├── llm-litellm/       — LiteLlmAdapter (optional)
│       ├── llm-ollama/        — OllamaAdapter (optional, eval-gated — ADR 0008)
│       ├── memory-mem0/       — mem0 memory backend (ADR 0010)
│       ├── render-typst/      — Typst CV renderer
│       ├── scan-browser/      — browser-based job scanner (Playwright, bot-gated boards)
│       ├── scan-http/         — HTTP scanner (18 providers: Greenhouse, Lever, Ashby,
│       │                        Workday, SmartRecruiters, BambooHR, Oracle Fusion,
│       │                        Recruitee, Personio, Workable, Breezy, Adzuna, Arbeitnow,
│       │                        Remotive, Himalayas, WeWorkRemotely, RemoteOK, generic)
│       └── storage-{git,postgres}/  — git truth layer + Postgres projection (ADR 0009)
├── tools/         — sync-db ETL, doctor, git hooks, named-entity scan
├── fitness/       — 33 fitness checks: 28 Tier-1 (CI) + 5 Tier-2 (local, need real data)
├── evals/         — quality-equivalence eval harness (LLM paths)
├── infra/         — Docker Compose profiles
├── config/        — models.yml (logical role → provider+model hint)
├── examples/      — data-template/ with synthetic fixtures (Jordan Doe / FictionalCo)
└── docs/          — MANUAL.md, ADRs, design docs, fitness-functions.md
```

## Architecture

Selfwright uses a hexagonal (ports & adapters) modular architecture organized around
Domain-Driven Design bounded contexts. `packages/core` is the pure domain layer: it contains
all scoring, tailoring, scanning, truth-trace, and generation-guard logic. It depends on
nothing external except `zod`. Adapters in `packages/adapters/` implement the ports (interfaces)
defined in `packages/core/src/ports/`. Apps in `apps/` wire adapters to the core via
dependency injection. The core never imports an adapter.

`FF-PORT-1` enforces the boundary mechanically on every PR. `FF-CONTEXT-1` enforces
bounded-context discipline: cross-context imports inside `packages/core/src/` must go through
the target context's `index.ts`, never a deep internal file.

The full architecture rationale is in `DESIGN.md`. The bounded-context map is in
`docs/domain/context-map.md`. Individual decisions are in `docs/adr/`.

## Hooks and gates

The following hooks run automatically after `node scripts/setup.mjs`:

| Hook | Trigger | What it checks |
|------|---------|----------------|
| `commit-msg` | every commit | conventional commit format |
| `pre-commit` | every commit | named-entity scan, machine-identity scan, gitleaks |
| `pre-push` | every push | same named-entity + machine-identity scan |

The named-entity and machine-identity hooks require `SELFWRIGHT_DATA_DIR` and run locally
only (never in CI). They fail closed when the data dir is absent.

CI runs `lint`, `typecheck`, `test`, and `fitness` on every PR. The fitness suite includes
`FF-DATA-LEAK-1` (gitleaks) and `FF-LAZY-1` (no TODO/FIXME/skipped tests).

## Adding a fitness check

1. Create `fitness/src/checks/<name>.ts` exporting a `check<Name>` function.
2. Register it in `fitness/src/runner.ts`.
3. Add a row in `docs/fitness-functions.md`.
4. Add an ADR if the check enforces a new architectural decision.

See `docs/fitness-functions.md` for the full catalog and the conventions.
