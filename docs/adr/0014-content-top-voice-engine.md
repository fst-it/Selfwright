# 0014 — Content/Top-Voice engine: deterministic topic selection, co-piloted research digest

- Status: Accepted (2026-07-09)
- Supersedes: none. Implements T3.3 (anchor §10 Phase 3, runbook §8).

## Context

T3.3 asks for a content engine on two cadences — a weekly digest (3–5 ranked, cited topics to
write/read per archetype) and per-application targeted suggestions — surfaced as markdown in
`Selfwright-data`, an `/inbox` tier, an ntfy nudge, and a `/topics` skill. The runbook directs
forking patterns from `mvanhorn/last30days-skill`, read in the real repo first (same protocol as
T2.3's `career-ops` fork).

What that repo actually is: a skill-time research harness. The LLM harness itself performs the web
sweep live in-session (multi-query expansion, a 30-day freshness window, engagement-weighted
ranking — upvotes/likes/views over SEO), merges cross-platform clusters, and synthesizes a cited
markdown brief saved locally. Its heavier machinery — ScrapeCreators API integrations, browser
cookies for X, SQLite trend persistence, per-platform CLIs — exists to widen source coverage.

## Decision

### What is forked, and what is deliberately not

**Forked:** the skill-loop shape. Research happens at skill runtime, in the co-piloted session
(ADR 0006's pattern — no API keys, no daemon), against a 30-day freshness window, preferring
high-engagement/authoritative sources, and produces a ranked markdown brief where every topic
carries at least one real citation URL. The brief is validated deterministically before it counts.

**Not forked:** the scraper/API surface (ScrapeCreators, cookie-authenticated X access, per-source
CLIs) — third-party API keys and credentialed scraping are incompatible with the subscription-only
constraint and the data-leak posture; SQLite trend persistence — `Selfwright-data` markdown +
`content/content-history.yml` is the platform's existing persistence convention; engagement-score
*infrastructure* — the co-pilot is instructed to weigh engagement/authority when ranking, but no
numeric engagement scoring is persisted or gated on (it would be unverifiable at validation time).

### The credibility split: deterministic core decides *what*, the co-pilot researches *what's current*

The platform's angle on "Top Voice" is not "what is trending" alone — it is the intersection of
what is current with what the owner can *credibly* write about. That credibility question is
exactly what the coaching substrate already answers, so the core half is deterministic and reuses
it wholesale (the same "one relevance primitive" rule ADR 0013 established — a second notion of
topic relevance would let the content engine suggest writing about something the truth floor would
reject as untraceable):

- `packages/core/src/content/topic-select.ts` — `selectContentTopics(archetype, registry, gaps,
  history, ontology?)` maps `computeCoverageGaps` output into two directions: **write** candidates
  (covered topics — evidence-backed, ranked by the shared relevance score, each with an evidence
  bundle via `selectEvidenceForTopic`) and **read** candidates (`gaps.yml` rows weighted above
  uncovered above partial topics — the learning loop). Freshness reuses drill-select's
  multiplicative decay so digests don't repeat back-to-back; the cap is split across directions so
  write topics can't crowd out the learning side. Fully deterministic, no RNG, no clock.
- `selectContentTopicsForApplication(jdKeywords, …)` — the per-application cadence over
  `computeCoverageGapsForKeywords`, history-free (deterministic per JD).

### Co-piloted digest, gated like every other generated artifact

`services/topics.ts` mirrors `prep-pack.ts` (prompt builders + optional headless `topics(ctx,
llm)` parity hook). `validateTopicsArtifact` in `generation-guard.ts` gates the saved digest:
required `## Topics to write` / `## Topics to read` headings (line-anchored, per the T3.2
section-boundary fix), 3–5 ranked topics total, ≥1 `http(s)://` citation per topic, every
`EVD-*`/`GAP-*` id must exist (`assertIdsExist`), a correctly-anchored `Grounding:` line, honesty
boundary over the full text, and truth-trace scoped to self-claim sentences via the shared
candidate-sentence extractor (unforked — it carries T3.2's second-person hardening).

### Surfaces

CLI `selfwright topics <archetype-id>` (digest) / `--app <app-dir>` (per-application) /
`--check <path>`; matching MCP tool; a 5th hardcoded `/inbox` "content" loop (digest staleness —
same no-plugin-abstraction style as the coaching tier); `.claude/skills/topics/` +
`selfwright-topics` command encoding the research loop. Digests land in
`Selfwright-data/content/digests/<date>-<archetype>.md`; per-application suggestions in the
application directory. All writes use the CLI's raw `fs`+`yaml` convention (no new port — same
reasoning as ADR 0013).

### Privacy boundary for skill-time web research

The `/topics` skill instructs the co-pilot that web queries must carry **generic topic terms
only** — never the owner's name, employer history, application targets, or any `Selfwright-data`
content beyond the topic phrase itself. This matches the existing posture: the scanner already
fetches public boards; what never leaves the machine is personal data. The ntfy nudge stays
ids-only via the existing `@selfwright/shared-notify` (`notifyCoaching` — ids or counts, never
topic keyword text, the exact leak class T3.2's review caught).

## What is NOT changed

History-append semantics deliberately mirror drill's shipped convention: candidates are appended
to `content/content-history.yml` when the grounding prompt is generated, not when a digest is
saved ("offered = considered used"). An abandoned run therefore skews freshness for the next one —
reviewed (T3.3 adversarial review, finding 7) and accepted rather than forking the T3.2
convention; revisit only if abandoned runs turn out to be common in practice.

No scheduler (owner-run or OS-scheduled, per "no required daemon"). No new fitness function —
`content/` inherits FF-PORT-1 by path-glob; the validator gets unit tests like its three T3.2
siblings. No new notification package and no `NotifyPort`. `coaching/` itself is untouched —
`content/` is a consumer of its exported primitives, not a modification of them.

## Consequences

- The evidence registry and `gaps.yml` now drive a third loop (apply → rehearse → publish/learn),
  increasing the payoff for keeping both curated.
- Digest quality depends on the co-pilot's live research; the validator can enforce citations and
  truth-tracing but not source quality — accepted, same trust model as `cover`/`research`.
- A stale-digest inbox signal creates the weekly habit loop without a daemon.

## Alternatives considered

- **A deterministic web-fetching adapter for topic sources** (mirroring `scan-http`). Rejected:
  trending-topic discovery is an open-ended research problem, not a fixed-provider enumeration;
  the last30days evidence is that harness-time research with citations works, and a fetcher fleet
  would re-create the scraper surface deliberately not forked.
- **Extending `coaching/` instead of a new `content/` context.** Rejected: coaching is
  rehearsal/assessment (inward), content is publication/learning cadence (outward); sharing the
  relevance primitive is the right coupling, sharing a bounded context would blur two different
  truth-floor postures.
- **Persisting engagement scores for ranking** (last30days' SQLite pattern). Rejected: numbers the
  validator cannot re-verify at check time would put unverifiable data on a gated path.
- **A second relevance notion tuned for "writability".** Rejected for the same reason ADR 0013
  rejected it for coaching.
