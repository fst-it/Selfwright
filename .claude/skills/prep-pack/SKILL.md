---
name: prep-pack
description: Draft a truth-grounded interview, networking, or event prep-pack (likely questions, evidence-grounded model answers, gaps to rehearse), co-piloted like cover — you write it, a deterministic validator checks it. Use when the user wants a prep document for an upcoming interview, networking conversation, or event.
argument-hint: "<app-dir>"
---

# prep-pack

Same co-piloted discipline as `cover` (D-1, ADR 0006 / ADR 0013): no LLM gateway call.
`pnpm selfwright prep-pack` assembles a truth-grounded prompt and stops; **you** (this session) write
the actual pack from it; `pnpm selfwright prep-pack --check` then validates the result deterministically
(truth-trace, honesty walls, required structure).

One command handles all three contexts via `--kind`:
- `interview` (default) — likely questions, grounded model answers, and a **mandatory** "Gaps to
  rehearse" section.
- `networking` — talking points and questions to ask, with a lighter, optional gaps section.
- `event` — positioning and conversation starters aligned to the event's themes.

## The loop

```
pnpm selfwright prep-pack <app-dir> --kind interview
```
Writes `<app-dir>/prep-pack-prompt.md` (system + user prompt, grounded in ranked evidence for the
target archetype/JD, plus any tracked gaps relevant to the topics).

Draft `<app-dir>/prep-pack.md` from that prompt yourself, following its instructions exactly:
- Required headings: `## Likely questions`, `## Grounded answers`, and — for `interview` only —
  `## Gaps to rehearse` (must cite at least one `GAP-*` and one `EVD-*`).
- Every substantive claim must trace to the provided evidence — draw phrasing from the actual
  registry entries rather than paraphrasing loosely.
- For any gap you include, use its own `frame` text as the model answer — never invent a smoother
  framing.
- Respect every cited entry's `honesty` note exactly.

Validate:
```
pnpm selfwright prep-pack <app-dir> --check --kind interview
```
Exits 0 when clean; otherwise lists specific violations (untraceable claims, honesty-boundary hits,
a missing/ungrounded "Gaps to rehearse" section, or an unknown `EVD-*`/`GAP-*` id). Fix the
specific line named and re-run `--check` — don't rewrite the whole pack blind.

## What never to do

Never fabricate a claim, question, or gap-framing to fill the pack out — if `--check` flags
something as untraceable, remove or reword it, or find the real evidence-registry entry it should
map to.
