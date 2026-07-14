# 0021 — Open-core OSS path: public framework repo at extraction time, personal data stays private

- Status: Accepted (2026-07-12, owner decision; updated in place 2026-07-13 with locked
  Phase 5 decisions — living ADR convention, docs/adr/README.md).
- Supersedes: none. Resolves the pending D5 decision ("open-core, commercializable later") from
  the anchor's decisions ledger.

## Context

Decision D5 (anchor §5) explicitly deferred the OSS-vs-company question to Phase 4 maturity.
Phase 4's DoD required that decision to close. Three things made the answer clear:

1. **IP/AGPL audit clean.** `docs/audits/ip-agpl-audit-2026-07.md` confirmed zero AGPL/GPL/LGPL
   dependencies in the framework proper. Metabase (AGPL v3) is arm's-length (image-only, zero
   SDK imports, removable). The open-core extraction path is unobstructed.

2. **Extraction test passed.** An internal extraction-and-restore test demonstrated that the
   framework builds, tests, and passes all fitness checks with a stranger's synthetic data
   dir, with no access to the private data repo. The "use this template" path works today.

3. **D6 history constraint.** The current private repo contains git history with since-redacted
   confidential names (commits not fully squashed across all intermediate branches). Publishing
   the current repo's full history would expose those commits. The extraction strategy — fresh
   history from a snapshot — eliminates the problem entirely.

The alternatives were:
- **Company-first (defer OSS):** rejected. Delays portfolio and public visibility during the active
  job search, with no offsetting business benefit at this stage of maturity.
- **Defer decision further:** rejected. Leaves Phase 4 open, the portfolio idle, and the D5 entry
  perpetually pending.

## Decision

**Open-core OSS.** The framework becomes a public repository at extraction time. The personal data
repo (`Selfwright-data`) remains private and is never published.

### Extraction mechanics

The public `Selfwright` repo is created from a **snapshot with fresh history** — not a branch push
of the current private repo. Fresh history:
- eliminates the intermediate commits that contained since-redacted confidential names;
- gives the public repo a clean, audit-ready first commit;
- is consistent with the anchor D6 plan ("repo = private monorepo now → split at OSS time").

The current private repo is renamed `Selfwright-personal` and retained as the operational repo
(application pipeline, debriefs, contacts, data remain there). Its history stays private.

The `Selfwright-data` repo stays private and is never included in the extraction.

### Repository home

The public repo lives at **`fst-it/Selfwright`** under the owner's personal GitHub profile —
already created, currently empty, under public-release embargo until the owner gives an
explicit "go" (T5.14 gate). The `selfwright` org handle is reserved separately for future
use; the repo itself launches under the personal profile.

At cutover: the current private `Selfwright` repo is renamed `Selfwright-personal` and
**remains the development home** — all development continues there. `fst-it/Selfwright`
receives curated releases the owner promotes to the public; it is not the day-to-day
development repo. `Selfwright-data` remains private and is never included in the extraction.

### Version at extraction

The public repo's first tag is `v0.6.0`, per ADR 0018 (updated 2026-07-13): the open-core
public debut ships as 0.6.0; 1.0.0 is reserved for a future API-stability milestone.

### Monetization posture

Exposure and career capital are the primary near-term return. The architecture deliberately
preserves commercial options:
- The framework/data boundary (ADR 0017, the data-leak gate) is the load-bearing line for any
  future SaaS or hosted tier.
- Nothing in this decision forecloses a company-first path later; it defers it deliberately rather
  than closing it.

### License

**Apache-2.0 + NOTICE.** Chosen by the owner (Phase 5 decision elicitation, 2026-07-12). The
patent-grant clause of Apache 2.0 is the key reason over MIT; it protects contributors and
downstream users without restricting commercial use. AGPL is disqualified by the commercial-
options goal. A `NOTICE` file will credit the two acknowledged prior-art sources:
`santifer/career-ops` (MIT, Arbeitnow provider) and `last30days-skill` (used in the hook
tooling).

### Community posture

Issues open; small PRs welcome. **DCO required, no CLA** — contributors sign off commits
with `Signed-off-by: Name <email>` (the standard Developer Certificate of Origin flow), which
suffices for Apache-2.0 and avoids the friction and legal overhead of a contributor license
agreement. Governance stays at maintainer discretion; no formal process is committed to at
launch.

## Consequences

- The open-core decision is resolved: the platform is open-core OSS.
- ADR 0018's extraction milestone is confirmed as `0.6.0` (public debut, 2026-07-13).
- The `examples/data-template/` directory (committed in this same PR) serves the "use this
  template" path that the extraction test validated.

## Alternatives considered

**Company-first.** Build a commercial product around the platform before publishing. Rejected for
now: the job search is active, and the portfolio value of a public, high-quality open-source tool
is immediate. The commercial path is preserved by architecture (the data/framework boundary) and
can be revisited at any time.

**Defer the decision.** Leaving D5 open was the Phase 3 posture. Phase 4 DoD required resolution.
Deferring again buys no value and keeps the Phase 4 exit milestone blocked.

**Publish current repo with full history.** Rejected. The intermediate commits containing
since-redacted names make this unacceptable without a full history scrub, which is equivalent
to starting with fresh history and less clean.
