# Contributing to Selfwright

Selfwright is an open-core project. The framework is open-source (Apache-2.0); the private data
layer (truth files, applications, contacts, compensation) is never part of contributions and is
never committed to this repo.

## Setup

See [DEVELOPMENT.md](DEVELOPMENT.md) for prerequisites, installation, and the full command
reference. The quick path is:

```bash
git clone https://github.com/fst-it/Selfwright.git
cd Selfwright
node scripts/setup.mjs --init-template --data-dir /path/to/your-data-repo
pnpm install
pnpm build
```

`DEVELOPMENT.md` covers the optional services (Docker, Tailscale, ntfy) and explains
`SELFWRIGHT_DATA_DIR`, which some fitness checks require.

## Developer Certificate of Origin (DCO)

This project uses the [DCO](https://developercertificate.org/) instead of a CLA.
Sign off every commit with `git commit -s`:

```bash
git commit -s -m "feat(scoring): add gap-weight parameter"
```

This appends a `Signed-off-by:` trailer with your name and email (taken from your
git config) to the commit message, certifying that you wrote the code or have the right
to submit it under the Apache-2.0 license. No separate agreement or signature required.

## Conventional commits

Commit messages must follow the conventional commit format. The commit-msg hook enforces this
at commit time:

```
<type>(<scope>): <subject>

feat(scan): add Lever provider pagination
fix(scoring): correct keyword dedup on null ontology entry
docs(adr): record ADR 0025 for the new memory tier
```

Permitted types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`, `build`, `ci`,
`style`, `revert`.

## PR scope

Small, focused PRs merge faster and review more easily. One task per branch is the convention.
If a change touches an architectural decision, add or update an ADR in `docs/adr/` — the
living-ADR convention is described in `docs/adr/README.md`.

## The fitness gate

All 33 fitness functions must pass (or skip, for the 5 Tier-2 checks that need private data) before a PR merges. CI enforces the 28 Tier-1 checks on every push. The 5 Tier-2 checks run locally before you open a PR.

Run locally before pushing:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm fitness
```

For the Tier-2 checks that require private data (`FF-TRUTH-*`, `FF-VOCAB-1`, named-entity scan),
set `SELFWRIGHT_DATA_DIR` to your local data directory. Those checks skip gracefully if the var
is unset; they do not block unrelated contributions.

The checks cover: truth integrity, data-leak prevention, hexagonal boundary enforcement,
bounded-context discipline, web security invariants, scoring quality, AI-tell hygiene,
determinism, and the API contract. See `docs/fitness-functions.md` for the full catalog.

## Data-leak and machine-identity gates

Two local pre-commit hooks run automatically (installed by `node scripts/setup.mjs`):

- **Named-entity scan** (`tools/src/hooks/named-entity-scan.ts`) — blocks any commit that
  contains a confidential name derived from your private data directory.
- **Machine-identity scan** (`tools/src/hooks/machine-identity.ts`) — blocks Windows
  usernames, machine hostnames, personal email addresses, and absolute local paths.

These gates cannot run in cloud CI (no access to private data), so run them locally before
opening a PR. They fail closed when `SELFWRIGHT_DATA_DIR` is unset.

**Never commit anything under `data/`.** The directory is gitignored. `FF-DATA-LEAK-1` and
`gitleaks` enforce this in CI.

## Private data

The truth layer (identity, evidence, archetypes, drifts, contacts, compensation) lives in a
separate private repository and is never part of a contribution to this repo. The examples
in `examples/data-template/` are the only committed data, and they use synthetic fixtures
(Jordan Doe / FictionalCo — fully invented).

## Tests

Deterministic code gets unit tests written first. LLM-path code gets eval fixtures. The
coverage gate must pass (`pnpm test`). No TODO, FIXME, skipped tests, or placeholder stubs
may be merged — `FF-LAZY-1` catches these automatically.

## Architecture boundaries

`packages/core` may only import `zod` and its own files. Adapters implement ports; the core
never imports an adapter. `FF-PORT-1` and `FF-CONTEXT-1` enforce this at every PR. See
`DESIGN.md` and `docs/adr/` for the architectural rationale.

## Questions

Open a GitHub Discussion for questions about using or extending Selfwright. GitHub Issues are
for bug reports and tracked feature requests.
