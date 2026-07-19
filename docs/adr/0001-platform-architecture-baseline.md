# 0001 — Platform architecture baseline

- Status: Accepted (2026-06-26)
- Supersedes: —

## Context
Selfwright's founding architecture was established through an internal design process, including
a set of locked founding decisions and a five-persona adversarial review that stress-tested them.
That founding record predates the open-core release and is not part of this public repository;
this ADR restates the resulting baseline in full so it stands on its own.

## Decision
Ratify the following as the architecture baseline: open-core; local-first;
**TypeScript-first hexagonal modular monolith, API-first**; quality-first model routing via a
**LiteLLM** gateway with optional eval-gated local models; **git as source of truth**, projected to
**Postgres (+pgvector; Neo4j later)**; **AGENTS.md + mem0 (via MCP)** for memory; **CLI + MCP**
exposure with thin harness adapters (Claude Code / Cursor / OpenCode); **TDD + eval harness + a
fitness-function suite**; the **data-leak gate** as the #1 safety control. **v1 = the career core**
(migrate + strengthen from `career_plan`).

## Consequences
- This ADR is the single public reference for this baseline; any change requires a new ADR or an
  in-place rewrite of this one (living-ADR convention).
- The foundation phase of the project implemented the platform under these constraints.

## Alternatives considered
An earlier internal recommendation catalog and a five-persona adversarial review preceded this
baseline; both fed directly into the decision above rather than surviving as separate alternatives.
