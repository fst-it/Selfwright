# 0013 — Coaching bounded context: gap coverage, drill selection, co-piloted prep-packs

- Status: Accepted (2026-07-09)
- Supersedes: none. Implements T3.2 (anchor §10 Phase 3).

## Context

T3.2 asks for interview drills, networking/event prep, learning loops, and skill-gap tracking,
with the truth floor applying strictly: "drills and prep packs must only claim things traceable to
the evidence registry — this is exactly the kind of surface where fabrication would be
highest-stakes (the owner rehearsing a false claim before a real interview)."

Two things already in the repo turned out to matter more than a fresh design would have assumed.
First, `packages/core/src/truth/schemas/gaps.ts` already defines a `GapSchema`/`GapsFileSchema`
(`id: GAP-*`, `title`, `honest_gap`, `frame`, `tag`, `evidence_ids[]`, `company_specific`),
explicitly dormant ("no gaps.yml exists yet — populate when a fitness function concretely needs
structured gap rows"). Its shape — a known weak spot plus its honest framing — is exactly what
"skill-gap tracking" and drill rehearsal need; there was no reason to invent a second concept.
Second, `packages/core/src/ports/storage.ts`'s generic `StoragePort` (read/write/list/exists) has
zero adapters implementing it and zero callers — the real, confirmed convention (every write in
`apps/cli/src/index.ts`: `cover-prompt.md`, `cover-letter.md`, `research-prompt.md`,
`scan-history.yml`, `queue.yml`) is a raw `node:fs/promises.writeFile` + the `yaml` package's
`stringify`, called directly from the CLI action handler. Designing a new `CoachingStorePort`
would have been the second unused port in the codebase.

Given the stakes, the actual selection/ranking/critique algorithms were designed via an Opus judge
panel: two independent angles (rubric-driven/maximally-deterministic vs.
evidence-ranking-first/retrieval-style), scored against truth-floor enforceability, consistency
with the existing `cover.ts`/`research.ts`/`generation-guard.ts` pattern, simplicity, extensibility
to networking/event prep, and TDD testability, then synthesized into one decisive design. The
synthesis corrected a factual error in one candidate (evidence tags are `hard | soft | claim` —
there is no `lead` tag *level*; `lead` is a facet *key* inside a per-facet tag map, collapsed to a
level by the existing `tagLevels()` helper).

## Decision

### Shared substrate: one relevance primitive, not two

`packages/core/src/truth/trace.ts`'s `tokenize`, `entryTokens`, and `MIN_KEYWORD_OVERLAP` become
exported (visibility only, no behavior change). A new `packages/core/src/coaching/retrieval.ts`
builds `expandTerm(term, ontology?)` (one-hop, bidirectional keyword-ontology expansion —
deliberately *not* transitive, so `settlement → back office → middle office → …` can't bleed into
one topic) and `relevance(queryTerms, entry, ontology?)` (`overlap` via the same tokenizer
`traceClaims` uses, `keywordHits` against the entry's curated `keywords[]`, `tagWeight` via
`tagLevels()` mapped to `{hard:1.0, soft:0.5, claim:0.25}`). Every coaching function that ranks or
gates evidence — coverage detection, evidence selection for a drill/prep-pack, and the drill
generation-guard checks — is built on this one primitive. The alternative (a second,
independently-tuned "relevance" notion for coaching, separate from what `traceClaims` uses to gate
artifacts) was rejected: a coach could then rank or rehearse evidence the truth floor would later
reject as untraceable, which is precisely the failure mode this ADR exists to prevent.

### `packages/core/src/coaching/` (pure, FF-PORT-1, TDD)

- `coverage.ts` — `computeCoverageGaps(archetype, registry, ontology?, gaps?)` (delegates to
  `computeCoverageGapsForKeywords(topics, registry, ontology?, gaps?)`, so a raw JD keyword list
  reuses the identical core). Per topic: `covered` if any entry has a curated-keyword hit;
  `partial` if no keyword hit but token overlap ≥ `MIN_KEYWORD_OVERLAP` (2); else `uncovered`.
  Read-only — surfaces `CandidateGap[]` (topic, coverage tier, up to 3 supporting `EVD-*` ids,
  an `existingGapId` if a `gaps.yml` row's title already token-overlaps the topic, else a
  `suggestedGapId` string). **Writes nothing.**
- `retrieval.ts` — `selectEvidenceForTopic(input, registry, ontology?, cap=5)`: ranks by
  `relevance().score` descending (id ascending to break ties — fully deterministic, no RNG),
  filters zero-overlap entries, caps at 5. Returns each pick's `why` (matched tokens) so the
  co-pilot prompt can show its work.
- `drill-select.ts` — `selectNextDrillTopic(history, gaps, archetype, registry, ontology?)`. Pool =
  every `gaps.yml` row (`kind: "gap"`, base weight 3) + every `partial`-coverage topic (`"stretch"`,
  base 2) + every `covered` topic (`"strength"`, base 1). Priority = `base × (1 − 0.5^ago)` where
  `ago` counts distinct topics drilled since this one last appeared (immediate-previous topic is
  hard-excluded, never repeated back-to-back); multiplicative freshness self-normalizes to a full
  round-trip in ~3 drills without a hardcoded cycle length. Returns the winning topic plus its
  evidence bundle via `selectEvidenceForTopic`.
- `types.ts` / `index.ts` — `CandidateGap`, `RankedEvidence`, `DrillHistoryEntry`, `DrillKind`,
  `DrillSelection`, `PrepPackKind`; barrel re-export.

### `TruthPort.loadGaps()` — the one new read path

`packages/core/src/ports/truth.ts` gains `loadGaps(): Promise<Result<Gap[], TruthError>>`;
`TruthLoader` implements it exactly like `loadDrifts`/`loadArchetypes` — parses+validates
`truth/gaps.yml` against the already-exported `GapsFileSchema`, returns `ok([])` on
`FILE_NOT_FOUND` (dormant-tolerant, same as every other truth file that may not exist yet).
`assertGapsFileExists()` is untouched — it guards the unrelated narrative `truth/gaps-and-risks.md`.

### `packages/core/src/services/` — co-piloted generation, same shape as `cover.ts`/`research.ts`

- `gap-scan.ts` — `buildGapScanReport(candidates): string`. No LLM involved at all; this is a
  plain deterministic report, the clearest case in this task for "no co-pilot needed."
- `drill.ts` — `buildDrillSystemPrompt()` / `buildDrillUserPrompt(ctx)`, optional
  `drill(ctx, llm)` headless escape hatch (kept for interface parity with `cover`/`research`, even
  though drilling is meant to happen live in a co-piloted chat).
- `prep-pack.ts` — `buildPrepPackSystemPrompt(kind)` / `buildPrepPackUserPrompt(ctx)`, optional
  `prepPack(ctx, llm)`. One service parameterized by `kind: "interview" | "networking" | "event"`
  (see below), not three parallel services.

All writes (`Selfwright-data/truth/gaps.yml` edits, `coaching/drill-history.yml`,
`coaching/drills/<ts>-<ref>.md` or `<app-dir>/…`, `<app-dir>/prep-pack.md`) go through the CLI's
existing raw `writeFile` + `yaml` convention — no new port.

### `generation-guard.ts` — three new validators, one shared id-integrity helper

`assertIdsExist(text, registry, gaps)` extracts every `EVD-*`/`GAP-*` token and flags any not
present in the loaded registry/gaps.

- `validatePrepPackArtifact(text, ctx)` — honesty boundary (full text) + truth-trace (scoped to
  candidate-referencing sentences, exactly like `validateResearchArtifact`, since a prep-pack is
  mostly *about* the company/role) + structural checks (must cite ≥1 `EVD-*`; for
  `kind: "interview"`, a "Gaps to rehearse" section is required and must cite both a `GAP-*` and an
  `EVD-*`; for networking/event the section is optional but held to the same grounding rule if
  present) + `assertIdsExist`. No word-count rule — packs vary in length by design.
- `validateDrillArtifact(text, ctx)` — its own validator, not a reuse of the prep-pack one. A saved
  drill transcript legitimately contains the owner's raw over-claim (that's what the coach's
  critique is *for*), so honesty/trace checks are scoped to the coach-authored slice only (from the
  `## Coach critique` heading onward) — never the `## My answer` block, which is input under
  assessment, not an outward claim. Requires `## Question` / `## My answer` / `## Coach critique`
  headings and a `Grounding:` line, all id-checked.
- `validateGapArtifact(gaps, ctx)` — gates a `gaps.yml` row at its source: every `evidence_ids`
  entry must exist in the registry, `honest_gap`/`frame` must clear the honesty boundary, and
  `frame` must itself trace to the evidence it cites. This runs regardless of whether a row was
  hand-written or (in a future session) co-pilot-drafted — the check belongs to the data, not to
  how it was authored.

### Gap lifecycle: detection is informational only; no drafting flow in T3.2

`computeCoverageGaps` never writes. Promoting a detected candidate into `gaps.yml` is a manual
step — the owner (optionally with the co-pilot in the same session) writes the YAML row directly,
then `gap-scan --check` runs `validateGapArtifact` before it can feed drilling. No
`buildGapDraftPrompt` was built this task. Auto-synthesizing `honest_gap`/`frame` — the most
persuasive, judgment-laden text in this feature — without a human authoring it directly is exactly
the kind of generation the truth floor exists to gate, and T3.2's DoD ("coach produces an
interview-prep and learning plan") only requires *rehearsing* gaps, not the platform authoring new
ones. The seam is left clean: a future `buildGapDraftPrompt` would follow `cover.ts` exactly and
reuse `validateGapArtifact` unchanged, if this is ever wanted.

### Networking/event prep: one service, prose-only divergence

`prep-pack.ts` is parameterized by `kind`. The deterministic core (coverage, ranking, validation)
is identical across all three kinds; only `buildPrepPackSystemPrompt`'s framing paragraph and
`validatePrepPackArtifact`'s "Gaps to rehearse" requirement (interview-only, optional-but-graded
elsewhere) change. Three parallel services would triplicate identical retrieval/validation logic
for a one-paragraph difference.

### Notifications: `packages/shared-notify`, called from the CLI layer only

A new package mirroring `packages/shared-logger`'s scaffolding, wrapping the already-proven
fire-and-forget pattern in `tools/src/hooks/ntfy.ts` (env `NTFY_URL`, `Title`/`Priority` headers,
3s timeout, swallow all errors). It is **not** a port inside `packages/core` — core has no reason
to own a notification side effect, and the existing SessionStart hook already establishes the
convention of calling `notifyNtfy` *after* a report is computed, not from within the code that
computes it. `notifyCoaching(ids, title)` sends only `GAP-*`/`EVD-*` ids — never titles, claims, or
answer text, matching the existing "IDs-only" push discipline. Called from `apps/cli` after a
coaching command completes. No live OS-level scheduler is introduced — the owner runs commands
manually or wires their own OS scheduler; this matches the platform's "no required daemon"
principle and there is no scheduling mechanism anywhere else in the repo to extend.

## What is NOT changed

`GapSchema`/`GapsFileSchema` are used as-is — no new field was added (in particular, no `keywords[]`
field for coverage linkage; a gap's `title` is expected to contain its keyword phrase, and
coverage-linkage uses token overlap/substring against that title). `StoragePort` stays dormant.
`assertGapsFileExists()` (the narrative `gaps-and-risks.md` guard) is untouched.

## Consequences

- `gaps.yml` goes from a locked-but-unused contract to an active one; the owner now has a reason to
  populate it (drilling prioritizes it above evidence-only topics).
- `selectNextDrillTopic`/`computeCoverageGaps`/`selectEvidenceForTopic` share one relevance
  primitive with `traceClaims`, so nothing coaching ranks or rehearses can outrun what the truth
  floor would accept in a written artifact.
- No new fitness function was added. `coaching/` inherits `FF-PORT-1` automatically (path-glob
  match, no per-context registration needed); the new validators are exercised by their own unit
  tests, the same treatment `validateCoverArtifact`/`validateResearchArtifact` already get.

## Alternatives considered

- **A second, independently-tuned relevance/ranking notion for coaching** (rather than sharing
  `trace.ts`'s tokenizer). Rejected: could rank evidence the truth floor later rejects as
  untraceable — a real, not theoretical, inconsistency risk.
- **A bespoke `CoachingStorePort`.** Rejected: the codebase already has one unused generic port
  (`StoragePort`); the real, repeatedly-used convention is direct `fs`+`yaml` writes in the CLI
  layer, and this task follows it rather than adding a second unused abstraction.
- **Auto-drafting `gaps.yml` rows from detected coverage gaps in T3.2.** Rejected as speculative
  scope — see "Gap lifecycle" above. Deferred as a documented, clean seam.
- **Dropping truth-trace entirely from the drill validator** (since a transcript legitimately
  contains an over-claim). Rejected in favor of scoping the checks to the coach-authored slice —
  the coach's own model answer must still be grounded, and a full-text honesty scan would wrongly
  fail the very record that documents a correction.
- **Three separate prep-pack services for interview/networking/event.** Rejected: triplicates
  retrieval and validation logic for a one-paragraph prompt difference.
- **A `NotifyPort` inside `packages/core`.** Rejected: notification is a driving-adapter/CLI-layer
  side effect, not a domain concern; core has no I/O today and this doesn't need to be the first.
