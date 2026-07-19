# Selfwright — Governance

Selfwright is a solo-maintained open-core project. This document describes how decisions are
made, recorded, and revisited.

## Decision-making

The maintainer (Felipe Tavares) is the final decision-maker on all technical and product
questions — a BDFL (Benevolent Dictator for Life) model. This is appropriate for a project
at this stage. It may evolve if the contributor base grows significantly.

Community input is welcome through GitHub Issues and Discussions. Pull requests for bug fixes
and focused improvements are reviewed on their merits. For larger changes — new bounded
contexts, new adapters, breaking changes to the fitness-function catalog or the API contract —
open an issue first to discuss scope and fit before investing in an implementation.

## Recording decisions

Significant architectural decisions are recorded as Architecture Decision Records (ADRs) in
`docs/adr/`. The process:

- **New mechanism or concern** not covered by an existing ADR: create `docs/adr/NNNN-short-title.md`.
- **Existing decision that changes**: rewrite the existing ADR in place; git history is the
  changelog (living-ADR convention, introduced 2026-07-12).
- **One ADR fully displaced by another**: the old one gets `Status: Superseded (by NNNN)`.

The catalog of locked decisions (D1–D31) lives in a private founding ledger not included in
this public release. Any change that touches a `D#` entry must update the corresponding ADR.

## Roadmap

The phased roadmap is in `ROADMAP.md`. Significant design decisions that affect the roadmap
are captured in ADRs as they land.

There is no public project board. Status of active work is visible in the branch/PR list and
in the ADR history.

## Open-core boundary

The framework (this repository) is Apache-2.0. The private data layer — your truth files,
applications, contacts, drift files, and compensation data — is yours and lives in a separate
private repository that is never published.

The data-leak gate (`FF-DATA-LEAK-1`, `fitness/src/checks/data-leak.ts`) is the mechanical
enforcement of this boundary. It runs at pre-commit and in CI. A commit that carries personal
data into the framework repo fails the gate and cannot merge.

This boundary is also what makes commercial use possible: the framework/data split is the
load-bearing line for any future hosted tier or SaaS offering. See ADR 0021 for the full
open-core decision record.

## Versioning

Releases follow Semantic Versioning, managed per ADR 0018. The `CHANGELOG.md` records what
changed in each release. Version `0.6.0` marks the public extraction of the framework from
the owner's private operational repo.

## License

Apache-2.0. The patent-grant clause was the key reason over MIT: it protects contributors
and downstream users without restricting commercial use. See the `LICENSE` file.
