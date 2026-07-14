# Selfwright — Operating Manual

Structured for lookup. Read the section you need; skip the rest.

**Contents**

1. [Concepts](#1-concepts)
2. [Setup](#2-setup)
3. [Processes](#3-processes)
4. [Command reference](#4-command-reference)
5. [Troubleshooting](#5-troubleshooting)
6. [Rules and exceptions](#6-rules-and-exceptions)

---

## 1. Concepts

### 1.1 Truth layer

The truth layer is the single authoritative source of facts about you. It lives in your private
`Selfwright-data` git repository under `truth/`. Nothing in any generated output — cover letters,
prep packs, research documents, drill critiques — can assert a fact about you that does not exist
in the truth layer. This is the truth floor (see §6).

The truth layer consists of:
- `truth/identity.yml` — your professional identity, roles timeline, honesty boundaries
- `truth/evidence/registry.yml` — verifiable claims from your work history, each with an EVD-* id
- `truth/archetypes/*.md` — positioning lanes with evidence selection and keyword targets
- `truth/keyword-ontology.yml` — domain keyword taxonomy for scoring and gap analysis
- `truth/gaps.yml` — skill gaps ledger, populated by gap-scan and debrief analysis
- `truth/comp-floors.data.yml` — compensation floors by location (optional)

### 1.2 Evidence registry and EVD-* ids

Every substantive professional claim is an evidence entry with a unique `EVD-` prefixed id.
Entries record the organization, the claim text, a detail narrative, a tag (hard/soft/claim),
optional metric, and keywords.

Validators check every generated artifact: every sentence that touches a number, title, or
system name must share keyword overlap with at least one EVD-* entry. Artifacts that do not pass
this check are rejected at the `--check` step.

### 1.3 Archetypes

An archetype is a positioning lane — a named cluster of roles you are targeting with a specific
evidence selection, keyword set, and CV slant. You can have multiple archetypes (e.g., one for
data platform roles, one for enterprise architect roles) and score any JD against all of them.

Archetypes live in `truth/archetypes/*.md` as markdown files with YAML front matter. The front
matter specifies the archetype id, related titles, `match_keywords`, search configuration (geos,
seniority, comp floor), CV slant (which evidence to foreground, which to suppress, summary
emphasis), and honesty notes.

### 1.4 Drifts and the honesty wall

Drifts are the only sanctioned exception to the truth floor. A drift is a specific, scored,
confidence-banded statement that goes beyond or slightly reframes what the evidence strictly
supports — always with a documented rationale, risk assessment, and honesty note. Drifts are
ledgered in `drifts/companies/<slug>.yml` and applied per-application via `drift_applications`
in the tailoring overlay.

The honesty wall is the system that flags retired phrases (claims from expired or superseded
evidence) in generated text. A phrase in a retired drift's keywords appearing in a generated
artifact produces a truth warning even when the drift as a whole is no longer active.

Drifts are the only path to controlled deviation. "Embellishing" outside the drift system is
a truth-floor violation (§6).

### 1.5 Gates and fitness functions

Fitness functions are executable, version-controlled tests of architectural properties. They run
via `pnpm fitness`. Every check must pass before a PR merges; CI enforces this.

The 32 active checks cover:
- **Truth integrity** — truth-trace, dangling EVD-* ids, honesty-boundary violations, identity
  consistency across applications, R19 summary-fabrication guard
- **Privacy/data-leak** — no personal data in framework code, gitleaks secrets, named-entity scan
- **Egress/security** — SSRF guard (all outbound calls go through a named URL-validation function),
  loopback binding, external-host allowlist, no `raw()` in the web app
- **Architecture** — hexagonal boundary (core has zero provider or framework imports), bounded-context
  discipline (cross-context imports route through the target context's `index.ts`), no circular
  deps, no lazy markers (TODO/FIXME/skipped tests)
- **Web safety** — auth middleware before routes, CSRF token via header on every `/api/*` write
  (the SSR write forms this once also covered were deleted in T5.10's clean cutover), zero
  server-rendered page routes left, no direct core/adapter imports from the React cockpit,
  `Cache-Control: no-store` on authenticated responses, `no-store` on 404/500/logout paths
- **API contract** — the `/api/*` JSON contract (§2.8) has a passing, endpoint-complete test suite
  (`FF-APICONTRACT`)
- **Scoring** — ATS pass-through score on golden tailored-CV fixture (≥0.80), determinism ratio,
  fit non-degeneracy floor
- **Data integrity** — scoring-vocabulary guard (warns when real vocabulary file is missing)
- **AI-tell hygiene** — banned AI-tell phrase scanner; generated artifacts containing known
  LLM-writing markers (e.g. "delve", "tapestry", "not just … but") fail validation

The full catalog is in `docs/fitness-functions.md`.

### 1.6 Open-core boundary

The framework code (this repo) is open-core — safe to share or publish. Your truth layer,
applications, contacts, drift files, and compensation data are private and live only in your
`Selfwright-data` repo. The data-leak gate enforces this boundary at commit time (§6).

### 1.7 Co-piloted generation (no API keys)

Selfwright does not call the Claude API autonomously. The default generation path assembles a
truth-grounded prompt — selecting evidence, injecting archetype framing, incorporating JD context —
and writes it to a prompt file. You generate the output inside the Claude Code session you already
have open. A deterministic validator then checks what you produce before you can use it.

The `--adapter` flag on `cover`, `research`, `drill`, `prep-pack`, and `topics` enables
headless generation via `claude --print` (the CLI adapter), LiteLLM, or Ollama. This is an
opt-in escape hatch, not the default. See ADR 0006.

---

## 2. Setup

### 2.1 Prerequisites

- Node 22+ (pinned in `.nvmrc`)
- pnpm (workspace manager)
- Docker or Podman (optional — for Postgres projection, Metabase, Ollama, mem0)
- Tailscale (optional — for web dashboard remote access)
- ntfy (optional — for push notifications)

### 2.2 Installation

**Automated (recommended):** run the bootstrap script right after clone — it handles
prerequisites, data directory creation, `.env` writing, `pnpm install`, and hook installation
in a single idempotent step:

```bash
git clone https://github.com/your-handle/Selfwright.git
cd Selfwright
node scripts/setup.mjs --init-template --data-dir /path/to/your-data-repo
```

See `node scripts/setup.mjs --help` (or read the flags table in README §Quick start) for all
options.

**Manual fallback:** if you prefer to run the steps individually:

```bash
git clone https://github.com/your-handle/Selfwright.git
cd Selfwright
pnpm install && pnpm build
```

Then set `SELFWRIGHT_DATA_DIR` (see §2.3–§2.4) and run `pnpm exec lefthook install`.

The build, tests, and full fitness suite pass with `SELFWRIGHT_DATA_DIR` unset. No private data
is required to verify the framework.

### 2.3 Data directory anatomy

Set `SELFWRIGHT_DATA_DIR` to the absolute path of your data repo. This is the preferred and
recommended approach.

**Fallback (convenience only):** if `SELFWRIGHT_DATA_DIR` is unset, the CLI, fitness runner,
telemetry writer, and named-entity gate each fall back to looking for a sibling directory named
`Selfwright-data` next to the framework repo. This fallback exists so that a fresh clone works
before you configure the env var. Set `SELFWRIGHT_DATA_DIR` explicitly for any persistent setup —
the fallback is intentionally inconvenient because the data directory name is private and
machine-specific.

**Required files (commands exit with a clear error if these are missing):**

```
<dataDir>/
├── truth/
│   ├── identity.yml                   # professional identity
│   ├── evidence/registry.yml          # EVD-* evidence registry
│   ├── keyword-ontology.yml           # REQUIRED — exits with a named error if absent
│   └── archetypes/                    # at least one *.md file
├── applications/
│   └── applications.yml               # can be an empty list []
└── truth/gaps.yml                     # defaults to [] if missing — not required
```

**Required by scan specifically:** `pipeline/scan-targets.yml`.

**Optional files (commands degrade gracefully if absent):**

```
<dataDir>/
├── truth/comp-floors.data.yml         # comp-floor scoring
├── positioning/scoring-vocabulary.yml # industry-tier classification (FF-VOCAB-1 warns if missing)
├── drifts/companies/<slug>.yml        # one file per company with active drifts
├── coaching/debriefs.yml              # created on first debrief add
├── coaching/drill-history.yml         # created on first drill run
├── content/content-history.yml        # created on first topics run
├── content/digests/                   # generated topic digests
├── pipeline/queue.yml                 # created on first scan
├── pipeline/scan-history.yml          # dedup ledger, created on first scan
├── telemetry/usage.jsonl              # usage telemetry
├── telemetry/fitness-history.jsonl    # fitness run history
└── web/credentials.json              # dashboard password hash (gitignored in data repo)
```

**Note on `truth/keyword-ontology.yml`:** This file is not optional enrichment. The `score`,
`gap-scan`, `inbox --archetype`, and `scan` commands all load it and exit with an error that names
the file and its role if it is missing. Start with the template in `examples/data-template/`.

### 2.4 Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `SELFWRIGHT_DATA_DIR` | Yes, for CLI/MCP | Absolute path to your data repo. Set this explicitly; commands fall back to a sibling `Selfwright-data` directory as a convenience only and warn when that fallback is used. |
| `NTFY_URL` | No | ntfy topic URL for push notifications; IDs-only push when set |
| `SELFWRIGHT_MEMORY_URL` | No | mem0 service URL (T2.8; enables memory_add/memory_search MCP tools) |
| `SELFWRIGHT_MEMORY_TOKEN` | No | mem0 auth token (optional, paired with SELFWRIGHT_MEMORY_URL) |
| `LITELLM_BASE_URL` | No | LiteLLM proxy URL when using `--adapter litellm` |
| `SELFWRIGHT_ADZUNA_APP_ID` | No | Adzuna app id — required only when using `provider: adzuna` targets |
| `SELFWRIGHT_ADZUNA_APP_KEY` | No | Adzuna app key — required only when using `provider: adzuna` targets |
| `SELFWRIGHT_PUBLISH_CHECK_HOOK` | No | Set to `1` to enable the optional LLM advisory pre-push hook (see §3.8). Requires the Claude Code CLI authenticated on a subscription. When unset the hook exits 0 silently. |
| `SELFWRIGHT_PUBLISH_ACK` | No | Set to `1` on a single push command to acknowledge publish-check findings and let the push proceed (`SELFWRIGHT_PUBLISH_ACK=1 git push`). One-shot by nature — set per command invocation only. |

### 2.5 Docker services (optional)

The default `docker compose up -d` starts **postgres only**. All other services are
opt-in via named profiles. The CLI, MCP, and web dashboard work without any optional
service running.

```bash
# Core only (postgres):
docker compose --env-file .env -f infra/docker-compose.yml up -d

# Add one or more profiles:
docker compose --env-file .env -f infra/docker-compose.yml --profile reporting-evidence up -d
docker compose --env-file .env -f infra/docker-compose.yml --profile reporting-metabase up -d
docker compose --env-file .env -f infra/docker-compose.yml --profile embeddings up -d
docker compose --env-file .env -f infra/docker-compose.yml --profile memory up -d
docker compose --env-file .env -f infra/docker-compose.yml --profile llm-gateway up -d
```

Or pass `--with-<profile>` flags to `node scripts/setup.mjs` to start profiles during initial setup.

**Profile reference:**

| Profile | Service | Purpose | Default |
|---|---|---|---|
| *(none)* | postgres | Projection DB (pgvector); required by all optional services | **on** |
| `reporting-evidence` | evidence | Evidence.dev dashboards; static build served on :3001; iframe-embeddable in the cockpit | off |
| `reporting-metabase` | metabase | Metabase BI (AGPL; link-out only — never imported by the framework); :3000 | off |
| `embeddings` | ollama | Local embeddings for pgvector (nomic-embed-text); generation eval-gated per ADR 0008 | off |
| `memory` | ollama + mem0 | mem0 episodic memory via MCP (ADR 0010); ollama is a shared dep of this profile | off |
| `llm-gateway` | litellm | LiteLLM multi-provider proxy (OSS-only / optional per ADR 0006); :4000 | off |

**Cockpit integration:** Evidence dashboards are iframe-embedded in the cockpit when the
`reporting-evidence` profile is running; Metabase is a browser link-out only (AGPL
arm's-length boundary, §8 of the anchor).

### 2.6 Web dashboard setup

The dashboard is a React cockpit (`apps/web-ui`) served as a static bundle by the Hono server
(`apps/web`) at `127.0.0.1:8787`. As of T5.10 there are no server-rendered pages left: `apps/web`
is now `/api/*` JSON + static host + the (still server-rendered) login page only, and every page
— Overview, Inbox, Pipeline, Queue, Coaching, Content, Reporting, Settings — is a client-routed
React page consuming `/api/*`. Login stays server-side deliberately (§2.8's posture applies
before any cockpit code ever loads); everything past login is the SPA.

**Build the cockpit before starting the server** (the server serves `apps/web-ui`'s build output;
it does not build it for you):

```bash
pnpm --filter @selfwright/web-ui build
pnpm --filter @selfwright/web build
```

**First-time setup:**

```bash
# Generate the password hash
pnpm --filter @selfwright/web hash-password
# Follow the prompt; writes to <dataDir>/web/credentials.json (gitignored in data repo)
# Non-interactive alternative: set SELFWRIGHT_WEB_PASSPHRASE=<your-passphrase> before running
# (avoids the shell prompt; passphrase is read from the env var instead)

# Start the dashboard
pnpm --filter @selfwright/web start
```

Visiting `127.0.0.1:8787` while logged out redirects to `/login` (SSR, unchanged); once
authenticated, every other path (`/`, `/pipeline`, `/queue`, etc.) serves the cockpit's
`index.html` and react-router takes over client-side — a browser refresh on any of those paths
still works (the server always serves the same SPA shell for any authenticated, non-`/api/*` GET).

**Local development** (hot-reloading UI against the real API):

```bash
pnpm --filter @selfwright/web start        # the Hono server, in one terminal
pnpm --filter @selfwright/web-ui dev        # vite dev server, in another — proxies /api/* to :8787
```

**Remote access via Tailscale Serve** (required to reach the dashboard from iPhone or outside
home network; see ADR 0016):

```bash
tailscale serve --bg 8787
# Then open https://<device-name>.ts.net in any browser on your tailnet
```

Never use Cloudflare Tunnel or raw port-forwarding — both would expose PII to a third party or
the public internet (see ADR 0016 for the reasoning).

**Scheduled startup (Windows):**

```powershell
# Install the dashboard as a scheduled task
.\apps\web\scripts\install-windows-task.ps1 -DataDir "C:\Users\<you>\Selfwright-data"
```

**End-to-end proof** (local only — never runs in CI, no Chromium there): a Playwright spec drives
a real Chromium browser against the real built server on a hermetic temp git data dir, exercising
login → overview render → a status write → a debrief write → a queue dismiss.

```bash
npx playwright install chromium   # one-time, if not already installed
pnpm --filter @selfwright/web-ui build
pnpm --filter @selfwright/web build
pnpm --filter @selfwright/web-ui e2e
```

### 2.7 Scheduled tasks (Windows)

The platform ships two Windows Scheduled Tasks for the push-first UX:

```powershell
.\tools\scripts\install-scheduled-tasks.ps1 `
  -DataDir "C:\Users\<you>\Selfwright-data" `
  -ArchetypeId "data-platform-architect"
```

Registers `SelfwrightScan` (Sunday 09:00) and `SelfwrightInboxDigest` (daily 08:00). Both log to
`<dataDir>/telemetry/scheduled-scan.log`. The scripts resolve the CLI repo-relative
(`apps/cli/dist/index.js`) — there is no global `selfwright` link — so they only require `node`
on PATH and the framework built (`pnpm build`). `NTFY_URL` set as a user environment variable is
optional (push notifications only). See `docs/scheduled-tasks.md` for full documentation.

### 2.8 Internal `/api/*` JSON contract (T5.9; SSR pages deleted in T5.10)

**This is an internal contract, not a public API.** It feeds the React cockpit (`apps/web-ui`);
it is not versioned or supported for third-party integration, and it can change without notice
between releases. The Hono server (`apps/web`) hosts it, plus the cockpit's static bundle and
SPA fallback, plus the still-server-rendered login page, under the same origin — no separate
service, no CORS. Every server-rendered page route that once lived alongside this contract
(overview, pipeline, coaching, content, reporting, inbox, and the two SSR write-action routes)
was deleted in T5.10's clean cutover — `/api/*` is now the platform's only write surface, and
the only surface any page's data ever comes from.

Every `/api/*` route sits behind the same session-cookie auth the login page uses (unauthenticated
requests get a JSON `401` instead of a redirect to `/login` — the only difference is
content-type-appropriate response shape, not a weaker check) and the same fail-closed `Origin`
check. Every response sets `Cache-Control: no-store` and, on error, a consistent envelope:
`{ "error": { "code": "...", "message": "..." } }` — never a stack trace or a file path.

**CSRF for JSON writes:** the cockpit fetches the session's token once from `GET /api/meta`
(`csrfToken` field) and resends it on every write as an `X-CSRF-Token` header, verified with
`verifyCsrfToken()` (the same function ADR 0019's now-deleted SSR write forms used, unchanged). A
custom header additionally can't be attached by a cross-site `<form>` or a no-CORS cross-origin
`fetch` (this server never sends `Access-Control-Allow-Origin`), so the header requirement is
defense-in-depth on top of, not a replacement for, the existing `SameSite=Strict` cookie and
`Origin` check.

**Endpoints** (all reads are `GET`, all bodies/responses are JSON, request/response shapes are zod
schemas exported from `@selfwright/api-contract`):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/meta` | Contract version, platform version, this session's CSRF token |
| GET | `/api/overview` | North-star, fitness-history sparkline data, inbox summary counts |
| GET | `/api/inbox` | The three-tier decide-now/review-soon/fyi digest with item-level detail (T5.10) |
| GET | `/api/applications` | Full applications list + `applications.yml` content hash |
| POST | `/api/applications/:id/status` | Update an application's status (+ optional note), audited git commit |
| GET | `/api/queue` | Queue entries partitioned by the aging window (active/stale count) |
| POST | `/api/queue/:id/promote` | Turn a queue entry into a new application (status `evaluating`), remove it from the queue — one atomic commit (ADR 0024) |
| POST | `/api/queue/:id/dismiss` | Remove a queue entry the owner has decided not to pursue — no separate ledger (ADR 0024) |
| GET | `/api/coaching` | Debriefs, next-drill suggestion, drill files, prep packs |
| POST | `/api/debriefs` | Capture an interview debrief — same schema/limits as `pnpm selfwright debrief add` |
| GET | `/api/content` | Content digest list + latest digest inline |
| GET | `/api/reporting` | North-star detail, channel outcomes, status breakdown, fitness trend |
| GET | `/api/settings` | The validated `settings.yml` document |
| PUT | `/api/settings` | Full-document replace of `settings.yml`, same audited commit path |
| GET | `/api/scan-targets` | The validated `pipeline/scan-targets.yml` document (or `{targets:[]}` when absent) |
| PUT | `/api/scan-targets` | Full-document replace of `pipeline/scan-targets.yml`, same audited commit path |

Every write endpoint (status update, debrief capture, queue promote/dismiss, settings `PUT`, and
scan-targets `PUT`) commits to the data dir's own git repository per ADR 0019's original pattern —
validate, write, `git commit`, and on a pre-commit hook rejection, revert the file(s) to
their pre-write content and surface the hook's message as a `422`. Promote is the one write that
touches two files (`pipeline/queue.yml` and `applications/applications.yml`); both are staged and
committed together in a single atomic commit (ADR 0024) so they never disagree about whether the
entry was promoted.

Contract tests live in `apps/web/src/__tests__/api-contract.test.ts` and run against a hermetic
temp git data dir (never the real data dir); `FF-APICONTRACT` (`docs/fitness-functions.md`) gates
that this suite exists, covers every documented endpoint, and passes.

---

## 3. Processes

Each subsection describes the full process for a workflow, including which commands and skills to
use, and what the expected output looks like. Each ends with a "When it goes wrong" subsection.

Every command below is run as `pnpm selfwright <cmd>` from the repository root — there is no
global `selfwright` link. `pnpm selfwright` runs the root `selfwright` script
(`node apps/cli/dist/index.js`); you can also call `node apps/cli/dist/index.js <cmd>` directly.

### 3.1 Discover: find and capture roles

**Goal:** maintain a prioritized queue of roles worth applying to.

**Automated scan:**

1. Edit `pipeline/scan-targets.yml` in your data repo to list the companies and ATS providers to
   track. See `config/scan-targets.yml` in the framework for the format. The 19 available
   providers are: `greenhouse`, `lever`, `ashby`, `workday`, `workday-browser` (Playwright, for
   Workday tenants that reject plain HTTP), `smartrecruiters`, `bamboohr`, `oracle`, `recruitee`,
   `personio`, `workable`, `breezy`, `adzuna`, `arbeitnow`, `remotive`, `himalayas`,
   `weworkremotely`, `remoteok`, and `generic` (auto-extracts schema.org JobPosting JSON-LD from
   any career page).
2. Run `pnpm selfwright scan` or wait for the Sunday 09:00 scheduled task. The scanner fetches each
   target, checks liveness, dedupes by company and fuzzy title, scores each posting against your
   archetypes, and appends new entries to `pipeline/queue.yml`.
3. Run `pnpm selfwright inbox` to see new queue entries in the Review-soon tier.

**Manual capture (LinkedIn and other non-ATS sources):**

Use `pnpm selfwright queue-add` or the `/queue-add` skill. Pass the URL (as a dedup key — it is
never fetched), company name, and role title. Optionally pass JD text for scoring.

Skill: `/queue-add`

**Credits:** the original ATS scan providers (greenhouse, lever, ashby, workday, smartrecruiters, bamboohr, generic) and the Arbeitnow aggregator adapter adapt patterns from
[santifer/career-ops](https://github.com/santifer/career-ops) (MIT licensed). The Adzuna
aggregator provider is implemented against the confirmed
[Adzuna developer API](https://developer.adzuna.com/docs/search).

**Queue aging:**

A queue entry goes stale when it has not been seen in a scan for longer than the aging window
(default: 30 days). Stale entries are hidden from default views — the `pnpm selfwright inbox` digest
tiers and the web dashboard queue table — but are never deleted. The inbox digest always prints a
one-line FYI noting how many entries aged out so you know they exist.

An entry is kept fresh automatically: if a scan encounters a URL that is already in `queue.yml`,
it updates the entry's `lastSeenAt` timestamp. A posting that stays live and keeps appearing in
scan results never goes stale. Freshness tracking assumes posting URLs are stable across scans —
a URL change (e.g., on re-post) looks like a new posting.

To configure the aging window, add a `queue` section to `settings.yml` in your data directory
(`<data-dir>/settings.yml`, i.e. alongside `pipeline/queue.yml`):

```yaml
queue:
  aging_window_days: 14   # positive integer; default is 30
```

An invalid value (non-integer, zero, or negative) is ignored with a stderr warning and the default
is used. A missing `settings.yml` is normal and equivalent to the defaults.

#### When it goes wrong — Discover

**Named-entity gate blocks a commit after editing scan-targets.yml.**
The gate derives its blocklist from your data repo at commit time. If a real company name in
`scan-targets.yml` matches an entity in `truth/identity.yml` or `applications/applications.yml`,
the hook will block the commit with a message naming the offending file path (never the matched
name itself).

To resolve: check whether the company name is a dictionary word (e.g., "Shell", "Oracle"). If
it is a common dictionary word, add a per-(term, path) allowlist entry to
`.confidential-allowlist.yml` in your data repo. The term must be a dictionary word — unique
proper names cannot be allowlisted. See `docs/fitness-functions.md` "Named-entity data-leak scan"
for the exact format.

If the name is a unique proper noun, the gate is working correctly: the scan-targets file contains
real confidential data and must stay in your private data repo, not the framework repo.

Never use `--no-verify` to bypass the gate. That flag is permanently disallowed.

**Scan target returns HTTP 403 or 429.**
The target's server blocked the request. The scanner classifies the posting as `"uncertain"`
liveness and logs the response code. Demote the target: either remove it from scan-targets or
change to `provider: generic` and handle it as a manual-capture target via `queue-add` instead.
The scanner does not crash on individual target failures — remaining targets in the run continue.

**Queue entry appears for a role you already applied to.**
The cross-dedup between `queue.yml` and `applications.yml` uses Jaccard similarity (threshold 0.5)
on stopword-filtered company and title tokens. If a match is missed, add the application entry
manually and re-run scan with `--dry-run` to verify the dedup catches it before the next
scheduled run.

---

### 3.2 Assess: score and gap-check

**Goal:** decide which queued roles justify the full apply workflow.

**Score a JD:**

```bash
pnpm selfwright score path/to/jd.md
```

Output: best-matching archetype and 7-dimension breakdown (grade A–F). Grade `F` means no archetype
matched above the non-degeneracy floor — the role is probably off-target, or the JD uses atypical
vocabulary that the ontology does not cover yet.

**ATS check:**

```bash
pnpm selfwright ats path/to/jd.md path/to/cv.json
```

Output: ATS parseability score (pass/fail at 0.80 default threshold), keyword bucket breakdown,
and the terms in the JD that are absent from your CV JSON. Use these to tune the tailoring overlay
before generating a draft.

**Gap check:**

```bash
pnpm selfwright gap-scan <archetype-id>
```

Output: evidence-coverage report for the archetype — which keywords are fully covered by EVD-*
entries, partially covered, or uncovered. Uncovered gaps suggest either a real skill gap or a gap
in your evidence registry (a competency you have but have not documented yet).

Skill: `/score`, `/gap-scan`

#### When it goes wrong — Assess

**Score returns grade F for every archetype.**
First check that `truth/keyword-ontology.yml` is populated and that the archetype's
`match_keywords` are present in the ontology. The scoring engine uses keyword overlap via the
ontology's synonym expansion. A JD in plain text without technical vocabulary will also score
poorly on the keyword dimensions; try adding domain terms from the JD to the ontology or to the
archetype's `match_keywords`.

**ATS score is unexpectedly low.**
Run with `--threshold 0` to see the full breakdown. The ATS check validates both parseability
(structural pass A) and keyword presence (pass B). A low pass-B score usually means the JD
contains keywords not in your ontology or not in your CV JSON. Add missing synonyms to the
ontology and relevant keywords to a tailoring overlay.

---

### 3.3 Prepare: tailor, cover, and research

**Goal:** produce a complete, truth-validated application package.

**Step 1 — Tailor the CV.**

Create an overlay JSON that specifies which evidence to foreground, a summary (fully grounded
in EVD-* ids), and optional drift applications. Run:

```bash
pnpm selfwright tailor path/to/cv.json \
  --overlay path/to/overlay.json \
  --out path/to/cv-tailored.json
```

The tailoring engine validates the overlay summary against the evidence registry. An untraceable
claim in the summary causes a `VALIDATION_ERROR` rather than producing a flawed output.

**Step 2 — Research the company.**

```bash
pnpm selfwright research "Company Name" "Role Title" path/to/jd.md
# → writes research-prompt.md

# Generate the research document from the prompt
# Then validate:
pnpm selfwright research "Company Name" "Role Title" path/to/jd.md --check
```

**Step 3 — Write the cover letter.**

```bash
pnpm selfwright cover path/to/app-dir
# → writes cover-prompt.md

# Generate the letter from the prompt into cover-letter.md
# Then validate:
pnpm selfwright cover path/to/app-dir --check
```

**Drift governance.**
If the role requires a drift, edit the company's drift file in `drifts/companies/<slug>.yml` and
add a `drift_applications` entry to the tailoring overlay. The drift must have a confidence score,
a documented rationale, and an honest note before `tailorService` will apply it. See ADR 0005.

Skill: `/tailor`, `/cover`, `/research`

#### When it goes wrong — Prepare

**`cover --check` fails with truth-trace violations.**
The validator found sentences in the cover letter that do not share keyword overlap with any
EVD-* entry. Read the violation messages: they identify the specific sentence and the check that
failed. Options: revise the sentence to reference only documented evidence, add a new EVD-* entry
if the competency is real and verifiable, or remove the sentence.

To read the validator output: run `pnpm selfwright cover path/to/app-dir --check`. Violations are
printed with `FAILED —` prefix, one per line. `OK —` means the artifact passed all checks.

**Tailor produces `VALIDATION_ERROR: untraceable claim`.**
The overlay summary contains a claim with no EVD-* overlap. Fix: update the summary to reference
only verifiable evidence. The tailoring engine does not produce a partial output — validation
failure is clean.

**Unknown drift id in overlay.**
The overlay references a drift id that does not exist in the drift ledger. The error names the
missing id. Fix: check the drift file in `drifts/companies/<slug>.yml` for the correct id. The
`inject_drifts` field (legacy) is auto-migrated to `drift_applications` with a warning; no data
is lost but the overlay should be updated to the new format.

**Research or cover prompt is stale (evidence changed).**
Delete the old prompt file and re-run the command. The prompt is generated fresh each time from
the current state of the evidence registry and the JD.

---

### 3.4 Submit

**Goal:** send a complete, validated application package.

Selfwright stops at "prepared." You review and submit.

**Pre-submit checklist:**
- ATS score ≥ 0.80 (or understood if lower)
- `cover --check` passes all validators
- `research --check` passes all validators (if research was written)
- Tailoring overlay validated (no VALIDATION_ERROR on tailor)
- Drift confidence scores reviewed and accepted
- Application entry added to `applications/applications.yml` with status `applied` and the
  submission date

Human submits. This rule is absolute (§6).

#### When it goes wrong — Submit

**Posting disappears between queue and submission.**
Update the application entry status to `withdrawn` or `not_interested` and note the reason. The
ATS liveness check classified the posting at scan time; postings can close after that point.

**The web dashboard concurrent-write 409 occurs during status update.**
Two simultaneous writes raced. The dashboard returns HTTP 409 with the message "Content changed
since you loaded the page — reload and try again." Reload the pipeline page and resubmit the
form. The serialized write section ensures the retry succeeds without data loss.

---

### 3.5 Interview loop

**Goal:** enter each interview fully prepared and feed every round back into the coaching system.

**Before the interview:** run `prep-pack` to generate a truth-grounded brief.

```bash
pnpm selfwright prep-pack path/to/app-dir \
  --kind interview \
  --archetype <id>
# → writes prep-pack-prompt.md

# Generate the pack from the prompt into prep-pack.md
pnpm selfwright prep-pack path/to/app-dir --check
```

Skill: `/prep-pack`

**After the interview:** log the debrief immediately.

```bash
pnpm selfwright debrief add \
  --app <application-id> \
  --date YYYY-MM-DD \
  --round "technical-1" \
  --wobbled "topic a;topic b"
```

Skill: `/debrief`

**Between rounds:** run `gap-scan` and `drill`.

```bash
pnpm selfwright gap-scan <archetype-id>
pnpm selfwright drill <archetype-id>
```

The gap-scan report now includes debrief-derived hints — topics you wobbled on are surfaced
alongside evidence-coverage gaps. The drill selector uses freshness decay to avoid repeating
topics from recent sessions.

**Update application status** in `applications.yml` or via the web dashboard as rounds progress.

#### When it goes wrong — Interview loop

**Interview canceled or postponed after prep-pack was generated.**
No action required in the system. The prep-pack file stays in the application directory and is
valid for the rescheduled session. Update the application status to `on_hold` or leave it as
`interview` if the round is only postponed.

**`prep-pack --check` fails.**
The validator checks for required headings, EVD-* id integrity, honesty-wall compliance, and
truth-trace on any candidate-asserting sentences. Read the violation messages and fix the specific
issue in `prep-pack.md`. Common failures: a fabricated claim about the role or company that has
no EVD-* overlap, a missing `Grounding:` line, or a heading that does not match the expected
format. Re-run `--check` after fixing.

**`debrief add` rejects the date format.**
The schema requires `YYYY-MM-DD`. The command validates before writing; nothing is written on
validation failure. Correct the date and re-run.

---

### 3.6 Content

**Goal:** produce a weekly evidence-backed content digest and per-application topic candidates.

**Weekly digest:**

```bash
pnpm selfwright topics <archetype-id>
# → writes topics-prompt.md in <dataDir>/content/

# Generate the digest from the prompt
pnpm selfwright topics <archetype-id> --check path/to/digest.md
```

**Per-application topics** (before writing a cover letter for a new application):

```bash
pnpm selfwright topics --app path/to/app-dir
```

Skill: `/topics`

The content engine adapts the skill-time research pattern from
[mvanhorn/last30days-skill](https://github.com/mvanhorn/last30days-skill) (MIT licensed).

#### When it goes wrong — Content

**`topics --check` fails with a URL validation error.**
Each topic item must have at least one URL. The validator checks for lines matching `- ` with a
URL on the same line or indented continuation lines. Fix: add a source URL to the failing topic
item before the check will pass.

**`topics --check` fails with a Grounding violation.**
The digest must include an anchored `Grounding:` line (at the start of a line, not embedded in a
sentence). Fix: add the line in the correct position in the digest.

**Topics repeat from last week.**
The freshness decay in `selectContentTopics` discourages recently-used topics. If topics still
repeat, check whether `content/content-history.yml` is being written correctly (it should update
after each `topics` run in digest mode). If the file is absent or empty, run was interrupted;
re-run without `--dry-run`.

---

### 3.7 Review: inbox and metrics

**Goal:** maintain daily situational awareness and track progress against the north-star.

**Daily inbox:**

```bash
pnpm selfwright inbox --archetype <id>
```

Three tiers: Decide-now (action required), Review-soon (review this week), FYI (status only).
With `--archetype`: adds coaching signals (next drill topic, gap count) and content staleness to
the digest.

**Weekly metrics:**

```bash
pnpm selfwright metrics
```

Reports the north-star (submissions and interview conversion per 10 applications), channel
outcomes (which source channels converted to interviews), and usage telemetry summary.

**Quarterly architectural-fitness review:**
Run `pnpm fitness` and review `docs/audits/architectural-fitness-review-*.md` for any new gaps.

Skill: `/inbox`

#### When it goes wrong — Review

**`inbox` crashes with a raw stack trace.**
Usually indicates a malformed YAML row in `applications.yml`. Each row is processed with
isolation — a null or malformed row is skipped rather than crashing. If you see a crash, the
most likely cause is a row that is `null` at the top level (an extra `---` or `- ` without
content). Open `applications/applications.yml` and find and remove the malformed row.

**`metrics` shows no north-star data.**
`pnpm selfwright metrics` reads `telemetry/usage.jsonl` for usage data and `applications.yml` for the
north-star. If `usage.jsonl` is absent (the default when no `--adapter` calls have been made),
the north-star section still prints from `applications.yml` directly — check that
`applications.yml` has at least one entry with `status: applied` or later.

---

### 3.8 Publication review: publish-check

**Goal:** catch contextual PII, semantic leaks, and ungrounded claims before any change goes
public — the gap the deterministic gates (regex, named-entity, machine-identity) structurally
cannot close.

**Why this step exists:** a regex can match a phone number pattern or a company name; it cannot
tell that "the talent acquisition lead who reached out Tuesday" is identifiable when the company
name is on the same diff. An LLM can. This is the advisory layer that covers that class.

**Mandatory: run `/publish-check` before opening or updating any PR.**

In the Claude Code session you already have open:

```
/publish-check [<ref-range>]
```

Optional `<ref-range>` argument: any valid `git diff` range (e.g., `origin/main..HEAD`,
`HEAD~3..HEAD`). Defaults to `origin/main...HEAD` (everything on the current branch not yet
on main).

The skill collects the outgoing diff, applies the three-category rubric (contextual-PII,
semantic-leak, ungrounded-claim), and reports findings with file, line, category, and severity.
It ends with exactly one verdict line:
- `PUBLISH-CHECK: CLEAN` — no findings. You may open or update the PR.
- `PUBLISH-CHECK: N FINDINGS` — review the findings, address or document them, then re-run.

**The skill is the authoritative review.** The optional hook (below) automates the same check
headlessly; if you run the skill manually, the hook is redundant for that push.

#### Optional: the advisory pre-push hook

For subscribers who want automated enforcement on every push, enable the pre-push hook:

```bash
# In your shell profile (persists across sessions):
export SELFWRIGHT_PUBLISH_CHECK_HOOK=1
```

With this set, every `git push` runs `claude --print` headlessly over the outgoing diff before
the push lands. The hook self-gates:
- **Opt-in only.** If `SELFWRIGHT_PUBLISH_CHECK_HOOK` is unset, the hook exits 0 silently —
  no effect on push behavior.
- **Fail-open.** If the `claude` CLI is unavailable or errors, the hook prints a warning and
  exits 0. It is never a hard block; the deterministic gates remain the hard wall (ADR 0022 §3).
- **Ack-to-pass.** When the hook reports findings, the push is blocked (exit 1). Re-push with
  `SELFWRIGHT_PUBLISH_ACK=1` to acknowledge and proceed:
  ```bash
  SELFWRIGHT_PUBLISH_ACK=1 git push
  ```
  The ack is one-shot — it must be set on the push command that you want to let through, not
  in the shell profile. Address the findings before merging to main.

The hook runs AFTER the deterministic `named-entity-scan` in the `pre-push` stage; the
deterministic verdict always comes first and is always authoritative.

#### When it goes wrong — publish-check

**Hook reports `could not invoke 'claude --print'`.**
The Claude Code CLI is not available or not authenticated. The hook exits 0 (fail-open). Run the
skill manually via `/publish-check` in the Claude Code session before merging.

**Verdict line is missing from the output.**
The model did not follow the output format contract. The hook treats this as inconclusive and
exits 0 (fail-open). The raw output is printed for manual review. If this recurs, consider
running the skill manually.

**Finding is a false positive.**
The advisory layer errs on the side of flagging; not every finding is a real issue. Review the
finding description, determine whether it describes a real leak or is a false positive, and
document your judgment. If the push is time-sensitive, use `SELFWRIGHT_PUBLISH_ACK=1` to
acknowledge and address it before the PR merges.

---

## 4. Command reference

Commands follow `pnpm selfwright <command> [args] [options]`. All commands exit with non-zero status
on error and write error details to stderr.

### 4.1 CLI commands

**`pnpm selfwright score <jd-path>`**
Score a job description against your archetypes. Returns JSON with the best-matching archetype
id, a 7-dimension score, a letter grade (A–F), and keyword overlap details. Requires `SELFWRIGHT_DATA_DIR`, `truth/keyword-ontology.yml`, at least one archetype, and the evidence registry.

**`pnpm selfwright ats <jd-path> <cv-path>`**
Run ATS pass-through analysis. Returns pass/fail per ATS pass, keyword scores, and missing
keywords from the JD. Options: `--threshold <n>` (0–1, default 0.80), `--out <file>`.

**`pnpm selfwright tailor <cv-content-path>`**
Apply a tailoring overlay to a CV JSON file. Required: `--overlay <path>`, `--out <path>`.
Optional: `--map <evidence-map-path>`. Exits non-zero on any validation failure; no partial output.

**`pnpm selfwright cover <app-dir>`**
Default: writes `cover-prompt.md` to `<app-dir>` for co-piloted generation.
`--check`: validates `<app-dir>/cover-letter.md` (truth-trace, honesty, 350–400 words, no banned opening).
`--adapter <cli|litellm|ollama>`: headless generation, then auto-checks the result.

**`pnpm selfwright research <company> <role-title> <jd-path>`**
Default: writes `research-prompt.md` for co-piloted generation.
`--check`: validates the research artifact.
`--out <path>`: output path (default: `<jd-dir>/company-research.md`).
`--adapter <cli|litellm|ollama>`: headless generation.

**`pnpm selfwright gap-scan <archetype-id>`**
Compute evidence-coverage gaps for an archetype. Returns a markdown report with uncovered,
partial, and covered keywords; debrief-derived hints are included if debriefs exist.
`--check`: validates `gaps.yml` against the evidence registry and honesty rules.
`--out <path>`: write report to file.

**`pnpm selfwright drill <archetype-id>`**
Select the next drill topic and write a co-piloted prompt.
`--check <transcript-path>`: validate a completed drill transcript.
`--out <path>`: output path for the prompt (default: `./drill-prompt.md`).
`--adapter <cli|litellm|ollama>`: headless drill question generation (human must answer before `--check` is meaningful).

**`pnpm selfwright prep-pack <app-dir>`**
Write a co-piloted prep-pack prompt.
`--kind <interview|networking|event>` (default: `interview`).
`--archetype <id>`: add coverage gap analysis.
`--check`: validate `<app-dir>/prep-pack.md`.
`--adapter <cli|litellm|ollama>`: headless generation, then auto-checks.

**`pnpm selfwright topics [archetype-id]`**
Select topic candidates and write a co-piloted prompt.
`--app <dir>`: application mode — reads JD from `<dir>/job-description.md`.
`--check <path>`: validate a completed topics digest.
`--adapter <cli|litellm|ollama>`: headless generation, then auto-checks.
Either `archetype-id` or `--app` is required.

**`pnpm selfwright debrief add`**
Add an interview debrief record. Required: `--app <id>`, `--date <YYYY-MM-DD>`. Optional:
`--round <label>`, `--asked <semi;sep>`, `--wobbled <semi;sep>`, `--went-well <semi;sep>`,
`--notes <text>`. No person names anywhere in this command.

**`pnpm selfwright debrief list`**
List debrief records. `--app <id>`: filter by application id.

**`pnpm selfwright inbox`**
Print the 3-tier signal digest (Decide-now / Review-soon / FYI).
`--format <text|json>` (default: text).
`--archetype <id>`: add coaching signals (gap count, next drill).
`--notify`: push ntfy notification (requires `NTFY_URL`).

**`pnpm selfwright scan`**
Scan configured job sources, dedupe, check liveness, score, and update `pipeline/queue.yml`.
`--targets <path>` (default: `config/scan-targets.yml`).
`--dry-run`: fetch and score without writing queue or history files.
`--verify`: re-verify `"uncertain"` postings with a headless browser (requires `npx playwright install chromium` once; see ADR 0012).
`--notify`: push ntfy notification for new queue entries.

**`pnpm selfwright queue-add`**
Manually add a job posting (LinkedIn-safe: URL is a dedup key only, never fetched).
`--url <url>` (required), `--company <name>` (required), `--role <title>` (required).
`--jd-file <path>` or `--jd-stdin`: provide JD text to score the entry.

**`pnpm selfwright metrics`**
Print north-star metrics and channel outcomes from `applications.yml`.
`--format <text|json>` (default: text).

### 4.2 MCP tools

Available when the MCP server is running (`pnpm mcp` or `pnpm --filter @selfwright/mcp start`).

| Tool | Purpose |
|---|---|
| `score` | Score a JD (text) against archetypes |
| `ats` | ATS analysis on a CV object against a JD |
| `tailor` | Apply a tailoring overlay to a CV object |
| `cover` | Assemble a grounded cover-letter prompt (no LLM) |
| `check_cover` | Validate a cover-letter text |
| `research` | Assemble a grounded research prompt (no LLM) |
| `check_research` | Validate a research artifact text |
| `inbox` | Get the 3-tier signal digest |
| `scan` | Scan job sources and update the queue |
| `queue_add` | Manually add a posting to the queue |
| `gap_scan` | Compute skill-gap coverage for an archetype |
| `check_gap_scan` | Validate gaps.yml |
| `drill` | Select next drill topic and return a prompt |
| `check_drill` | Validate a drill transcript |
| `prep_pack` | Assemble a prep-pack prompt |
| `check_prep_pack` | Validate a prep-pack artifact |
| `topics` | Select topic candidates and return a prompt |
| `check_topics` | Validate a topics digest |
| `add_debrief` | Record an interview debrief |
| `list_debriefs` | List debrief records |
| `memory_add` | Store a memory note via mem0 (requires `SELFWRIGHT_MEMORY_URL`) |
| `memory_search` | Search memories via mem0 (requires `SELFWRIGHT_MEMORY_URL`) |

### 4.3 Skills and slash commands (Claude Code)

Each skill auto-triggers when Claude Code detects a matching task. Slash commands invoke them
explicitly.

| Skill path | Slash command | Trigger |
|---|---|---|
| `.claude/skills/score/` | `/selfwright-score` | Scoring a JD or asking for fit assessment |
| `.claude/skills/ats/` | `/selfwright-ats` | ATS analysis request |
| `.claude/skills/tailor/` | `/selfwright-tailor` | CV tailoring for a role |
| `.claude/skills/cover/` | `/selfwright-cover` | Cover letter request |
| `.claude/skills/research/` | `/selfwright-research` | Company research request |
| `.claude/skills/inbox/` | `/selfwright-inbox` | Pipeline status or inbox check |
| `.claude/skills/scan/` | `/selfwright-scan` | Role discovery or scan request |
| `.claude/skills/gap-scan/` | `/selfwright-gap-scan` | Skill-gap analysis request |
| `.claude/skills/drill/` | `/selfwright-drill` | Interview drill request |
| `.claude/skills/prep-pack/` | `/selfwright-prep-pack` | Interview prep request |
| `.claude/skills/topics/` | `/selfwright-topics` | Content topic request |
| `.claude/skills/debrief/` | `/selfwright-debrief` | Post-interview debrief request |
| `.claude/skills/queue-add/` | `/selfwright-queue-add` | Add a role to the queue |
| `.claude/skills/publish-check/` | `/selfwright-publish-check` | Pre-PR publication-readiness review (mandatory) |

---

## 5. Troubleshooting

### 5.1 `SELFWRIGHT_DATA_DIR` is unset

Commands that need the data dir exit immediately with:

```
Error: SELFWRIGHT_DATA_DIR environment variable is not set
```

The framework builds, tests, and passes all Tier-1 fitness checks without this variable. Only
the CLI/MCP commands that load truth data need it. Set it in your shell profile so it persists
across sessions.

The named-entity gate also fails closed when `SELFWRIGHT_DATA_DIR` is unset — it cannot derive
the confidential-name blocklist. This is intentional: the gate is the precondition that makes
the repo safe to commit to.

### 5.2 Missing `truth/keyword-ontology.yml`

Error message:

```
Error loading ontology: Not found: truth/keyword-ontology.yml — this is the domain-keyword
taxonomy required by score/gap-scan/inbox --archetype/scan. It is not optional enrichment;
see docs/data-storage-and-backup.md for the minimal data-dir file set.
```

This file is not optional. Copy the template from `examples/data-template/truth/keyword-ontology.yml`
and add your real domain vocabulary before running score, gap-scan, or scan.

### 5.3 Gate rejections (PII hook and named-entity scan)

The pre-commit gate (data-leak + named-entity scan) runs locally before every commit. When it
blocks, the message names the offending file path, not the matched name.

**Regex-based gate** (`tools/src/data-leak-gate.ts`): blocks on phone patterns, salary patterns,
email patterns, and paths under `data/`. If a framework file triggers a regex match in error,
check whether the content is synthetic (template/example) or real data. Real data belongs only
in your private data repo.

**Named-entity gate** (`tools/src/hooks/named-entity-scan.ts`): derives its blocklist from
`SELFWRIGHT_DATA_DIR` at hook time. If a word from your truth layer or applications appears in a
framework file, the gate blocks with a note of the file path.

To allowlist a term that is a common dictionary word (e.g., "Shell" appearing in a config
comment): add a per-(term, path) entry to `.confidential-allowlist.yml` in your data repo.
The term field must be a word in the bundled common-words list — unique proper names cannot be
allowlisted (that would defeat the purpose).

Never use `git commit --no-verify` to bypass the gate. It is not an acceptable resolution.

### 5.4 Co-pilot artifact fails `--check`

`pnpm selfwright cover --check`, `pnpm selfwright research --check`, etc. print violations one per line
after `FAILED —`:

```
FAILED — cover-letter.md:
  - sentence "Led a 300-person team" cannot be traced to any EVD-* entry
  - honesty boundary violation: "autonomous trading agent" (retired phrase)
```

Resolution per violation type:
- **Truth-trace failure:** the sentence asserts a fact not in the evidence registry. Revise to
  reference only documented evidence, or add a new EVD-* entry if the competency is real.
- **Honesty-boundary violation:** the text contains a retired or honesty-banned phrase. Remove or
  rephrase; the specific phrase is named in the message.
- **Format failure (cover):** the letter is outside the 350–400 word range, or opens with a
  banned phrase. Adjust and re-check.
- **Missing heading (drill/prep-pack/topics):** a required section heading is absent from the
  artifact. Add it in the correct position.

### 5.5 Concurrent-write 409 on the web dashboard

The dashboard serializes writes. If two browser tabs or two users submit a write simultaneously,
the losing request receives HTTP 409 with:

```
Content changed since you loaded the page — reload and try again.
```

Reload the page and resubmit. The winner's change is committed to the data repo's git history.
The loser's form will show the current state on reload.

### 5.6 Malformed or null YAML row

The CLI and web dashboard isolate row failures: a null or malformed row in `applications.yml`
is skipped rather than crashing the command. The skipped row is not reported in normal output —
if you suspect data loss, open `applications.yml` directly and look for `null` rows (a bare
`-` or `---` without content) or YAML with missing required fields.

`sync-db` (which populates the Postgres projection) also isolates per-row: a malformed row
logs an error to stderr and is skipped; the remaining rows are processed.

For fitness-history rows, the same isolation applies in `fitness-history.jsonl`.

### 5.7 Restore from backup

If your data repo becomes corrupted or you lose the machine:

```bash
git clone https://github.com/your-handle/Selfwright-data.git
export SELFWRIGHT_DATA_DIR="/path/to/Selfwright-data"
pnpm --filter @selfwright/web hash-password   # regenerate credentials.json
pnpm fitness                                  # verify integrity
pnpm selfwright inbox                              # confirm data is accessible
```

The only thing that cannot be recovered from the remote clone is the dashboard password
(`credentials.json` is gitignored). Re-generate it with `hash-password`.

See `docs/data-storage-and-backup.md` for the full playbook.

---

## 6. Rules and exceptions

Some rules in Selfwright are absolute. Others have exactly one sanctioned exception mechanism.
Understanding the difference matters when a process step appears to conflict with a rule: the
rule wins, the process stops, and you use the sanctioned exception or contact the system.

### 6.1 Absolute rules — never dropped, no exception path

| Rule | What it means | What to do when a process step conflicts |
|---|---|---|
| **Truth floor** | No generated artifact can assert a fact not grounded in the evidence registry | Stop. Do not publish the artifact. Add a real EVD-* entry or remove the claim. |
| **Honesty walls** | No retired phrase, fabricated title, or honesty-boundary violation in any output | Stop. Remove the phrase or the claim. The validator names the specific violation. |
| **Data-leak gate** | No personal data (names, company names below dictionary threshold, salaries, phone, email) in any framework file | Stop. Move the content to your private data repo. Do not bypass with `--no-verify`. |
| **Human submits** | Selfwright never auto-submits an application, auto-publishes content, or calls the LLM API unattended | Stop. Review the generated artifact and submit manually. There is no override path. |

### 6.2 Sanctioned exception mechanisms

| What you want to do | The only sanctioned path |
|---|---|
| Slightly reframe a claim beyond strict evidence | Create a drift entry in `drifts/companies/<slug>.yml` with a confidence score, rationale, honesty note, and risk assessment. Apply it via `drift_applications` in the tailoring overlay. Drifts are ledgered, scored, and reviewed — not a free-form override. |
| Allow a dictionary word that triggers the named-entity gate | Add a per-(term, path) entry to `.confidential-allowlist.yml` in your data repo. The term must be in the common-words list. Unique proper names can never be allowlisted. |
| Override an architectural decision | Open an ADR, document the rationale, and — if the change supersedes a prior ADR — update the status of the superseded ADR. No silent divergence from locked decisions (D1–D31). |

### 6.3 When a process step and a rule conflict

The rule wins. The process stops.

Specifically:
- If a `cover --check` fails because a sentence is not grounded: do not publish the letter.
  Fix the sentence or remove it.
- If the named-entity gate blocks a commit: do not use `--no-verify`. Fix the content or add it
  to the allowlist (dictionary words only) or move it to the private data repo.
- If a drift confidence score is `high-risk` and you do not have `allow_high_risk: true` in the
  overlay: the tailoring service rejects the overlay. Review the drift, lower the claim, or
  explicitly opt in to high-risk with a documented reason.
- If a scheduled task would auto-submit an application: that task is out of scope and must not
  be built. The platform prepares; the human submits.

There is no override flag, no `--force`, and no `--skip-truth-check` anywhere in the system.
The fitness functions enforce these properties in CI — they are not advisory.

### 6.4 Publish-check is advisory; deterministic gates are absolute

The `/publish-check` skill and the `publish-check-advisory` hook (§3.8, ADR 0022) are an LLM
advisory layer above the deterministic gates. They cover the gap the deterministic gates
structurally cannot close — contextual PII, semantic leaks, and ungrounded claims.

This layer is **advisory**, not a hard block:
- The skill's findings require human judgment, not automatic rejection.
- The hook is opt-in and fail-open (exits 0 if the CLI is unavailable).
- `SELFWRIGHT_PUBLISH_ACK=1` lets a push proceed after findings are acknowledged.

The **deterministic gates** (data-leak regex, named-entity scan, machine-identity scan) are
**absolute** — they run unconditionally, fail closed, and cannot be bypassed via an ack env var.
A clean advisory verdict does not mean the deterministic gates passed; run `pnpm fitness` and
check `gh pr checks` for the authoritative result.

### 6.5 Web-UI module boundary (FF-WEB-UI-1)

`apps/web-ui/src` must never import `packages/core` or `packages/adapters` — the cockpit is a
read-display layer that consumes `/api/*` over HTTP. Allowed imports from the framework are:
- `@selfwright/api-contract` (Zod schemas for request/response shapes)
- `@selfwright/shared-config/schemas` (sub-path export — schema types only, no fs/git loaders)

`FF-WEB-UI-1` (`fitness/src/checks/web-ui-boundary.ts`) runs depcruise over `apps/web-ui/src` on
every CI pass and fails if any import resolves to a core or adapter package. The rule in
`.dependency-cruiser.cjs` (`FF-WEB-UI-1-no-core-adapter-imports`) is the enforcement point; the
belt-and-braces regex clause (j) in `FF-WEB-1` (`fitness/src/checks/web-safety.ts`) catches the
same violation at the source-text level.

### 6.6 Settings boundary — what settings.yml can and cannot configure

`data/settings.yml` (and the `PUT /api/scan-targets` write path) controls **operational
preferences only** — UI display, notification routing, schedule timing, and tiering thresholds.
The following are **absolute and not configurable** via any settings field, environment variable
knob, or API call:

| Not configurable | Why |
|---|---|
| Truth floor (EVD-* traceability) | Generated artifacts must cite grounded evidence — no setting weakens this gate |
| Honesty walls (retired phrases, boundary violations) | A settings flag silencing the honesty validator would undermine the whole system |
| Data-leak gate (PII, confidential names) | Leaking data is an irrecoverable event — no opt-out, no threshold |
| Fitness-function thresholds (FF-* checks) | CI gates are absolute; they cannot be relaxed by owner config |
| Machine-identity patterns | Cannot be allowlisted or suppressed via settings |

If you find yourself wanting to lower a fitness threshold via settings.yml, open an ADR instead
and change the threshold in the fitness check source with an explicit rationale.

**Scan schedule caveat**: changes to `scan.schedule.day` or `scan.schedule.hour` in `settings.yml`
take effect only after you reinstall the Windows Scheduled Tasks by re-running
`tools/scripts/install-scheduled-tasks.ps1`. Saving the field in the Settings UI updates the
file on disk but does not reschedule the existing task.
