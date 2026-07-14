# 0018 — Versioning & release discipline: single platform SemVer, conventional-commit bumps, SCHEMA-VERSION coupling

- Status: Accepted (2026-07-10, owner-approved)
- Supersedes: none. Establishes the first formal versioning contract for the platform.

## Context

Through Phase 3 there was no versioning discipline: root `package.json` carried `0.0.1` and there
were no CHANGELOG entries, no version tags, no schema-compatibility contract with Selfwright-data.
Phase 4 introduces an enhancement and bugfix cadence (multiple commits per week) that makes
"which version am I running?" a real operational question. The lack of a versioning discipline also
means data-schema changes have no formal coupling to framework releases, risking silent breakage
when the data repo and framework drift.

The platform is a solo pre-OSS monorepo with no external package consumers. Workspace packages
(`@selfwright/core`, `@selfwright/adapter-*`, etc.) are internal build units — nothing publishes
to a registry.

## Decision

### 1. One platform version, SemVer

A single `MAJOR.MINOR.PATCH` version lives in the root `package.json`. It is the authoritative
platform version. Workspace packages carry no independent versions and are not published; they
inherit the platform release context.

Git tags `vA.B.C` are applied to the merge commit on `main` after the PR lands. Tagging is a
post-merge step performed by the owner (or with explicit owner approval) — tags are pushed refs
and must not be created or pushed by agents.

Per-package versioning and changesets are deliberately deferred (see Alternatives).

### 2. What triggers each bump

| Bump | Trigger |
|------|---------|
| **MAJOR** | Breaking or architectural change: a data-schema change requiring migration in Selfwright-data; superseding a load-bearing ADR (e.g. the read-only dashboard gaining write actions); the two-repo split into open-core + private. **The open-core public debut shipped as 0.6.0 (2026-07-13)**. 1.0.0 is now reserved for a future API-stability milestone — when the `/api/*` surface commits to a backward-compatible public contract rather than remaining an internal cockpit contract. |
| **MINOR** | Backward-compatible new capability: new command, skill, dashboard page, fitness function, or scan provider. |
| **PATCH** | Bug fixes, hardening without new surface, docs, dependency bumps. |

Conventional commit prefixes drive the bump mechanically: `feat:` → minor, `fix:` → patch,
`feat!:` / `fix!:` / `BREAKING CHANGE:` footer → major. The bump is applied IN the PR that
lands the change, together with the CHANGELOG entry.

### 3. Retroactive baseline

Phase history is codified as:

| Tag | Commit | Summary |
|-----|--------|---------|
| v0.1.0 | Phase 1 merge | Platform architecture baseline; truth layer, deterministic scanner, fitness gate |
| v0.2.0 | Phase 2 merge | LLM tier; Ollama eval, Postgres/pgvector, mem0/MCP |
| v0.3.0 | 9cd0c4d | Phase 3 + hardening (PR #25); coaching, content, reporting, web dashboard, CI gate hardening (ADRs 0011–0017) |

These tags will be applied to the named commits. Phase-number ≈ minor version is a coincidence of
this baseline, **not the rule** — the rule is SemVer by change type.

The current development stream starts at `0.4.0-Unreleased` (this change is its first entry).

### 4. CHANGELOG format

Root `CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/). Each release section
uses `## [X.Y.Z] — YYYY-MM-DD` (or `Unreleased`). Entries are grouped under `Added`, `Changed`,
`Fixed`, `Deprecated`, `Removed`, `Security`. Reference the ADR number when a change is governed
by one (e.g. `(ADR 0018)`). The unreleased section is the working draft; it is replaced with the
release date on merge.

### 5. SCHEMA-VERSION coupling with Selfwright-data

Selfwright-data carries a one-line `SCHEMA-VERSION` file (plain integer, starts at `1`). The
framework `CHANGELOG.md` states the expected schema version per release. A framework change that
forces a data migration is by definition MAJOR and bumps SCHEMA-VERSION in Selfwright-data
alongside the MAJOR bump in the framework.

Operational coupling: before running a new framework version, confirm that the schema version
the framework expects matches `SCHEMA-VERSION` in the data repo. A mismatch must be resolved
by running the appropriate migration before starting the framework — no silent fallback.

## Consequences

- Every PR now carries a version bump and a CHANGELOG entry. The cost is small (two edits); the
  benefit is an always-current operational history.
- The schema-version coupling makes data migrations explicit and traceable rather than implicit.
- Product-surface labels (e.g. "web dashboard v1.1") live in ADR lineage (ADR 0016 et seq.) and
  are distinct from the platform version — the two numbering systems do not interfere.
- Workspace packages remain purely internal; no publish pipeline is introduced.

## Alternatives considered

**Per-package versioning with changesets.** Deferred. There are no external package consumers
today and no publish pipeline. Adding changesets now buys overhead with zero benefit. Revisit if
and when packages ever publish to a registry.

**Automated release tooling (semantic-release).** Deferred. The habit must exist before the
automation. Automating a discipline that does not yet exist tends to paper over the gaps rather
than enforce them. Revisit after the habit is established over several releases.

**FF-VER-1 fitness check** (tag ↔ `package.json` ↔ `CHANGELOG.md` agreement). Deferred for
the same reason: establish the discipline manually first, then consider whether a gate adds enough
enforcement value to justify the maintenance cost. The deferred status is explicit so it is not
forgotten.
