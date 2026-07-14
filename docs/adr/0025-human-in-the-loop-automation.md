# 0025 — Human-in-the-loop automation: the only hard boundary is the final submit

- Status: Accepted (2026-07-13, owner ruling)
- Updates: CONSTITUTION.md principle 4 (reframes "Human submits" → "Human-in-the-loop; the
  human submits"). All other principles unchanged.

## Context

CONSTITUTION.md principle 4 previously read as a general prohibition: "Selfwright prepares every
artifact and stops." That wording was originally appropriate when the platform's scope was limited
to generation and validation. As the platform matures, it now covers discovery, triage, scoring,
tailoring, coaching, and research. A blanket "prepares and stops" framing was starting to block
legitimate automation work.

Specifically, two capabilities were in tension:

1. **Supervised form pre-fill.** A browser extension or Playwright script that reads a tailored CV
   and fills the visible fields of an ATS application form — stopping before the submit button —
   was being read as a boundary violation. The human would still review every field and click
   Submit themselves, but the existence of any browser-level automation felt disallowed.
2. **Richer pre-submit automation.** Triage, scheduling, research generation, and drill prep run
   with increasing automation. There was no clear principle articulating that these were different
   in kind from a hypothetical autonomous submit.

The owner reviewed the principle on 2026-07-13 and issued the following ruling.

## Decision

### 1. The refined principle

Automation of operational workflow steps is **encouraged**, not merely tolerated. Discovery,
scoring, tailoring, generation, company research, interview prep, and form pre-fill are all
legitimate automation territory. The system should run as much of this as adds value, with the
human in the loop reviewing outputs.

The one hard prohibition: **no code path in this repository autonomously reaches the final submit
control on any career website or ATS.** The human reviews the pre-filled or prepared artifact
and makes the final submit decision.

This is a narrowing of the previous principle's implied scope. What changes: pre-submit automation
including form pre-fill is explicitly permitted. What does not change: the final submit action
remains human-only, and that boundary is enforced by the same mechanisms as before.

### 2. What this unblocks

**Supervised form pre-fill (BACKLOG item 28).** A script or extension that reads a tailored CV,
walks the ATS form fields, and fills them — then stops. The human reviews the pre-filled form and
clicks Submit. This now satisfies the constitutional boundary because the submit action is
performed by the human, not by the platform.

Any future pre-submit automation that stops before the final submit control is similarly
unblocked. The test: does any Selfwright code path click, POST to, or otherwise trigger the
actual submit action on a career website? If yes, it violates the principle. If no, it is in
scope.

### 3. The hard boundary, stated precisely

No code path in this repository:
- Clicks or programmatically triggers a submit button on a career website or ATS.
- Makes a POST request to an ATS application-submission endpoint on the user's behalf.
- Delegates the submit action to another agent or subprocess without an interposed human
  review step.

This list is exhaustive within the scope of this ADR. Future capabilities that approach this
boundary should reference this ADR and state explicitly where they stop.

### 4. Enforcement mechanisms — unchanged

The enforcement mechanisms from the previous principle 4 carry forward without modification:

- No write action in `apps/web` calls an external ATS submit endpoint or triggers any
  final-submit action on a career website. This remains the primary structural guarantee.
- `FF-LLM-1` (llm-egress): no LLM adapter wired by default; opt-in required.
- The `--check` step remains a separate, explicit user action.

No new fitness function is introduced here. The existing structural check (no ATS submit endpoint
called anywhere in `apps/`) already captures the hard boundary and requires no modification to
cover the refined principle.

## What is NOT changed

- Principles 1–3 and 5–7 in CONSTITUTION.md are untouched.
- The truth floor, data-leak boundary, honesty walls, fitness-functions-as-law, local-first, and
  conventional-process rules are unaffected by this ruling.
- The egress guard (`FF-EGRESS`) posture is unchanged. Pre-fill automation that drives a local
  browser via Playwright routes through the same SSRF guard as any other outbound navigation.
- The existing generation flow (prompt assembly → user runs Claude → validate) is unchanged. This
  ADR expands what is allowed before that step, not what happens in it.

## Consequences

- CONSTITUTION.md principle 4 is renamed to "Human-in-the-loop; the human submits" and rewritten
  to reflect this ruling. DESIGN.md's non-goals section and FAQ.md are updated to match.
- BACKLOG item 28 (supervised form pre-fill) moves from a constitutionally ambiguous item to a
  clearly aligned one, flagged ✅.
- The phrase "co-piloted generation, not automated generation" no longer appears as a summary of
  principle 4, because automation is now the design expectation, not a contrast to be defended
  against.
- Any contributor proposal that places automation before the final submit can be evaluated on its
  merits — fit score, complexity, egress implications — rather than being blocked by the principle
  before the evaluation begins.

## Alternatives considered

- **Keep the broad prohibition; carve out pre-fill as a named exception.** Rejected: exceptions
  to a constitutional principle compound over time. The right move is to state the principle at
  the correct granularity — the final submit action — and let the boundary do the work, rather
  than accumulating a list of named exceptions.
- **No change to the principle; handle this in BACKLOG commentary only.** Rejected: the principle
  is the authoritative source. If the principle says "prepares and stops," any feature that does
  more than prepare requires a constitutional amendment. A BACKLOG note cannot override a
  constitutional rule.
- **Stronger automation prohibition (nothing automated after generation).** Rejected by the owner
  as inconsistent with the platform's actual operation: triage, scoring, research, and coaching
  already run with substantial automation. A prohibition at this level would require rolling back
  existing functionality, which the owner explicitly ruled against.
