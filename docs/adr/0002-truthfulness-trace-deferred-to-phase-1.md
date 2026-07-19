# 0002 — Truthfulness-trace fitness functions deferred to Phase 1

- Status: Accepted (2026-06-28)
- Supersedes: —

## Context

The anchor (§7.2) names four "existential" Phase 0 fitness functions: **truthfulness-trace**,
data-leak, core-has-no-provider-imports, and the anti-hallucination / anti-laziness build gates.
The anchor frames truthfulness-trace as a suite that validates every outward claim (CV bullet,
cover-letter sentence, referral note) back to a ground-truth evidence file in `data/`.

## Constraints that forced deferral

Full truthfulness-trace requires infrastructure that Phase 0 deliberately excludes:

1. **No truth layer yet.** The `packages/core/` ports define `LlmPort` and domain types, but there
   is no `TruthPort`, no evidence schema, and no `data/truth/` store — those are Phase 1 scope.
2. **No outward content yet.** Phase 0 produces zero CV bullets, cover letters, or referral notes.
   The fitness function would have no claims to check; its value is nil and its maintenance cost
   is not.
3. **Zod schemas for evidence validation** are not designed. Designing them correctly is a
   named Opus escalation topic (per AGENTS.md §5) that belongs with the truth-layer design, not
   ahead of it.

## Decision

Defer the full truthfulness-trace suite (planned as FF-TRUTH-1 through FF-TRUTH-4) to Phase 1.
The **anti-hallucination check (FF-HALLUC-1)** ships in Phase 0 as a structural proxy: it
verifies that every relative import path in source files resolves to a real file, preventing
phantom references at the module level. This is a weaker guarantee than full claim-tracing, but
it is the tightest achievable guarantee over code that produces no outward claims yet.

The first outward content is produced in Phase 1 (CV generation). The full truth-trace suite will
be active and enforced **before** that content can be committed.

## Consequences

- Phase 0 has no claim-to-evidence tracing. This is acceptable because no outward claims exist.
- The FF-TRUTH-1–FF-TRUTH-4 placeholders are noted in `docs/fitness-functions.md` §2 (planned
  Phase 1+ FFs) so they are not forgotten.
- This decision must be revisited at the start of Phase 1 before any CV-generation code is merged.
- Any PR that introduces `LlmResult` content written to a file outside `data/tmp/` must not merge
  until FF-TRUTH-1 is implemented and green.
