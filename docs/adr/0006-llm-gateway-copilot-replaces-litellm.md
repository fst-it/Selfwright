# 0006 — LLM gateway: co-piloted generation replaces LiteLLM as the default

*career_plan is treated as a proof-of-concept; its behavior is not authoritative for Selfwright.*

- Status: Accepted (2026-07-01)
- Supersedes: anchor **D11** (Gateway = LiteLLM proxy). Amends **D10** (model routing).

## Context

Anchor D11 chose LiteLLM as the model gateway — one OpenAI-compatible endpoint, cost tracking,
100+ providers. That decision assumed either an API-key-billed provider or a self-hosted proxy
in front of one. On 2026-06-30 the owner ruled this out: **no LiteLLM, no raw API keys for
Claude or ChatGPT**, for cost and complexity reasons versus already-paid subscriptions (Claude
Pro, ChatGPT Plus). This retires D11 outright — there is no gateway to route through by
default.

The available inference surfaces under this constraint: the `claude` CLI (subscription-backed,
automatable via subprocess, but a worse
single-shot generator than the interactive session), the Claude.ai/ChatGPT web apps (manual
only), and — the one already-authenticated, full-capability surface — **the Claude Code session
the owner is already running Selfwright commands inside**. That session already has the full
model, unlimited iteration, and tool-grounding (it can read the truth layer directly), at no
marginal API cost.

The 2026-06-30 acceptance run found `cover` **untested** for exactly this reason — no gateway
was running (§1.2 of the handoff doc). Any redesign has to close that gap without
reintroducing an API-key or proxy dependency.

## Decision

**Co-piloted generation is the default LLM path.** Selfwright deterministically assembles a
truth-grounded prompt and stops. Nothing calls an LLM. The Claude Code session the owner is
already in produces the text. A deterministic validator (`packages/core/src/services/
generation-guard.ts` — `validateCoverArtifact`, `validateResearchArtifact`) gates the produced
artifact before it's considered done.

Concretely, for both `cover` and `research`:
- **Default (no flag):** assemble the grounded prompt (`buildCoverSystemPrompt` +
  `buildCoverUserPrompt`, or `buildResearchPrompt`), write it to `<app-dir>/cover-prompt.md` (or
  `research-prompt.md`), print next-step instructions to stderr, exit 0. **No LLM call, no
  network access.**
- **`--check`:** read the human/co-pilot-produced artifact (`cover-letter.md` /
  `company-research.md`), load truth (registry/identity/drifts), run the validator, print a
  report, exit non-zero on any violation.
- **`--adapter cli|litellm` (optional headless escape hatch):** call the existing
  `coverService`/`researchService` (still behind `LlmPort`, unchanged) with the chosen adapter —
  `ClaudeCliAdapter` (Task 3, shells `claude --print`, seeded with `config/models.yml` via
  `loadModelsConfig`) or the retained `LiteLlmAdapter` — write the artifact, then run the same
  `--check` validation automatically. Nothing instantiates an adapter unless `--adapter` is
  explicitly passed.

This is the same shape in the MCP server (Task 6): the `cover`/`research` tools return the
assembled prompt as text content and never call an LLM; new `check_cover`/`check_research`
tools run the same validators.

**D-2 (kept from the handoff, restated here since it's the direct consequence):**
`LlmPort` is unchanged — it becomes a dormant, optional seam rather than the primary call path.
Deleting it would foreclose both the OSS/portability story (anchor D14) and future headless
automation, and `cover`/`research`'s pure prompt-builders already target it. `FF-PORT-1`
continues to guarantee services depend only on the interface, not a concrete adapter.

**D-3 (kept from the handoff, restated here):** `config/models.yml` is repurposed from a
LiteLLM proxy routing table into a logical-role → Claude-model **hint** map, loaded for real via
`loadModelsConfig` (Task 4) instead of the two hardcoded `DEFAULT_MODELS_CONFIG` copies that
used to live in the CLI and MCP apps.

**The invariant this ADR establishes:** generation is pluggable (co-pilot / `ClaudeCliAdapter` /
`LiteLlmAdapter` — and whatever comes next); **FF-GEN-1 validates the produced artifact
uniformly, regardless of which path produced it.** A future path (a direct API adapter, a
different subprocess) needs zero governance rework — it only has to produce text that
`validateCoverArtifact`/`validateResearchArtifact` can check.

## Consequences

- `apps/cli/src/index.ts` and `apps/mcp/src/index.ts` no longer instantiate any LLM adapter on
  their default paths. `DEFAULT_MODELS_CONFIG` (the two hardcoded copies) is deleted; both apps
  load `config/models.yml` via `@selfwright/shared-config`'s `loadModelsConfig`.
- `FF-LLM-1` (Task 6, `fitness/src/checks/llm-egress.ts`) enforces this structurally: `apps/`
  source must not reference `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`, nor wire `LiteLlmAdapter` on a
  default (non-`--adapter`) path.
- The LiteLLM Docker service (`infra/`) becomes optional / OSS-only — still in-tree, not part
  of the default Selfwright workflow. Not modified by this ADR (no `infra/` changes in Tasks
  1–6); a follow-up should mark it clearly optional in `infra/docker-compose.yml` docs.
- `cover`/`research` are no longer one-shot commands — they're now two-or-three-step flows
  (prompt → human/co-pilot fills it in → `--check`). This is a real UX shift, not a drop-in
  replacement; anchor §13 (interaction model) should reflect it (Task 7).
- Holistic quality (the LLM-tier DoD) now depends on artifacts actually being produced by *some*
  generator and passing FF-GEN-1 — Phase 2 scope, not this handoff.

## Alternatives considered

- **`claude -p` subprocess as the default** (not just the optional `--adapter cli` escape
  hatch). Rejected: worse single-shot quality for the same cost as the interactive co-pilot
  session — no iteration, no follow-up correction, a nested/child session instead of the one the
  owner is already driving, and de-chromed output that loses formatting nuance a human directly
  editing in the co-pilot session wouldn't lose.
- **API key** (Anthropic or OpenAI billed directly). Rejected outright — contradicts the
  2026-06-30 constraint (§1.1) that motivated this whole redesign.
- **Session-cookie-based unofficial SDK** against claude.ai/chatgpt.com. Rejected: violates
  those products' Terms of Service; not a foundation to build durable infrastructure on.
- **Ollama / local model for prose generation.** Rejected for the generative (cover/research)
  path: quality gap for an A-tier, repeat-audience output (target-company-class roles). Local models
  stay reserved for non-writing, eval-gated tasks (anchor D13, unchanged) — extraction,
  classification, embeddings.
