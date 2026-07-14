# 0008 — Ollama as optional, eval-gated local inference

- Status: Accepted (2026-07-07)
- Supersedes: none. Implements T2.6 (anchor §10 Phase 2, D13).

## Context

D13 allows a local-inference tier alongside the subscription-only Claude path, but only where
quality equivalence is provable and never at the cost of silently degrading output. Two use cases
are on the table: embeddings for the pgvector projection (T2.7) and local generation for
mechanical, well-defined tasks (skill extraction, sentence classification) that don't need Opus-
or Sonnet-level judgment.

Embeddings and generation carry different risk profiles. An embedding either recalls the right
neighbor or it doesn't — the failure mode is visible and cheap to catch downstream. A generation
task that quietly produces slightly-worse output has no such tripwire; it degrades every
downstream artifact built on it. D13 therefore draws the line at embeddings vs. generation, not
at "local vs. cloud" — embeddings run local unconditionally, generation runs local only after
passing a quality-equivalence eval against the existing Claude baseline.

## Decision

**Models.** `nomic-embed-text` for embeddings (768-dimensional, MIT-licensed, unconditional — no
eval gate). `llama3.2:3b` for generation (gated).

**Infra.** `ollama/ollama:latest` added to `infra/docker-compose.yml`, port 11434, a named
`ollama_data` volume, and an HTTP healthcheck against `/`. GPU passthrough (NVIDIA Container
Toolkit, `deploy.resources.reservations.devices`) is included as a commented-out block — a
machine with a CUDA-capable GPU can enable it, but Ollama runs on CPU by default so the
compose file works without a GPU.

**Adapter.** `packages/adapters/llm-ollama` (`@selfwright/adapter-llm-ollama`) implements
`LlmPort` against Ollama's OpenAI-compatible `{baseUrl}/v1/chat/completions` endpoint using the
built-in `fetch` — no new npm dependency. Model and base URL are constructor arguments (default
`http://localhost:11434`); `costUsd` is always `0` since local inference has no per-token
billing. Unlike `LiteLlmAdapter`/`ClaudeCliAdapter`, it does not resolve a model from
`config/models.yml`'s role map — the eval gate operates per fixed model, not per role, so the
model is passed explicitly by the caller (`apps/cli`'s `--adapter ollama`, or the eval harness).

**Eval design (`evals/`).** Two checks, asymmetric by design:

- **Extraction** (`evals/src/checks/extraction.ts`): for each of 5 synthetic JD fixtures
  (`evals/src/golden/jd-extraction.ts`), the same "extract top-5 required skills as JSON array"
  prompt runs against both the Claude baseline and the Ollama candidate. Pass gate: average
  Jaccard similarity between the two outputs across all 5 fixtures ≥ 0.6. "Correct" skill
  extraction is inherently fuzzy (synonyms, granularity, ordering), so it's graded relative to
  Claude's own answer rather than a single fixed string list — Claude's output is the trust
  anchor. The fixture's own curated `expectedSkills` field isn't part of the pass/fail gate; it's
  logged per-fixture (`claudeVsExpected`) as a sanity signal that Claude's baseline itself is
  behaving as designed.
- **Classification** (`evals/src/checks/classification.ts`): for each of 20 synthetic sentences
  (`evals/src/golden/classification.ts`), Ollama classifies into one of
  `requirement | perk | company_info | other`. Pass gate: exact-match accuracy ≥ 0.85 against the
  fixture's fixed `expectedLabel`. Classification has an unambiguous correct answer, so no Claude
  baseline call is needed here — it's graded directly against the golden label.

All fixtures are synthetic (no real JD text, no personal data — data-leak gate applies to test
fixtures the same as everywhere else).

**`config/models.yml`.** An Ollama section is added commented-out, to be uncommented only after
`pnpm eval` confirms both checks pass:

```yaml
# ollama:
#   embed: nomic-embed-text   # 768d, MIT — unconditional for pgvector (T2.7)
#   extract: llama3.2:3b      # gated: eval extraction check >= 0.6 Jaccard
#   classify: llama3.2:3b     # gated: eval classification check >= 0.85 accuracy
```

**CLI.** `apps/cli`'s `loadAdapter()` gains `--adapter ollama` → `new OllamaAdapter("llama3.2:3b")`,
alongside the existing `cli` and `litellm` options — opt-in only, per D-1 (no default adapter is
ever instantiated by an app entrypoint).

## What is NOT gated

Embeddings (`nomic-embed-text`) are always safe to run locally per D13 — there is no quality
threshold to clear, since nearest-neighbor recall either works or visibly doesn't. Any generation
task (extraction, classification, and — later, if ever proposed — cover letters or research
prose) requires clearing its own eval gate first; cover-letter/research generation specifically
stays on Claude always (too quality-sensitive and too variable for a threshold test) and is not
part of this eval's scope.

## Consequences

- Running `docker compose up ollama -d` and `pnpm eval` is required before anyone enables the
  commented-out `ollama:` block in `config/models.yml` or routes real traffic through
  `--adapter ollama`.
- The eval's Claude baseline calls go through `ClaudeCliAdapter` (subscription CLI, no API key),
  so running the eval doesn't introduce a new cloud-key dependency.
- `nomic-embed-text`'s embeddings are consumed unconditionally by T2.7's `tools/sync-db.ts` — that
  path does not wait on this eval.
