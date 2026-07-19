# Architecture Decision Records (ADRs)

We record significant architectural decisions here so they aren't re-litigated — and so AI
assistants don't burn context re-deriving them. The baseline is ratified in
`0001-platform-architecture-baseline.md`.

Some ADRs reference internal `D#` decision numbers (e.g. "D5", "D17"). These point to a private
founding decisions ledger that predates the open-core release and is not part of this public
repository. The ADRs themselves are self-contained; the `D#` references are historical pointers,
not links you can follow.

## Process
- New significant decision → add `NNNN-short-title.md` (next number).
- Status: `Proposed` | `Accepted` | `Superseded (by NNNN)`.
- Keep it short: **Context · Decision · Consequences · Alternatives considered**.

## Convention: living ADRs (since 2026-07-12)

ADRs are living documents. When a decision evolves, rewrite the file in place; git history is the
changelog. There is no separate "superseded" status for a decision that has merely changed.

Write a **new ADR** when a new mechanism or concern isn't covered by any existing ADR. **Rewrite
in place** when a covered decision changes — same area, updated choice. The `Superseded (by NNNN)`
status still applies when a new ADR for a different mechanism displaces an old one wholesale; it
does not apply to an evolved decision, which is rewritten in place.
