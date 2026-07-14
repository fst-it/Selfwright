# 0020 — Scoring vocabulary externalization to data layer

- Status: Accepted (2026-07-11, owner-approved)
- Relates to: ADR 0017 (CI gate hardening, named-entity derived gate)

## Context

`packages/core/src/scoring/priority.ts` and `packages/core/src/scoring/score.ts` contained
verbatim industry-tier bucket names, Tier-0 anchor company names, and commodity-trading
sector keywords used by `classifyIndustry`, `computePriority`, and `scorePosting`. These
names are the owner's real private targeting vocabulary — the companies the owner is
actively pursuing, in the industry buckets that matter to the owner's career strategy.

ADR 0017 introduced a derived named-entity gate (pre-commit + pre-push) that derives its
blocklist at hook time from `Selfwright-data` (truth/identity.yml, applications/*.yml,
contacts/*.yml, drifts/companies/*.yml, positioning/*). The pipeline company names embedded
verbatim in framework source collided structurally with this gate: they are dictionary-word-
invariant named entities. The gate's own invariant states that a unique name (a named company
that is not a common dictionary word) can never be allowlisted via `.confidential-allowlist.yml`
— the gate enforced this correctly and flagged the literals in `priority.ts`/`score.ts`.

There is no safe home for this vocabulary except the data layer.

## Decision

The owner's scoring vocabulary (industry-tier company names, Tier-0 anchors,
commodity-trading keywords) is moved verbatim from framework source to
`Selfwright-data/positioning/scoring-vocabulary.yml`. The data file format is defined by
`ScoringVocabularySchema` (zod, `packages/core/src/scoring/vocabulary.ts`).

The framework ships a `DEFAULT_SCORING_VOCABULARY` (synthetic, dictionary-safe placeholder
names — never the owner's data) so that `classifyIndustry`/`computePriority`/`scorePosting`
never crash or throw when no data-layer vocabulary is present. Scoring degrades gracefully
to the synthetic default; FF-VOCAB-1 (Tier-2) detects this condition when
`SELFWRIGHT_DATA_DIR` is configured.

The vocabulary file is loaded at the **adapter layer** (`loadScoringVocabularyFile` in
`packages/adapters/storage-git/src/scoring-vocabulary-loader.ts`), never in `packages/core`
— core must not depend on any adapter, any data-layer path, or any I/O mechanism (FF-PORT-1).
Callers (CLI, MCP, web) pass the loaded `ScoringVocabulary` to the scoring functions via
parameter injection; core functions accept it as an optional argument, defaulting to
`DEFAULT_SCORING_VOCABULARY`.

## Verification

Behavior proven byte-identical on real data before and after the change: the same
`scorePosting` calls with the same inputs produced the same outputs once the real vocabulary
was loaded from the file. The diff to `priority.ts` and `score.ts` removed only the literal
strings; the scoring logic itself was not touched.

## Consequences

- Open-core boundary (anchor §8): the data layer is now the only home for targeting
  vocabulary, which is never committed to the framework repo — the data-leak gate enforces
  this at every commit.
- FF-PORT-1 (core has zero non-zod imports): unaffected; the loader lives in
  `adapter-storage-git`, not in `core`.
- FF-VOCAB-1 (Tier-2): asserts that when `SELFWRIGHT_DATA_DIR` is set, the loaded
  vocabulary differs from `DEFAULT_SCORING_VOCABULARY` — catches a missing or accidentally
  reverted file before it silently degrades scoring quality.
- Scoring output: unchanged when the real vocabulary file is present. Degrades gracefully
  (never crashes) when the file is absent.

## Alternatives considered

### Allowlist the literals in `.confidential-allowlist.yml`
Not viable. The named-entity gate's own invariant disallows allowlisting unique company
names (non-dictionary-word tokens). The gate enforces this programmatically; bypassing it
would hollow out the data-leak gate for the most sensitive category of names.

### Rename literals to synthetic placeholders and keep them in framework code
Loses real scoring quality: the scoring functions would classify industries incorrectly for
the real targeting vocabulary, defeating the purpose of the priority/score layer. The
owner's private vocabulary is data, not framework logic; keeping it in the framework in any
form confuses that boundary.
