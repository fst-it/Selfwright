# Selfwright — Ubiquitous Language Glossary

Definitions are grounded in `packages/core/src/` and `docs/MANUAL.md §1`.
Terms are listed alphabetically within sections.

---

## Truth layer

**Truth layer** — the canonical source of authoritative facts about the owner: evidence
registry, identity timeline, drift entries, and ontology. Lives under `truth/` in both
the framework (`packages/core/src/truth/`) and the private data repo (`Selfwright-data/truth/`).
All generative output must trace back to the truth layer.

**EVD-\*** — identifier format for evidence entries (`EVD-<SCOPE>-<IDX>`, e.g. `EVD-PM-001`).
Every evidence entry in `truth/evidence/registry.yml` carries one of these IDs. Downstream files
reference EVDs by ID; `FF-TRUTH-2` ensures no dangling references exist.

**Truth floor** — the rule that every substantive claim in a generated artifact must be
traceable to at least one EVD-* entry by keyword overlap. Enforced by `FF-TRUTH-1` and
`FF-R19`. The truth floor cannot be bypassed by any gate, LLM call, or PR.

**Archetype** — a role cluster with associated skill tags, keywords, and target titles,
defined in `truth/ontology.yml` (data) and typed as `Archetype` in `truth/schemas/index.ts`.
Archetypes drive JD matching, posting scoring, and cover framing.

**Drift** — a recorded change to a past role claim: a keyword correction, updated phrasing, or
a claim addition after new evidence. Typed as `DriftEntry` in `truth/schemas/index.ts`.
Active drifts are applied by `tailoring/drift-apply.ts`. Retired drifts are still tracked (for
honesty-wall scanning) but never applied.

**Honesty wall** — `truth/honesty.ts`: `scanHonestyBoundary(text, drifts, registry)` checks
that no text claims keywords belonging to a retired drift or retired evidence entry. Enforced by
`FF-TRUTH-3`.

**R19 guard** — `truth/r19-guard.ts`: `guardSummary(text, identity, registry)` verifies that
every substantive sentence in a generated summary shares content words with at least one EVD-*
entry. "R19" refers to the requirement that made the guard necessary (generation rule 19).
Enforced by `FF-TRUTH-5`.

**Ontology** — the structured vocabulary for scoring, stored in `truth/ontology.yml` (data) and
typed as `Ontology` in `truth/schemas/index.ts`. Contains archetypes, tag definitions, and
controlled keyword lists used across the scoring and coaching contexts.

---

## Scanning

**Posting** — a raw job advertisement fetched from an external source. Typed as `RawPosting` in
`scanning/types.ts`. Postings go through liveness classification, dedup, fit scoring, and
optionally queue entry creation.

**Liveness** — the classification of a posting page: `"live"` (apply button visible),
`"expired"` (closed banner), or `"uncertain"` (bot-gated or ambiguous). Computed by
`scanning/liveness.ts`. `FF-SCAN-1` verifies correct classification on synthetic fixtures.

**Dedup** — deduplication of postings within a scan pass and against the seen-set ledger.
`scanning/dedup.ts` implements exact-URL dedup (`isSeen`), company+role dedup
(`dedupeByCompanyRole`), and fuzzy title dedup (`dedupeByCompanyRoleFuzzy`, Jaccard ≥ 0.5
on stopword-filtered tokens). `FF-SCAN-2` enforces correct dedup behavior.

**Queue / QueueEntry** — the set of postings that have survived liveness+dedup and are
candidates for an application. Each entry is a `QueueEntry` (typed in `scanning/types.ts`),
carrying company, derived role, fit score, source, and activity timestamps.

**Queue aging** — the rule that a `QueueEntry` whose most-recent activity timestamp
(`lastSeenAt` if set, otherwise `queuedAt`) is older than the configured window (default 30 days)
is treated as stale and hidden from default views. Entries are never deleted. Implemented in
`scanning/queue-aging.ts`.

---

## Scoring

**ATS pass A/B** — the binary classification of whether a CV passes or would likely be filtered
by an applicant tracking system for a given JD. Computed by `scoring/ats.ts`.
`FF-FIT-1` enforces a quality floor (result is never `null` or grade `"F"` for a well-matched JD).

**Scoring vocabulary** — the set of domain terms, keywords, and their weights used by the JD
fit scorer (`scoring/score.ts`). Loaded from `positioning/scoring-vocabulary.yml` (private data)
or falling back to `DEFAULT_SCORING_VOCABULARY`. `FF-VOCAB-1` guards against accidental use of
the default placeholder.

---

## Tailoring

**Overlay** — a set of structured CV modifications supplied by the owner for a specific
application: a tailored summary, drift applications, keyword additions, and metadata. The overlay
is the primary input to `tailoring/tailor.ts`.

**Tailored CV** — a `TailoredCvContent` produced by `tailoring/tailor.ts` by applying an
overlay to the base `CvContent`. Every tailored summary is validated against the truth floor
before the result is returned.

---

## Coaching

**Gap** — a topic (skill, domain, or concept) where the owner has partial or no evidence
coverage relative to a target archetype. Typed as `Gap` in `truth/schemas/index.ts`.
Gaps are computed by `coaching/coverage.ts` and surfaced in `HOME.md`.

**Debrief** — a structured post-interview record capturing outcomes, topics raised, and
follow-up actions. Typed as `Debrief` in `coaching/debrief.ts`. `inboxService` surfaces
un-debriefed interviews.

**Drill** — a focused coaching question or exercise targeting a specific gap, stretch topic, or
strength. A `DrillSelection` (typed in `coaching/types.ts`) combines the topic, kind, and a
bundle of ranked supporting evidence.

**Prep pack** — the bundled materials prepared before an interview or networking event: a
curated evidence bundle, key keywords, and a framing narrative. Typed as `PrepPackKind`
(`"interview"` | `"networking"` | `"event"`) in `coaching/types.ts`.

**Inbox** — the three-tier digest produced by `services/inbox.ts`: open applications by stage,
active queue entries, and un-debriefed interviews. Stale queue entries are excluded from the
active view.

---

## Generation

**North star** — the high-priority target posting used to calibrate all scoring and tailoring.
Stored in `data/north-star.yml` (private). `computeNorthStar` derives the calibration target
from fit score, archetype match, and compensation data.

**Co-piloted generation** — Selfwright's default generation path: assemble a truth-grounded
prompt (evidence bundle + archetype framing + JD context), then pass it to the Claude CLI for
the user to review before output is used. No autonomous API calls; no keys stored in the
framework repo.

---

## Architecture

**Port** — a hexagonal contract defining how the core domain interacts with an external
capability (LLM, storage, scan provider, renderer, memory). Each port is a single TypeScript
interface in `packages/core/src/ports/`. Adapters implement ports; `packages/core/` never imports
adapters. Enforced by `FF-PORT-1`.

**Adapter** — a concrete implementation of a port living in `packages/adapters/`. Adapters may
import from `packages/core/` (to satisfy port types) but not the other way around.

**Bounded context** — a directory under `packages/core/src/` whose public API is the sole
export surface for outside callers. Cross-context imports must target the context's `index.ts`,
never a deep file. Enforced by `FF-CONTEXT-1`. Exempt: `ports/` and `shared/`.

**Open-core boundary** — the separation between the public framework repo (this repo) and the
owner's private `Selfwright-data` repo. The data-leak gate (`FF-DATA-LEAK-1`) and the named-entity
scan enforce this boundary at commit time.

**Gate / Fitness function** — an executable, version-controlled assertion of an architectural
or data-integrity property. All gates must pass before a PR merges. Defined in
`fitness/src/checks/`; described in `docs/fitness-functions.md`.
