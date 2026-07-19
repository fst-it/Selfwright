# 3. YAML parser for the truth-layer loader

Date: 2026-06-28

## Status

Accepted

## Context

Task 1.1 implements the `storage-git` adapter that reads the truth layer
(`Selfwright-data/truth/*.yml`) and validates it with Zod. The evidence
registry uses YAML 1.2 features the hand-rolled parsers in
`career_plan/tools/lib/{ats,yaml}.mjs` do not support: `>` block scalars
(multi-line `detail`/`tech_stack`), deeply nested objects (per-facet `tag`
maps, `confidence.factors`), and quoted keys. A real YAML parser is required.

Constraints:
- New npm dependencies require an ADR (this one).
- `packages/core/` may import ONLY Zod — the parser must live in the
  `storage-git` adapter, never in core.
- The truth layer is append-only and heavily commented; future tooling may
  need to write entries back without destroying comments (Hard Rule 7 of
  `career_plan/CLAUDE.md`: append new evidence after each application).

## Decision

Use **`yaml`** (eemeli) in `packages/adapters/storage-git`. Parsing is confined
to the adapter; core continues to depend only on Zod.

## Options considered

- **`yaml` (eemeli)** — YAML 1.2, ~50KB, zero runtime dependencies. Preserves
  comments and document structure, enabling future round-trip writes of the
  append-only registry.
- **`js-yaml` (v4)** — YAML 1.2, mature and widely used. Slightly faster on
  large pure-data files, but does not preserve comments and cannot round-trip
  the heavily-annotated registry files without loss.

## Decision drivers

1. Zero-dependency supply chain — keeps the adapter boundary clean.
2. Comment-preserving round-trip — protects the append-only, annotated truth
   files if tooling later writes to them (Hard Rule 7).
3. YAML 1.2 conformance — both candidates satisfy this; not a differentiator.

## Consequences

- `yaml` is added to `packages/adapters/storage-git` only; core stays Zod-only.
- The dependency-cruiser `FF-PORT-1-core-no-framework-npm` rule continues to
  block any npm imports from `packages/core/src/`.
- The adapter can expose a comment-safe writer for Hard Rule 7 without a
  second dependency.
- If write-back is never needed, the only cost over `js-yaml` is marginal parse
  speed on large files — negligible for the truth layer's current size.
