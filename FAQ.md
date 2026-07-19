# FAQ.md — Selfwright Frequently Asked Questions

---

## Does Selfwright send any telemetry or track me?

No. The framework ships with zero telemetry, analytics, crash reporting, or usage tracking.
Nothing is sent to the maintainer or any analytics vendor.

The only outbound traffic the framework code ever generates is to services you explicitly
configure: job boards (search parameters only, never your CV or identity), an optional model
gateway that is off by default and requires `--adapter` to enable, and ntfy push notifications
(if you set `SELFWRIGHT_NTFY_URL`) that carry item IDs and counts only — no company names, role
titles, or claim text.

Three CI fitness checks enforce this and fail the build if violated: `FF-DATA-LEAK-1` (no PII or
secrets in committed code), `FF-EGRESS` (every outbound call routes through an SSRF guard), and
`FF-LLM-1` (no LLM adapter wired without explicit opt-in). See `SECURITY.md` for the full
data-egress policy, and `CONSTITUTION.md` §6 for the governing principle.

---

## Is my data private?

Yes. Your professional data — evidence registry, applications, compensation floors, named contacts,
drift files — lives in your own private `Selfwright-data` git repository. It never enters the
Selfwright framework repository.

Three enforcement layers make this concrete: `data/` is gitignored; a pre-commit and pre-push
hook (`FF-DATA-LEAK-1`) blocks any personal-data pattern from entering the framework; a named-
entity scanner derives your confidential names from your private data at hook time and blocks
those too. The data-leak gate fails closed — if the private data directory is absent, the hook
rejects the push rather than silently passing.

Nothing is uploaded to any service. The only data that leaves your machine is git commits to your
private repository and text you send to the Claude interface you already have open.

See `CONSTITUTION.md` principle 2 and ADR 0017.

---

## Does Selfwright call an LLM API automatically?

No. The default generation path produces a prompt file and stops. You open the prompt in your
Claude Code session, let Claude generate the output, paste or save it into the expected file, then
run `selfwright <cmd> --check` to validate the result.

This means no API key is stored in the framework, no autonomous network call is made by default,
and you pay nothing beyond your existing Claude subscription.

The `--adapter cli` flag enables headless generation by shelling `claude --print` as a subprocess.
The `--adapter litellm` flag routes through a LiteLLM proxy. Both are explicit opt-ins and neither
is the default. See ADR 0006 and `INSTRUCTIONS.md` §3.

---

## Is it only for one person?

At v0.6.0, yes. The system is designed for a single owner with a single private data repository.
There is no multi-user model, no shared workspace, and no SaaS hosting.

The architecture does not foreclose a hosted tier: the framework/data boundary (ADR 0017) is
exactly the seam a SaaS product would need. But that decision is explicitly deferred until there
is adoption data to justify it.

---

## What is open vs private?

**Open (this repository):**
- All framework code: the domain core, adapters, CLI, MCP server, web app
- Fitness functions and test suite
- Documentation
- Example data templates (`examples/data-template/`)

**Private (stays in your own private `Selfwright-data` repo):**
- `truth/evidence/registry.yml` — your evidence entries
- `truth/identity.yml` — your identity and roles timeline
- `truth/archetypes/*.md` — your positioning lanes
- `applications/applications.yml` — your application history
- `drifts/` — your drift files
- `pipeline/queue.yml` — discovered roles pending triage
- Compensation data, contact names, all personal specifics

The `data/` directory in the framework repo is gitignored. The data-leak gate (`FF-DATA-LEAK-1`)
prevents anything from crossing that boundary in either direction.

---

## What is the "truth floor"?

The truth floor is the rule that every substantive claim in a generated artifact must trace back
to a verifiable entry in your evidence registry. Evidence entries have unique IDs (`EVD-PM-001`,
`EVD-ENG-012`, etc.). When you write a CV summary or cover letter, every sentence that asserts a
competency, metric, or title must share keyword overlap with at least one EVD-* entry.

The `--check` validator enforces this. An artifact that fails returns the specific sentences and
the checks they failed; it does not produce partial output you might use by mistake.

Why it matters: claims that cannot be grounded in evidence are fabrications. In a job search,
fabrications create consistency problems with repeat audiences and are hard to defend in
interviews. The truth floor makes the constraint enforceable rather than relying on the user to
remember it.

See `CONSTITUTION.md` principle 1.

---

## Can Selfwright auto-submit applications?

No code path in this repository reaches the final submit control on any ATS or career website.
That boundary is enforced by design, not by technical limitation.

Everything before that final action is different: discovery, scoring, generation, and form pre-fill
can all run automatically. The system is built to push that automation as far as it adds value,
with the human reviewing outputs at each step. The submit decision stays with the person applying.

See `CONSTITUTION.md` principle 4 and ADR 0025.

---

## Do I need Docker or Postgres to use it?

No. The CLI, MCP server, web dashboard, and full fitness suite all work without Docker. The
default data store is plain YAML files in your private git repository.

Docker becomes useful when you want:
- The Postgres + pgvector projection (enables `sync-db` and semantic evidence retrieval)
- Local embeddings via Ollama (`--profile embeddings`)
- Episodic memory via mem0 (`--profile memory`)
- Evidence.dev dashboards embedded in the cockpit (`--profile reporting-evidence`)

All Docker services are opt-in and individually profileable. See `docs/MANUAL.md` §2.5.

---

## What license is Selfwright released under?

Apache-2.0. See `LICENSE` and `NOTICE`.

Apache-2.0 includes a patent grant, which protects contributors and downstream users. It does not
restrict commercial use. ADR 0021 documents the license decision and the rationale for choosing
Apache-2.0 over MIT (patent grant) and AGPL (AGPL would foreclose the commercial-option
flexibility the architecture deliberately preserves).

---

## How do I contribute?

Issues are open. Small PRs are welcome. The project requires a Developer Certificate of Origin
(DCO) sign-off on commits (`Signed-off-by: Name <email>`) — no CLA. See `CONTRIBUTING.md` for
the sign-off process and PR scope guidance.

Any PR must pass the full gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm fitness`.
The fitness suite runs in CI and blocks the merge on failure.
