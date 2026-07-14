# Changelog

All notable changes to this project are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows SemVer per [ADR 0018](docs/adr/0018-versioning-release-discipline.md).

---

## [0.6.0] — 2026-07-13

Phase 5 (T5.1–T5.13): publication-hygiene gates, publish-check layer, scanner fixes, queue aging, bounded-context enforcement, docs truth pass, the /api/* contract, the React cockpit cutover, the settings UI, optional-service compose profiles, and living-ADR maintenance.

### Added
- **React cockpit** (T5.10): `apps/web-ui` — Vite + React 18 + TypeScript strict + Tailwind +
  hand-authored shadcn/ui-style components, dark-first brand tokens sampled from `docs/brand`.
  Eight client-routed pages (Overview, Inbox, Pipeline, Queue, Coaching, Content, Reporting,
  Settings), every one consuming only `/api/*` (zero direct `@selfwright/core` or
  `@selfwright/adapter-storage-git` imports — enforced by FF-WEB-1 clause (j)). `GET /api/inbox`
  (new, read-only) closes a parity gap: the deleted SSR `/inbox` page's item-level three-tier
  digest, which `GET /api/overview`'s counts-only shape never covered.
- **Queue-triage promote/dismiss write actions** (T5.10, ADR 0024): `POST /api/queue/:id/promote`
  turns a triaged queue entry into a new `ApplicationRecord` (status `evaluating`) and removes it
  from `queue.yml`, both in one atomic git commit; `POST /api/queue/:id/dismiss` removes a queue
  entry the owner has decided not to pursue (no separate dismissal ledger — `scan-history.yml`
  already prevents resurfacing). Same session/CSRF/origin/throttle/audited-commit posture as
  every other write route. `commitDataDirFile` (`@selfwright/adapter-storage-git`) now accepts a
  path array for atomic multi-file commits.
- **Local-only Playwright E2E spec** (T5.10, `apps/web-ui/e2e/cockpit.e2e.ts`): drives a real
  Chromium browser against the real built server on a hermetic temp git data dir — login →
  overview render → a status write → a debrief write → a queue dismiss. Never runs in CI (no
  Chromium there); gated with an explicit skip-reason line if Chromium isn't installed locally.
- **Settings UI + owner-configurable settings** (T5.11): the cockpit's Settings page is now
  wired — live fields across card sections, all backed by `data/settings.yml` via
  `GET`/`PUT /api/settings`. Fields with a UI card: notification prefs (`ntfy_topic`,
  `quiet_hours`, `enabled_digests` inbox/scan checkboxes); inbox staleness thresholds
  (`interview_stale_days`, `applied_review_days`, `applied_decide_days`); queue aging window +
  fit-score cutoff; scan schedule day/hour + verify toggle + reinstall caveat; default coaching
  archetype; dashboard prefs (`theme`, `landing_page`, `table_density`); debrief-nudge and
  drill-cadence windows. Aggregator filter defaults (`scan.aggregator_defaults.title_filter`,
  `scan.aggregator_defaults.location_filter`) are schema-validated and consumed by the CLI scan
  command but have no Settings UI card — they are set via direct `settings.yml` editing only.
  Each consumer updated: `packages/core/src/services/inbox.ts` receives all
  threshold/window/cadence values as options; `apps/cli` inbox command passes them from loaded
  settings (archetype default) and computes `lastDrillAt` from drill history for cadence
  suppression; `apps/cli` scan command merges aggregator defaults onto per-target overrides and
  respects the `scan.verify` toggle; `tools/scripts/install-scheduled-tasks.ps1` reads
  `schedule.day`/`schedule.hour` from `settings.yml` to set the Windows task trigger.
  `App.tsx` reads `dashboard.theme` (stamps `data-theme` on `<html>`) and `dashboard.landing_page`
  on mount. `packages/shared-notify` gains `quietHours` and `urlOverride` config options; the
  `isQuietHour` function handles both same-day and overnight wrap-around windows.
  **Scan-target management**: new `GET`/`PUT /api/scan-targets` routes edit
  `pipeline/scan-targets.yml` via the same audited git-commit write path (ADR 0019). `ScanTarget`
  schema gains a `disabled` boolean; the scanner skips disabled targets with a stderr note. The
  Settings page renders the target list as a table with per-row disable toggles and a "Save
  targets" action, gated by the same CSRF/origin/throttle machinery as all other writes.
  `packages/api-contract` exports `ScanTargetsContractSchema`, `ScanTargetsUpdateRequestSchema`,
  and `ScanTargetsUpdateResponseSchema` from a browser-safe subpath.
  **Belt-and-braces boundary rule FF-WEB-UI-1**: new depcruise rule
  `FF-WEB-UI-1-no-core-adapter-imports` in `.dependency-cruiser.cjs` forbids any import from
  `apps/web-ui/src` into `packages/core` or `packages/adapters`; enforced by new fitness check
  `fitness/src/checks/web-ui-boundary.ts` (31st check). Complements the regex clause (j) in
  FF-WEB-1. `SettingsSchema` uses `.strict()` on every nested object — unknown keys are rejected,
  and truth-floor/fitness thresholds are not configurable by design. Promote fail-closed revert
  hardened: `rm(force:true)` replaces the previous write-`[]` path when `applications.yml` did
  not exist before the promote attempt. New contract tests: `GET /brand-icon.png` is publicly
  accessible without a session and carries cache headers; unknown application status renders the
  default badge without crashing. 32 fitness checks, 0 failing (verified 32/0 with the data dir
  set; the 5 Tier-2 checks skip only when no data dir is configured, e.g. cloud CI).
- **Workday browser listing provider** (T5.4, ADR 0012): `workday-browser` provider in
  `packages/adapters/scan-browser` handles bot-gated Workday tenants that return CXS 422 to
  the plain-HTTP provider. Headless Chromium navigates to the tenant's public listing page; tries
  an in-page CXS fetch first (`page.evaluate(jsScript)` — runs inside the browser with the
  page's own cookies, bypassing bot detection); falls back to DOM extraction via Workday's stable
  `data-automation-id` attributes (`jobItem`, `jobDetailsLink`, `jobLocations`,
  `paginationNextButton`). Paginates up to `MAX_PAGES=20` with `POLITENESS_DELAY_MS=2000` between
  interactions. SSRF: `assertPubliclyRoutableUrl` + `assertDnsResolvesPublicly` before browser
  launch; posting URLs must be same-origin with the tenant site or match `*.myworkdayjobs.com`
  (leading-dot suffix pattern). Never-silent: 0 postings warn on stderr; truncation warns on
  stderr; nav errors warn on stderr and isolate the target. Lazy browser lifecycle: launched on
  first `fetch()`, reused across targets, closed in CLI's `finally`. 27 unit tests with injectable
  fake pages (no real browser in unit tests). Four previously bot-gated tenants activated in the
  private data repo as `workday-browser` entries.
- **9 new scan providers**: `oracle` (Oracle Fusion/HCM), `recruitee`, `personio`, `workable`,
  `remotive`, `himalayas`, `breezy`, `weworkremotely`, and `remoteok` — role discovery now spans
  19 providers total (18 HTTP + the workday-browser Playwright provider). The `generic` provider
  gains schema.org JobPosting (JSON-LD) auto-extraction from arbitrary career pages. Every new
  provider is SSRF-host-locked and live-verified before merge.
- **Queue aging** (T5.5): stale queue entries leave default views after a configurable window
  (default 30 days); entries are never deleted. A queue entry is stale when its most-recent
  activity timestamp (`lastSeenAt` if present, otherwise `queuedAt`) is older than the window.
  `runScan` now refreshes `lastSeenAt` on any already-queued URL that re-appears in a scan pass,
  so live postings that keep appearing in results stay fresh indefinitely. Both `QueueEntry` fields
  (`queuedAt`, `lastSeenAt`) are optional in the schema — existing `queue.yml` files without them
  load unchanged and are treated as active (backward-compat rule).
  View exclusion: `inbox` service (3-tier digest) skips stale entries and adds a one-line FYI
  with the count (never-silent principle); `pipeline` web route shows only active entries in the
  queue table and notes the stale count in the heading.
  Config: optional `config/settings.yml` with `queue.aging_window_days` (positive integer);
  parsed by `loadSettings` in `@selfwright/shared-config` with Zod validation, warn-and-default
  on invalid values. `SettingsSchema` is the foundation for T5.11's full settings.yml support.
  New exports from `@selfwright/core`: `isStaleEntry`, `partitionQueueByAge`,
  `DEFAULT_AGING_WINDOW_DAYS`, `QueueAgePartition`.
  47 tests across scanning, services, shared-config, and web packages.
- **Typed `/api/*` JSON contract for the cockpit** (T5.9): the existing Hono server (`apps/web`)
  gains a typed JSON contract alongside its SSR pages — every read the T5.10 React cockpit needs
  (overview, applications, queue, coaching, content, reporting, settings) plus the two existing
  v1.1 writes (status update, debrief capture) and a new settings write, all served under
  `/api/*` on the same origin. New package `@selfwright/api-contract` holds the zod request/response
  schemas (shared by the server and, from T5.10, the cockpit) and inferred TS types. Security
  posture is unchanged from ADR 0016/0019: same session-cookie auth, same fail-closed `Origin`
  check, same per-session write throttle, same audited git-commit write path
  (validate → write → commit → fail-closed revert on hook rejection); JSON writes carry their CSRF
  token as an `X-CSRF-Token` header (fetched once from `GET /api/meta`) instead of a hidden form
  field, verified with the same `verifyCsrfToken()`. New `settings-store.ts` in
  `@selfwright/adapter-storage-git` gives `GET`/`PUT /api/settings` the same audited read/write/
  commit path as applications and debriefs, validated against `@selfwright/shared-config`'s
  `SettingsSchema` (additive — ready for T5.11's extensions). The SSR pages are untouched and keep
  working unchanged; the two write routes now share a single write-serialization queue
  (`apps/web/src/write-lock.ts`, extracted from `routes/actions.ts`) with the new JSON writes, so
  the two surfaces cannot race each other's git commits. New fitness check `FF-APICONTRACT` gates
  the contract's own test suite (existence, per-endpoint coverage, and a passing run); `FF-WEB-1`
  is extended (not weakened) for the JSON write surface — see `docs/fitness-functions.md`. 28
  fitness checks, 0 violations. Internal contract, not a public API (docs/MANUAL.md §2.8).
- **Bounded-context architecture enforcement** (T5.6, FF-CONTEXT-1): all 10 context directories
  under `packages/core/src/` now have explicit `index.ts` public APIs; cross-context imports that
  previously targeted deep internal files are routed through these indexes. A new depcruiser rule
  (`FF-CONTEXT-1-index-only-cross-context`) and fitness check (`fitness/src/checks/context-boundaries.ts`)
  enforce the discipline in CI. `QueueEntry` moved from `services/types.ts` to its logical home in
  `scanning/types.ts` (re-exported from `services/types.ts` for backward compat). New domain docs:
  `docs/domain/context-map.md` (context inventory and dependency map) and
  `docs/domain/glossary.md` (ubiquitous language). 27 fitness checks, 0 violations.
- **T5.6 hardening** (adversarial review round): FF-CONTEXT-1 and FF-PORT-1 now fail-closed on
  unrelated depcruise crashes instead of silently passing (nonzero exit + zero matching lines →
  `passed:false` with exit code and first 5 lines). FF-CONTEXT-1 gains a second static assertion
  scanning `ports/*.ts` for re-export-from-context statements (laundering path closed). FF-TRUTH-2
  and FF-TRUTH-4 now report `skipped` (not `passed`) when `SELFWRIGHT_DATA_DIR` is absent,
  matching the honest tier-2 pattern. Stale `QueueEntry` test imports fixed to canonical
  `../types.js`. Docs corrected: `shared/` is target-only in FF-CONTEXT-1; test-file exclusion
  documented; `ports/` trust-boundary rule added to `context-map.md`.
- **Compose profiles for optional services** (T5.12, closes D18 infra side): `docker compose up -d`
  with no flags now starts **postgres only**. Each optional service is opt-in via a named profile:
  `reporting-evidence` (Evidence.dev dashboards, :3001), `reporting-metabase` (Metabase BI, :3000,
  AGPL arm's-length), `embeddings` (Ollama, :11434), `memory` (mem0 + Ollama, :8050), and
  `llm-gateway` (LiteLLM proxy, :4000, per ADR 0006). Ollama is included in both `embeddings` and
  `memory` profiles so each is independently startable. All volume names are preserved (no data
  migration needed). `scripts/setup.mjs` gains five `--with-<profile>` flags that start the
  requested profiles when Docker is available. MANUAL §2.5 rewritten with a profiles reference
  table. The D18 outcome (no single winner; both tools as optional profiles) is recorded in
  T5.13's ADR maintenance pass.
- **Docs truth pass** (T5.8): removed served-HTTP-API overclaims from docs. README.md, the
  founding stack table, and two internal runbook rows no longer imply a running HTTP API before
  T5.9. Stack table corrected from `NestJS or Fastify/Hono` to `Hono (HTTP /api/* deferred to
  T5.9)`; the Fastify stack row in the Phase 1 table carries an editorial note pointing to §9B.
  `docs/adr/README.md` records the living-ADR convention decided 2026-07-12 (rewrite in place,
  git history is the changelog; new file for a new mechanism, rewrite for a changed decision).
- **FF-ATS + FF-AISOUND fitness checks** (T5.7): two new Tier-1 checks bring the suite to 28
  checks / 0 failing. FF-ATS asserts the ATS scorer scores a synthetic golden tailored CV
  (Alex Doe / NovaCorp Technologies) ≥ 0.80 overall; catches Pass A/B regressions in CI
  without private data. FF-AISOUND asserts that the deterministic banned AI-tell phrase scanner
  (`BANNED_AI_TELLS`, 22 entries derived from the human-voice style gate) rejects a seeded
  artifact and passes a clean one; the scanner is wired into all six generation-guard validators.
- **Human-in-the-loop constitution refinement** (ADR 0025, 2026-07-13): CONSTITUTION.md
  principle 4 reframed from "Selfwright prepares and stops" to "Human-in-the-loop; the human
  submits." The enforced boundary is the final submit action only. Pre-submit automation — form
  prefill, generation, triage, research — is explicitly in scope and encouraged. ADR 0025 records
  the owner ruling and the rationale for the narrower boundary.
- **BACKLOG.md**: living owner-curated enhancement proposals with priority themes (A–F),
  impact/effort scoring across 30+ items, and a community proposal template.
- **ADR maintenance** (T5.13, living-ADR convention): ADR 0016 rewritten in place to describe
  the current React cockpit architecture (Vite + React 18 + Tailwind + shadcn-style components,
  /api/* contract, clean SSR cutover) and explain the pivot from the original Hono JSX SSR
  stack. ADR 0015 updated with the D18 closure amendment (owner decision 2026-07-13: no single
  winner needed; both tools become optional profiles). ADR 0021 updated with locked Phase 5
  decisions: public repo at `fst-it/Selfwright` (personal profile), Apache-2.0 + NOTICE,
  community posture (DCO, no CLA, issues open, small PRs welcome). ADR 0019 amended to note
  that the SSR write forms migrated to the /api/* JSON surface in T5.10. Stale-context sweep
  across docs/: ANCHOR D18 row updated; `docs/design/reporting-evaluation-d18.md` closure
  recorded; 30/0 fitness gate confirmed at the time of the ADR pass (31/0 after T5.11's
  FF-WEB-UI-1 landed).

### Changed
- **`apps/web` SSR cutover** (T5.10): every server-rendered page route (`/`, `/inbox`,
  `/pipeline`, `/coaching`, `/content`, `/reporting`) and both SSR write-action routes
  (`POST /applications/:id/status`, `POST /debriefs`) are deleted, along with their JSX
  (`layout.tsx`, `routes/*.tsx`, `routes/actions.ts`). `apps/web` survives as `/api/*` JSON +
  a static host for the cockpit's built bundle (with SPA fallback for client-side routing) + the
  still-server-rendered login page (posture unchanged, deliberately out of scope for this
  cutover). 0 SSR page routes remain — enforced going forward by FF-WEB-1 clause (i).
- **Login page `Referrer-Policy` fix** (T5.10): the login page's `Referrer-Policy: no-referrer`
  header caused real browsers (found via the new Playwright E2E spec — the first time this
  codebase ever drove the login form with an actual browser instead of a test harness setting an
  arbitrary Origin header) to send `Origin: null` on the login form's own POST, which the
  fail-closed `checkOrigin()` check correctly rejected as a mismatch (403) — meaning login likely
  never worked in a real browser before this fix. Changed to `Referrer-Policy: same-origin`,
  which still suppresses the Referer header on any cross-origin navigation while leaving Origin
  intact for the same-origin form POST this page always submits to itself.
- **`packages/shared-config` reorganization** (T5.10): split its single-file barrel into pure
  schema modules (`models.ts`/`scan-targets.ts`/`settings.ts`, zero I/O) and `node:fs`-based
  loader modules (`*-loader.ts`), plus a new `"./schemas"` subpath export — needed because the
  cockpit's browser bundle imports `SettingsSchema` (via `@selfwright/api-contract`) and the
  original single-barrel layout pulled `node:fs` into that bundle, breaking the Vite/Rollup build
  against real source. Every existing export is unchanged; this is a pure reorganization.
- **Test accounting** (T5.10): deleted `apps/web/src/__tests__/pages.test.ts` (SSR page
  rendering/escaping assertions) and `apps/web/src/__tests__/actions.test.ts` (SSR
  write-form validation/CSRF/throttle/hook-rejection assertions, superseded 1:1 by the
  pre-existing `/api/*` contract tests for the same write paths). UI rendering/escaping/
  interaction behavior moved to `apps/web-ui`'s 35 new component tests (React auto-escapes;
  no `dangerouslySetInnerHTML` anywhere in the cockpit). Data-shape assertions were already
  redundant with `api-contract.test.ts`. Total test count across the platform increased, not dropped.

### Fixed
- **Adzuna provider silent-failure fix** (T5.3): five correctness fixes in this section; the
  SSRF posting-domain allowlist is in Security below.
  (1) Country-scoped URL: added `country` field to `ScanTarget`/`ScanTargetSchema`
  (2-letter code, e.g. `nl`, `ch`); `resolveBaseUrl` builds
  `https://api.adzuna.com/v1/api/jobs/<country>/search`. Invalid code → clear
  stderr warn + skip; default `gb` index used with a `locationFilter` → stderr
  note naming the silent-failure trap.
  (2) Split query strategy: single-word `titleFilter` terms are batched into one
  `what_or` query (OR semantics); multi-word terms each get a separate `what_phrase`
  query (phrase match). Avoids the AND-semantics trap of combining `what_or` +
  `what_phrase` in one request (tested live: combined → 215 vs separate → 5496 + 1220).
  Verified live 2026-07-12: `what_or=architect+director` on NL → 5496; `what_phrase=head+of` → 1220.
  (3) Never-silent rule: a target with valid keys that returns 0 postings emits a
  one-line stderr warn naming company, country, query params, and `where`.
  (4) Truncation warn: when the MAX_PAGES cap is hit with a full last page and
  `count` (from the API response) exceeds the number fetched, a stderr warn names
  company, fetched/available counts, and query params (e.g. "fetched 500 of 2373
  available"). Prevents silent data loss on high-volume indices like CH.
  (5) Case-insensitive dedup: `redirect_url` is lowercased before the seen-set check,
  preventing duplicates from mixed-case URL variants across pages or queries.
  Shared `resolveCountry()` helper eliminates regex duplication between `detect()` and `fetch()`.
  47 tests in the adzuna suite; all pass.
- **T5.11 adversarial review — three dead knobs wired** (T5.11 post-review; the SSRF guard is
  in Security below):
  - `enabled_digests` suppression: `notify()` now checks `opts.digestKind` against
    `config.enabledDigests` and suppresses silently when the kind is not listed. The CLI `inbox`
    and `scan` commands pass `digestKind: "inbox"` / `digestKind: "scan"` and spread
    `settings.enabledDigests` into every notify config. SettingsPage exposes inbox/scan
    checkboxes in the Notifications card.
  - `table_density` wiring: `useTableDensity()` hook reads `/api/settings` and returns the
    density value (default `"comfortable"`). `QueuePage` and `PipelinePage` wrap their table
    Card in `<div data-density={density}>`. CSS rule `[data-density="compact"] td` reduces
    row padding. Existing tests are unaffected (hook returns `"comfortable"` when the settings
    endpoint returns 404).
  - `docs/MANUAL.md §6.6` added with the settings boundary table (truth floor, honesty walls,
    data-leak gate, fitness thresholds, machine-identity patterns are not configurable). JSDoc
    in `settings.ts` updated from §6.5 to §6.6.

### Security
- **Machine-identity data-leak gate** (T5.1, ADR 0017 Amendment 2026-07-12): a second,
  independent local scanner alongside the existing named-entity confidential-name scan,
  covering a different leak class — the owner's Windows username, machine hostname, personal
  email (`git config user.email` and, if present, `truth/identity.yml`'s `contact.email`), and
  any `C:\Users\<name>`-style local absolute path (any drive letter/slash direction; the legal
  angle-bracket placeholder form `C:\Users\<you>` stays exempt). New module
  `tools/src/hooks/machine-identity.ts` (pure, injectable `buildMachineIdentityPatterns`/
  `getIdentifierEmbeddedTokens`/`findMachineIdentityViolations` + IO wrapper
  `deriveMachineIdentity`); shared identifier-tokenization logic extracted to
  `tools/src/hooks/identifier-tokens.ts` so `named-entity-scan.ts` and `machine-identity.ts`
  reuse it without a circular import. Wired into all three hook surfaces: `pre-commit` +
  `pre-push` (`named-entity-scan.ts`) and `commit-msg` (`check-text-for-pii.ts`). Never
  allowlistable via `.confidential-allowlist.yml` — an absolute rule, not a contextual
  exception. Whole-tree audit at landing time found five tracked files using a bare,
  non-bracketed placeholder segment after `Users\` (`CHANGELOG.md` + four `.ps1` `.EXAMPLE`
  blocks) — indistinguishable in form from a real path; fixed to the bracketed
  `C:\Users\<you>\...` form throughout.
- **LLM publication-review advisory layer** (T5.2, ADR 0022): a `/publish-check` skill plus an
  optional pre-push hook that catch what deterministic regex gates structurally cannot —
  contextual PII (a person identifiable from combined context), semantic leaks (confidential
  situation or private-data-structure detail in framework files), and ungrounded claims (specific
  personal-achievement facts without EVD-* anchors). Skill at
  `.claude/skills/publish-check/SKILL.md`; slash command alias
  `.claude/commands/selfwright-publish-check.md`. Hook script
  `tools/src/hooks/publish-check-advisory.ts`: opt-in (`SELFWRIGHT_PUBLISH_CHECK_HOOK=1`),
  fail-open (exits 0 if `claude` CLI unavailable — deterministic gates are the hard wall),
  ack-to-pass (`SELFWRIGHT_PUBLISH_ACK=1` to acknowledge findings and proceed). Strict
  verdict-line contract (`PUBLISH-CHECK: CLEAN` / `PUBLISH-CHECK: N FINDINGS`) for
  deterministic parsing. Wired into `lefthook.yml` pre-push AFTER `named-entity-scan`.
  Running `/publish-check` before opening or updating any PR is a mandatory process rule (not a
  technical gate). Unit tests cover verdict parsing, opt-in gate, and ack gate. ADR 0022
  documents the advisory/fail-open rationale.
- **Adzuna posting-domain SSRF allowlist** (T5.3): `isAllowedPostingUrl` now checks against a
  static `Set` of the 19 actual Adzuna-operated country domains (verified 2026-07-12 by sampling
  `redirect_url` from every live country endpoint), replacing a regex that accepted any 2-letter
  TLD (e.g. `adzuna.ai`, `adzuna.co`, `adzuna.me`).
- **Scan-target input SSRF guard** (T5.11): `packages/adapters/scan-http` gains `url-guard.ts`
  (mirrors `scan-browser/url-guard.ts`). `generic.ts` now calls `assertPubliclyRoutableUrl`
  + `assertDnsResolvesPublicly` before fetching; `ScanTargetSchema` constrains `provider`
  to the known enum, `careersUrl`/`api` to `.url()`, and uses `.strict()`. Prevents an
  attacker from writing an SSRF probe URL via `PUT /api/scan-targets`.

---

## [0.4.0] — 2026-07-12

### Added
- **Aggregator scan providers** (T4): two new `packages/adapters/scan-http` providers extend the
  scanner beyond per-company ATS targets to job-board aggregators. `adzuna` hits the confirmed
  [Adzuna Jobs API](https://developer.adzuna.com/docs/search) with `titleFilter`→`what` and
  `locationFilter[0]`→`where`; requires `SELFWRIGHT_ADZUNA_APP_ID`/`SELFWRIGHT_ADZUNA_APP_KEY`
  env vars — missing keys produce a clear one-line warn and skip the target (never crash). `arbeitnow`
  fetches the free [Arbeitnow board-wide feed](https://www.arbeitnow.com/api/job-board-api) (EU/
  international, no auth required, up to 3 pages × 100 results). Both providers enforce SSRF
  hostname allowlists and set `sourceKind: "structured"`. Country override for Adzuna via the
  target's `api` field (e.g. `https://api.adzuna.com/v1/api/jobs/us/search`). Arbeitnow provider
  ported from [santifer/career-ops](https://github.com/santifer/career-ops) (MIT). Fixture-based
  tests (no live network). Commented example entries added to `config/scan-targets.yml` and
  `examples/data-template/pipeline/scan-targets.yml`.
- **Automated bootstrap** (`scripts/setup.mjs`): dependency-free Node script (no pnpm install
  required to run it) that automates the entire first-time setup: checks node ≥ 22 / pnpm / git
  (docker optional, warn only); resolves or creates the data directory (interactive prompt with
  sibling-fallback offer, or `--data-dir`); writes/updates root `.env` preserving existing lines
  (`SELFWRIGHT_DATA_DIR=<resolved>`); runs `pnpm install`; installs git hooks via lefthook or
  `@selfwright/tools prepare`; optional Playwright Chromium install (`--with-playwright`); doctor
  pass runs `pnpm fitness` and the named-entity probe and prints a PASS/attention summary.
  Idempotent — safe to re-run. Flags: `--data-dir`, `--clone-data <url>`, `--init-template`,
  `--with-playwright`, `--non-interactive`. README quick start updated to `node scripts/setup.mjs`;
  MANUAL.md §2.2 updated with automated path + manual fallback. Pure helpers (`parseArgs`,
  `mergeEnvFile`) unit-tested in `tools/src/setup-helpers.test.ts`.
- **Scheduled scan browser re-verification** (T4): `tools/scripts/scheduled-scan.ps1` now passes
  `--verify` to `selfwright scan` by default, enabling Playwright Chromium re-verification of
  "uncertain" postings in the weekly scheduled run (ADR 0012). New `-Verify` bool parameter
  (default `$true`) can be set to `$false` when Chromium is not installed. Installer
  `install-scheduled-tasks.ps1` gains `-NoVerify` switch to propagate the override at install time.
  Documented in `docs/scheduled-tasks.md` configuration table.

### Fixed
- **De-hardcoded machine-specific paths**: PowerShell `.EXAMPLE` blocks in
  `tools/scripts/scheduled-scan.ps1`, `tools/scripts/scheduled-inbox.ps1`,
  `tools/scripts/install-scheduled-tasks.ps1`, and `apps/web/scripts/install-windows-task.ps1`
  replaced the machine-specific `C:\dev\Selfwright-data` example path with the generic
  `C:\Users\<you>\Selfwright-data`. Added `SELFWRIGHT_DATA_DIR` to `.env.example` (previously
  absent) with a note that the sibling `Selfwright-data` fallback exists as a convenience only.
  MANUAL.md §2.3 and §2.4 now document the fallback order (env var → sibling → hard fail) and
  make clear that `SELFWRIGHT_DATA_DIR` is preferred over the convenience fallback.

- `selfwright queue-add` CLI command and `queue_add` MCP tool: LinkedIn-safe manual capture lane
  (PLAN.md D3 — no scraping). Owner pastes a job posting URL and JD text; company/role are
  extracted from the text, never fetched. Dedup-checked against `pipeline/queue.yml` AND
  `applications/applications.yml` using the existing fuzzy company+role primitive (same Jaccard
  threshold as automated scan cross-dedup); refusal message names the conflicting entry. Optional
  `--jd-file`/`--jd-stdin` (CLI) or `jd_text` (MCP) runs the same deterministic scoring path as
  `selfwright score`; fit score stored on the entry. Entry written to `pipeline/queue.yml` with
  `source: "manual"` and `MAN-<url-hash>` id; URL also appended to `pipeline/scan-history.yml`
  so future automated scans skip it. Skill at `.claude/skills/queue-add/SKILL.md` and command at
  `.claude/commands/selfwright-queue-add.md` — both state the no-scraping rule explicitly.
  Core logic pure in `packages/core/src/scanning/queue-add.ts` (TDD: 13 tests, full branch
  coverage of dedup precedence and the ok/error paths).
- Cross-process git write hardening (`packages/adapters/storage-git/src/git-commit.ts`): four
  discriminated error classes (discriminated by `kind` on the failure result) — `concurrent-write`
  (index.lock contention from another process: retried up to 5 times with 100-300ms random jitter
  before failing); `not-a-git-repo` (data dir not git-initialised); `hook-rejection` (pre-commit
  hook exited non-zero — existing behaviour, now named); `other` (any other failure). Optional
  `CommitRetryConfig` parameter for tuning retry behaviour (used in tests for fast cycles).
  `apps/web/src/routes/actions.ts` updated to surface each class with the correct HTTP status:
  409 for concurrent-write ("try again in a moment"), 500 for not-a-git-repo (mis-configuration),
  422 for hook-rejection (unchanged user-facing wording), 500 for other. Previously all failures
  were mislabelled "Write rejected by data-repo hook" regardless of root cause. TDD: 7 tests
  (index.lock simulation, not-a-git-repo dir, hook rejection, retry-until-lock-clears).
- Extraction + restore drill (internal audit): two live
  verification exercises against the Phase 4 DoD ("use this template" works with a stranger's
  data). Exercise A — cloned `feat/phase4-kickoff` standalone with no `SELFWRIGHT_DATA_DIR`:
  build/lint/typecheck/test/fitness all green (23 passed, 3 Tier-2 skipped, 0 failed); ran the
  real CLI (`score`, `inbox`, `metrics`, `gap-scan`, `debrief add/list`, `scan --dry-run`)
  against a synthetic stranger data dir; whole-tree named-entity scan of the clone against the
  real data dir came back clean (464 files, 28 patterns, 0 leaks). Exercise B — cloned
  `Selfwright-data` from its GitHub origin and executed the recovery playbook in
  `docs/data-storage-and-backup.md` literally: structure verified (23 application records,
  `truth/`, `pipeline/`, `drifts/`, `positioning/scoring-vocabulary.yml`, `SCHEMA-VERSION`), CLI
  `inbox`/`metrics` output byte-identical against the real vs. restored data dir, `pnpm fitness`
  26/0 against the restored clone. Both exercises PASS; 4 documentation/discipline findings
  logged (undocumented `keyword-ontology.yml` requirement, stale README with no data-dir
  onboarding, an uncommitted telemetry append caught live, a checklist directory that doesn't
  exist yet in the real dataset) — none block the DoD, none fixed in this pass per task scope.
- IP/AGPL audit (`docs/audits/ip-agpl-audit-2026-07.md`): read-only sweep of all ~190
  production dependencies — all permissive (MIT/Apache-2.0/ISC/Unlicense/BSD); 0 AGPL/GPL/
  LGPL/SSPL/BUSL; 0 missing licenses. `pnpm audit`: 0 advisories across 412 deps (118 prod).
  Infra services arm's-length: postgres (PostgreSQL License), ollama (MIT), litellm (ISC),
  metabase (AGPL v3 — localhost GUI only, zero SDK imports, removable), evidence (MIT),
  mem0-service (Apache-2.0, HTTP only). Deliberate pins noted: zod 3.x (v4 breaking), TS 5.x,
  vitest 3.x — refresh cadence quarterly. Verdict: open-core ready, no blockers.
- First quarterly architectural-fitness review (internal audit): 26 executable checks / 0
  failing; Tier-1/Tier-2 split documented; 13-gap table
  with status for each (G8 coverage closed, G13 closed this cycle); security/dependency cadence
  owned here quarterly (next 2026-10); no material architecture drift.
- Conventional-commit lint hook (`G13`, `tools/src/hooks/commit-msg-lint.ts`): rejects commit
  messages not matching `type(scope)?: description`; allows `Merge ...` auto-messages; lefthook
  `commit-msg` integration + tool-agnostic `tools/git-hooks/commit-msg` twin installed by
  `pnpm prepare`; 32 unit tests; documented in `docs/fitness-functions.md` under Hook-tier controls.
- `APPLICATION_STATUSES` const and `ApplicationStatus` type in `packages/core` (the single
  authoritative source for the 11-value ledger vocabulary); pipeline display ordering and badge
  colours updated to the canonical set; both web surfaces (`actions.ts`, `pipeline.tsx`) now
  import from `@selfwright/core`; two new pipeline page tests covering all 11 statuses and the
  unknown-value graceful fallback.
- **Web dashboard brand icons**: `docs/brand/` stores the three canonical owner-approved PNG
  variants (White/Black/Dark theme). The dark-navy variant (`apps/web/assets/brand-icon-dark.png`)
  is served as a public static asset at `GET /brand-icon.png` (no auth — brand favicon is not PII;
  `Cache-Control: public, max-age=3600`). `PUBLIC_PATHS` in `auth.ts` extended to include
  `/brand-icon.png` alongside `/login`. `layout.tsx` gains a `<link rel="icon">` in `<head>` and
  a 28 px circular logo in the nav bar; the login page gains a `<link rel="icon">` and a 64 px
  logo above the sign-in form. Five new tests: favicon link on all authenticated pages, asset
  route 200 + content-type + cache headers, unauthenticated asset access allowed, login page
  logo + favicon.
- ADR 0020 (`docs/adr/0020-scoring-vocabulary-externalization.md`): records the already-shipped
  decision to move scoring vocabulary to the data layer (context: ADR 0017 derived named-entity
  gate flags pipeline company names in framework source; allowlisting is impossible for non-
  dictionary tokens; data is the only safe home).
- Web dashboard v1.1 write actions (ADR 0019, partially supersedes ADR 0016's "v1 is
  read-only"): two POST-only writes — update an application's status (fixed vocabulary +
  optional one-line note, ≤500 chars) and capture an interview debrief (same schema as the
  CLI's `debrief add`). Both auto-commit the data dir's own git repo (git history is the
  audit log; no auto-push); a pre-commit hook rejection (e.g. the PII name-detector)
  reverts the file and surfaces the hook's stderr in the UI. Security: per-session CSRF
  synchronizer token (`verifyCsrfToken`, constant-time compare) on top of the existing
  `SameSite=Strict` cookie + Origin check; per-session write throttle (≤10/min → 429);
  strict validation (status enum, `YYYY-MM-DD` dates, length caps, control-char rejection);
  POST/Redirect/Get; optimistic-lock content hash on the status write (409 on stale
  submit); `Cache-Control: no-store` on every write-path response. `PUBLIC_PATHS` is now a
  named set in `auth.ts` (was an inline string check). FF-WEB-1 gains three positive
  assertions ((e)-(g): write routes are POST-only and absent from `PUBLIC_PATHS`, call
  `verifyCsrfToken(`, and their forms embed the CSRF token). Pipeline gains a Notes column
  and a sortable-by-fit-score queue table (server-rendered `?sort=` query param); Coaching
  gains a Recent Debriefs list and the debrief-capture form. Debrief read/append logic
  moved from `apps/cli` to `@selfwright/adapter-storage-git` (`debrief-store.ts`) so
  `apps/cli` and `apps/web` share one implementation instead of two; a parallel
  `application-store.ts` + `git-commit.ts` hold the new applications-status and
  auto-commit primitives.
- Scheduled scan + ntfy push digest (T4.1c): `--notify` flag on `selfwright scan` (pushes new
  queue entry IDs) and `selfwright inbox` (pushes tier counts + item IDs); `buildScanNotifyPayload`
  and `buildInboxNotifyPayload` pure helpers in `apps/cli/src/notify-helpers.ts` (unit-tested for
  IDs-only payload discipline); `tools/scripts/scheduled-scan.ps1` + `scheduled-inbox.ps1`
  (log to `<dataDir>/telemetry/scheduled-scan.log`, 1 MB rotate); `tools/scripts/install-scheduled-tasks.ps1`
  (registers SelfwrightScan weekly/Sunday 09:00 and SelfwrightInboxDigest daily 08:00;
  `-Uninstall` switch; mirrors `apps/web/scripts/install-windows-task.ps1` conventions).
  Ops doc at `docs/scheduled-tasks.md`.
- Interview debriefs (T4.1b): `DebriefSchema` + `deriveGapHintsFromDebriefs` + `findUndebriefedInterviews`
  in core coaching bounded context; `selfwright debrief add/list` CLI commands; `add_debrief`/
  `list_debriefs` MCP tools; `gap-scan` gains debrief-derived hints section; inbox nudges for
  interview applications with no logged debrief; `.claude/skills/debrief/` skill for conversational
  capture; apps/cli vitest smoke-test harness (3 tests: metrics JSON, debrief round-trip, empty inbox).
- Channel→outcome metrics in CLI `metrics` command and web reporting tile (62fe506).
- Versioning and release discipline: single platform SemVer, conventional-commit bumps,
  SCHEMA-VERSION coupling with Selfwright-data (ADR 0018).
- FF-VOCAB-1 fitness check (Tier 2): asserts that `positioning/scoring-vocabulary.yml`
  is not the synthetic default when `SELFWRIGHT_DATA_DIR` is set — catches silent scoring
  degradation from a missing or accidentally reverted vocabulary file.
- Queue-vs-applications cross-dedup in `runScan`: postings whose company + role fuzzy-
  match (Jaccard ≥ 0.5) an existing application entry are excluded from the queue;
  CLI and MCP `scan` commands load `applications.yml` best-effort and pass the pairs.
- ADR 0021 (`docs/adr/0021-open-core-oss-decision.md`, owner decision 2026-07-12): open-core
  OSS path decided; fresh-history snapshot extraction to a public `Selfwright` repo; current repo
  renamed `Selfwright-personal`; data repo stays private; license chosen at publication (MIT or
  Apache 2.0); 1.0.0 is the extraction milestone (ADR 0018). D5 closed.
- Full documentation program (`docs/MANUAL.md`, `docs/use-cases.md`, `examples/data-template/`,
  `README.md` rewrite): comprehensive operating manual covering concepts, setup, all 7 processes
  (each with a "When it goes wrong" failure-path subsection and a "Rules and exceptions" section
  stating absolute vs. sanctioned-exception rules), command reference (CLI/MCP/skills), and
  troubleshooting; 20-scenario use-case catalog mapped to exact commands; synthetic starter data
  directory (`examples/data-template/` — Jordan Doe / FictionalCo, named-entity probe clean) with
  a README for quick setup; README rewritten as a public pitch with truth-floor rationale, 7
  feature subsections, trust signals, quick start, and attribution (santifer/career-ops MIT,
  last30days-skill MIT).

### Changed
- MCP `add_debrief`, `list_debriefs`, `inbox`, and `gap_scan` handlers: inline debrief
  read/parse/write logic replaced with `appendDebrief` / `loadDebriefs` from
  `@selfwright/adapter-storage-git` (the same implementation used by `apps/cli` and
  `apps/web`). Behavior identical; one implementation, not three.
- Scoring vocabulary (industry-tier company names, Tier-0 anchors, commodity-trading
  keywords) externalized from `packages/core/src/scoring/{priority.ts,score.ts}` to the
  data layer — the owner's real targeting vocabulary is data, not framework code (ADR
  0017 open-core boundary; the derived named-entity gate flagged it as confidential
  company data embedded in framework source). `classifyIndustry`/`computePriority`/
  `scorePosting` now accept a `ScoringVocabulary` parameter; core ships a synthetic
  default so scoring degrades gracefully when no data-layer vocabulary is present.
  Scoring output is unchanged when the real vocabulary file is present (behavior
  preserved — see PR description for the before/after proof).
- Inbox drift lifecycle: an active drift attached only to closed applications (status
  `rejected` or `withdrawn`) now resurfaces in decideNow with a retire/re-target prompt
  instead of staying in FYI — owner-decided rule, 2026-07-11.
- `docs/VERSIONING.md` trimmed to operational mechanics only; bump rules and
  SCHEMA-VERSION coupling now referenced by pointer to ADR 0018.

### Fixed
- Scanner liveness for structured ATS results; Workday CXS request headers (394d364).
- Inbox drift-attachment check: active attached drifts now route to FYI correctly (655695e).
- `selfwright metrics --format json` now includes `channelOutcomes` — it was computed but
  silently dropped from both JSON response shapes, so JSON/BI consumers never saw the channel
  breakdown that the text format already printed (adversarial review fix).
- Undebriefed-interview nudge: was silently suppressed whenever the debriefs list was empty
  (`debriefs.length === 0`) — exactly the common early state where the nudge matters most.
  Now fires correctly whenever the producer supplied a debriefs array at all, including an
  empty one (7ec8143).
- Web dashboard write actions: two concurrent writes to the same file (e.g. two status
  updates racing) could both pass the optimistic-lock hash check against the same
  pre-write snapshot; if the loser's commit then failed (e.g. on a git `index.lock`
  collision — confirmed reproducible under real concurrency), its fail-closed revert
  wrote back its own stale snapshot, silently clobbering the winner's already-committed
  change in the working tree. The read → hash-check → write → commit critical section
  is now serialized across both write routes, so a losing concurrent request correctly
  gets a 409 instead of corrupting state (adversarial review fix).
- `inbox()`'s debrief-nudge path (`findUndebriefedInterviews`) crashed on a malformed
  (null) `applications.yml` row when a debriefs array was present — every other loop in
  `inbox()` already isolated malformed rows, this one didn't. Now filtered consistently
  (adversarial review fix).
- `channel-outcomes.ts`, `north-star.ts`, and the reporting page's "by status" breakdown
  each carried their own duplicate copy of the submitted/interviewed status-subset
  literals instead of deriving from the canonical `APPLICATION_STATUSES` — a future
  status rename/addition could silently desync them. Centralized as `SUBMITTED_STATUSES`/
  `INTERVIEWED_STATUSES` in `packages/core` (adversarial review fix).
- `truth/keyword-ontology.yml` missing now produces an error naming the file and its
  role (required by `score`/`gap-scan`/`inbox --archetype`/`scan`) instead of a bare
  "not found", per the extraction-drill's Finding 1; documented in `README.md` and
  `docs/data-storage-and-backup.md`.
- `tools/git-hooks/commit-msg`'s pnpm/tsx fallback (used when the `lefthook` binary isn't
  on `PATH`) ran only the new conventional-commit lint, silently dropping the pre-existing
  commit-message PII/confidential-name check that the `pre-commit` hook's equivalent
  fallback already covers correctly. Both checks now run in the fallback path
  (adversarial review fix).
- Redacted several real-company-identifying near-misses left over from the initial
  privacy pass (9969d2e): a bare company name below the named-entity scanner's dictionary-
  word/length thresholds remained fully identifiable in several docs and one config
  file's inline comment/branch-name references, despite ".com" domain forms already
  being scrubbed. Replaced with the same synthetic-label convention already used
  elsewhere in these docs (adversarial review fix).
- `score --jd <file>` (no structured posting, the normal path for a plain/markdown JD
  file): `seniority_match`/`leadership_match`/`geo_fit` were always degenerate (checked
  an empty title/location string) regardless of what the JD text actually said, because
  the default posting only carried the JD as `description`. Now also used as the
  fallback `title`/`location`, so a seniority word or city name anywhere in the JD body
  is found. `scorePosting()`'s own matching logic and scan-time scoring (which always
  supplies a real posting) are unchanged (adversarial review fix).

Schema version: 1 (no migration required).

---

## [0.3.0] — 2026-07-10

Phase 3 complete + CI/gate hardening (PR #25, commit 9cd0c4d). Coaching strategy, content
top-voice engine, reporting layer, local web dashboard (Tailscale + app auth), and three new
fitness functions (FF-EGRESS, FF-CRED, FF-INPUT) with named-entity detection hardening.
ADRs 0011–0017.

---

## [0.2.0] — Phase 2

LLM tier: Ollama local inference (ADR 0008), Postgres/pgvector projection (ADR 0009), mem0
memory via MCP (ADR 0010). ADRs 0006–0010.

---

## [0.1.0] — Phase 1

Platform architecture baseline (ADR 0001). Truth layer, deterministic scanner, fitness gate,
YAML parser, fit pre-filter, drift governance, LLM gateway. ADRs 0001–0005.
