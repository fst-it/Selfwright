# Security and privacy

## No telemetry — what leaves your machine

Selfwright ships with zero telemetry, analytics, crash reporting, or usage tracking. Nothing is
ever sent to the maintainer or any analytics vendor. The framework is local-first: your career
data lives on your own machine, in your own git-backed data directory, and is never transmitted
anywhere by default.

The only outbound network calls the framework code ever makes are to services you explicitly
configure:

- **Job boards** listed in your `scan-targets.yml` receive your search parameters (keywords,
  location, page count) when you run `selfwright scan`. They never receive your identity, CV
  content, or evidence registry.
- **Model gateway** — `ClaudeCliAdapter` (shells `claude --print`) or `LiteLlmAdapter` (a
  LiteLLM proxy you run yourself) — is off by default. Neither is wired unless you pass
  `--adapter cli` or `--adapter litellm` explicitly. `FF-LLM-1` fails the build if any file in
  `apps/` instantiates a concrete LLM adapter without that opt-in marker.
- **ntfy push notifications** — only if you set `SELFWRIGHT_NTFY_URL` — go to your own
  self-hosted or ntfy.sh topic. The payload carries queue counts and application IDs only, never
  job titles, company names, or any claim text.

Three CI fitness checks enforce this automatically and fail the build if violated:

| Check | What it enforces |
|-------|-----------------|
| `FF-DATA-LEAK-1` | No PII, secrets, or private-data patterns in any committed file |
| `FF-EGRESS` | Every outbound fetch/navigate call routes through a named URL-validation guard |
| `FF-LLM-1` | No concrete LLM adapter wired in `apps/` without an explicit opt-in marker |

## Data privacy

This framework repository contains no personal data. Personal and PII data — the truth
layer, applications, confidential contacts, compensation — lives only in the private
`Selfwright-data` repository and in a gitignored local `data/` directory. A data-leak gate
(`FF-DATA-LEAK-1`, pre-commit + CI) blocks any private data or secret from entering this
repo.

## Optional-services network exposure

The optional Docker stack (Postgres, mem0, LiteLLM, Ollama, Evidence.dev, and Metabase) uses
`127.0.0.1` (loopback) bindings by default so no port is reachable from outside the machine.

If you change a service's binding to a LAN address (e.g. `0.0.0.0` in `infra/docker-compose.yml`
to reach the stack from another device), you must also:

- Set service-level authentication where available — in particular, set `MEM0_SERVICE_TOKEN` for
  mem0 (it stores personal career data: evidence, gap history, coaching context).
- Firewall the exposed ports at the OS or router level.
- Do **not** expose Metabase or Evidence.dev to the public internet — they have no
  Selfwright-level session guard; the only protection is that they are not on a public port by
  default.

The `FF-WEB-1` fitness check enforces that the Hono dashboard server (apps/web) binds
`127.0.0.1` and never a wildcard interface. This check does not cover the Docker-managed
optional services — the operator is responsible for those.

## Fork-PR name-scan limitation

The confidential-name PII denylist (the `named-entity-scan.ts` pre-commit/pre-push hook) is
built at hook time from your private `Selfwright-data` directory. It is a local-only control:
GitHub Actions does not expose your private data repo to CI runs triggered from a **forked**
repository.

This means: for pull requests from external contributors, the named-entity scan runs with an
empty denylist in CI — effectively skipped. The real safeguard for the maintainer is the
**local pre-commit and pre-push gates** that run with your private data dir configured on your
own machine. Before merging any external PR, run the gate locally:

```bash
# With SELFWRIGHT_DATA_DIR set to your private data repo:
pnpm fitness            # runs Tier-2 checks including truth-identity
# The named-entity hook fires automatically on the next commit you make locally
```

This is a documented limitation, not an oversight. The architecture (local-first, private data)
makes a cloud-side named-entity check structurally impossible without exposing the private data
to GitHub. The maintainer's own machine is the authoritative gate; forks contributing to the
public framework code do not need access to the private data to contribute safely.

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

Report privately via a [GitHub security advisory](https://github.com/fst-it/Selfwright/security/advisories/new):
click **Security** in the repository header, then **Report a vulnerability**. This creates
an encrypted, private channel between you and the maintainer.

Include:

- a clear description of the vulnerability
- reproduction steps (commands, inputs, environment)
- your assessment of the potential impact

You will receive a response within 7 days. The maintainer will work with you on a fix before
any public disclosure (coordinated disclosure). Credit will be given in the release notes
unless you prefer otherwise.

Please use the GitHub security advisory flow above — it is available to any GitHub account
and keeps the report private until a fix ships.

## Coordinated disclosure

The maintainer's policy is:

1. Acknowledge the report within 7 days.
2. Assess severity and reproduce the issue.
3. Develop and test a fix.
4. Release the fix and publish a security advisory.
5. Credit the reporter (unless they request anonymity).

The maintainer asks reporters to allow at least 90 days for a fix before public disclosure.
For critical vulnerabilities the maintainer will coordinate on an accelerated timeline.

## Secrets

Never commit secrets, API keys, or `.env` files. Provider keys are supplied via environment
variables and the local model gateway only. The `gitleaks` scan in CI and the `FF-DATA-LEAK-1`
fitness check enforce this on every PR. The `.gitleaks.toml` file contains custom rules for
Anthropic and LiteLLM key patterns.

## Supported versions

Only the latest release on `main` receives security fixes. Older releases are not maintained.
