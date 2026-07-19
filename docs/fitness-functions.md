# Selfwright — Fitness Functions

Executable, version-controlled tests of architectural properties.
Run with `pnpm fitness` (or `turbo run fitness`).
Every check must pass before a PR merges. CI enforces this.

---

## Phase 0 — Existential set (4 active)

### FF-DATA-LEAK-1 · data-leak

**File:** `fitness/src/checks/data-leak.ts`
**Status:** ✅ Active (Phase 0)

Blocks any commit that carries personal data into the Selfwright repo.

| Test | Pass | Fail |
|------|------|------|
| `git ls-files data/` | Empty | Any file under `data/` |
| gitleaks | No secrets | Secret pattern matched |

> **gitleaks is advisory locally** if not installed (warn + continue); hard-fail in CI where it is
> installed. See `.gitleaks.toml` for custom Anthropic/LiteLLM key rules.

---

### FF-PORT-1 · core-no-provider-imports

**File:** `fitness/src/checks/core-no-provider-imports.ts`
**Config:** `.dependency-cruiser.cjs`
**Status:** ✅ Active (Phase 0)

Enforces the hexagonal boundary: `packages/core/` may import **only** `zod` and its own files.

| Rule | Forbidden |
|------|-----------|
| `FF-PORT-1-core-no-adapter-imports` | `packages/core/src/` → `packages/adapters/` |
| `FF-PORT-1-core-no-framework-npm` | `packages/core/src/` → any npm package except `zod` |
| `FF-PORT-1-no-circular` | any circular dependency anywhere |

---

### FF-CONTEXT-1 · context-boundaries

**File:** `fitness/src/checks/context-boundaries.ts`
**Config:** `.dependency-cruiser.cjs`
**Status:** ✅ Active (Phase 5, T5.6)

Enforces bounded-context discipline inside `packages/core/src/`: every import that crosses
from one context directory into a sibling context directory must target the sibling's `index.ts`,
never a deep internal file.

| Rule | Forbidden |
|------|-----------|
| `FF-CONTEXT-1-index-only-cross-context` | `packages/core/src/A/**` → `packages/core/src/B/**` where the target is not `B/index.ts` |

**Exemptions:**
- `packages/core/src/ports/` — port files are one-file-per-contract with no index; any context
  may import a port file directly. ports/ is also exempt as source (port files may import from
  domain contexts to describe what they abstract).
- `packages/core/src/shared/` — shared kernel (`Result<T,E>`); exempt as **target only**. A
  shared/ file that imports from a context would itself fire the rule (shared/ has no special
  exemption on the `from` side).
- The root `packages/core/src/index.ts` — the public package facade; not under a context
  subdirectory and therefore outside the rule's `from` pattern.

> **Note:** FF-CONTEXT-1 does not scan test files (`*.test.ts` are excluded from the depcruise
> run — pre-existing config option). Boundary discipline inside tests is convention only, not
> mechanically enforced.

See `docs/domain/context-map.md` for the full context inventory and dependency map.

---

### FF-LAZY-1 · anti-laziness

**File:** `fitness/src/checks/anti-laziness.ts`
**Status:** ✅ Active (Phase 0)

Scans `packages/`, `apps/`, `tools/src/`, `evals/src/` for lazy-code markers that indicate
unfinished implementation left in merged code.

| Pattern | Rationale |
|---------|-----------|
| `TODO` / `FIXME` | Deferred work in a comment |
| `NotImplemented` | Thrown stub |
| `// unchanged` / `// placeholder` | Lazy AI output marker |
| `.skip(` | Skipped test |

> `fitness/src/` is excluded — the checker itself necessarily contains these strings as data.

---

### FF-HALLUC-1 · anti-hallucination

**File:** `fitness/src/checks/anti-hallucination.ts`
**Status:** ✅ Active (Phase 0) — **truth-trace stub**

Verifies that every relative TypeScript import resolves to an actual `.ts` file on disk.
Catches hallucinated module paths from AI-assisted code generation.

Scans `packages/`, `apps/`, `tools/src/`, `fitness/src/`, `evals/src/`.
Only matches `import … from "./rel"` and `export … from "./rel"` at line start
(does not match strings inside code or comments).

> **Phase 1 extension:** will also verify that every outward claim in generated output
> (number, title, system name) traces back to a `truth/` source file in Selfwright-data.

---

## Phase 1 — Truth-integrity set (5 active)

### FF-TRUTH-1 · truth-trace

**File:** `fitness/src/checks/truth-trace.ts`
**Library:** `packages/core/src/truth/trace.ts` — `traceClaims(text, registry): TraceResult`
**Status:** ✅ Active (Phase 1)
**Requires:** `SELFWRIGHT_DATA_DIR` set (skips gracefully if absent)

Every substantive claim in a fixture CV summary must map to at least one EVD-* entry in the
registry by keyword overlap (≥2 shared content words).

---

### FF-TRUTH-2 · dangling-evidence

**File:** `fitness/src/checks/truth-dangling.ts`
**Status:** ✅ Active (Phase 1)
**Requires:** `SELFWRIGHT_DATA_DIR` set (skips gracefully if absent)

Scans every YAML file under `$SELFWRIGHT_DATA_DIR` for `EVD-[A-Z0-9-]+` references and diffs
against the authoritative `truth/evidence/registry.yml`. Any reference to an ID not present in
the registry fails this gate.

---

### FF-TRUTH-3 · honesty-boundary

**File:** `fitness/src/checks/truth-honesty.ts`
**Library:** `packages/core/src/truth/honesty.ts` — `scanHonestyBoundary(text, drifts, registry): HonestyResult`
**Status:** ✅ Active (Phase 1)
**Requires:** `SELFWRIGHT_DATA_DIR` set (skips gracefully if absent)

Two assertions:
1. A clean fixture text produces zero violations.
2. A fixture containing the known-retired phrase "autonomous trading agents" (from a
   retired evidence entry) is correctly flagged.

Also detects keywords from retired drift entries (status: "retired") used in text.

---

### FF-TRUTH-4 · identity-consistency

**File:** `fitness/src/checks/truth-identity.ts`
**Status:** ✅ Active (Phase 1)
**Requires:** `SELFWRIGHT_DATA_DIR` set (skips gracefully if absent)

Loads every YAML file under `$SELFWRIGHT_DATA_DIR/applications/` and validates that any
`company` + `title` pair is present in `identity.yml → roles_timeline`. Passes gracefully
when `applications/` is empty (no applications filed yet).

---

### FF-TRUTH-5 · r19-guard

**File:** `fitness/src/checks/truth-r19.ts`
**Library:** `packages/core/src/truth/r19-guard.ts` — `guardSummary(text, identity, registry): R19Result`
**Status:** ✅ Active (Phase 1)
**Requires:** `SELFWRIGHT_DATA_DIR` set (skips gracefully if absent)

Verifies that every substantive sentence in a fixture CV summary is grounded in the evidence
corpus (registry claims + details + keywords). Uses content-word matching: a sentence must
share ≥2 significant words with some EVD entry. Deterministic only — no LLM.

---

## Gateway set (active) — introduced with the co-pilot gateway (ADR 0006)

### FF-LLM-1 · llm-egress

**File:** `fitness/src/checks/llm-egress.ts`
**Status:** ✅ Active
**Requires:** nothing (Tier 1)

Structural scan of `apps/**` (not a control-flow/AST reachability analysis): fails if any
`apps/` source file references `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` (no API-key adapter is
permitted anywhere — D-1), or instantiates `LiteLlmAdapter`/`ClaudeCliAdapter` without an
`--adapter` opt-in marker present in the same file (the default composition path must never
wire a concrete LLM adapter).

---

### FF-GEN-1 · generated-artifact-trace

**File:** `fitness/src/checks/generated-artifact-trace.ts`
**Library:** `packages/core/src/services/generation-guard.ts` —
`validateCoverArtifact(text, { registry, identity, drifts }): GenerationGuardResult`
**Status:** ✅ Active
**Requires:** nothing (Tier 1, synthetic fixtures)

Self-test over synthetic fixtures: a clean, traceable cover artifact passes
`validateCoverArtifact`, and one containing an untraceable claim fails with the expected
violation. The CI-side guarantee that produced artifacts are validated regardless of which
generator produced them — co-pilot, `ClaudeCliAdapter`, or `LiteLlmAdapter` — since generation
is no longer behind `LlmPort` by default.

---

## Tailor + fit set (active) — introduced with the gateway redesign (2026-07-01)

### FF-TAILOR-1 · tailor-overlay-guard

**File:** `fitness/src/checks/tailor-overlay-guard.ts`
**Library:** `packages/core/src/services/tailor.ts` — `tailorService(cv, overlay, evidenceMap, opts, ctx)`
**Status:** ✅ Active (Tier 1, gateway redesign)
**Requires:** nothing (synthetic fixtures)

Two assertions over synthetic fixtures:
1. An `overlay.summary` containing claims not traceable to any evidence entry (e.g.
   "built a nuclear reactor") is rejected with a `VALIDATION_ERROR` whose message includes
   the word "untraceable".
2. An `overlay.summary` that mirrors a real evidence claim is accepted without error.

---

### FF-TAILOR-2 · tailor-drift-apply

**File:** `fitness/src/checks/tailor-drift-apply.ts`
**Library:** `packages/core/src/services/tailor.ts` — `tailorService(cv, overlay, evidenceMap, opts, ctx)`
**Status:** ✅ Active (Tier 1, gateway redesign)
**Requires:** nothing (synthetic fixtures)

Five assertions over synthetic `drift_applications` in the overlay:
1. **replace mode** — an active drift replaces the target bullet with `drift.claim` and unions its keywords into `skills`.
2. **keywords-only mode for a retired drift** — a retired drift is silently skipped; its keywords are not merged.
3. **high-risk band without allow_high_risk** — a `confidence.band === "high-risk"` drift is rejected (VALIDATION_ERROR) when `allow_high_risk: false`.
4. **high-risk band with allow_high_risk: true** — the same drift is accepted.
5. **unknown drift ID** — references to a non-existent drift ID produce VALIDATION_ERROR naming the real id (not `"[object Object]"` — the BUG-1 crash fix).

---

### FF-TAILOR-3 · tailor-honesty-output

**File:** `fitness/src/checks/tailor-honesty-output.ts`
**Library:** `packages/core/src/services/tailor.ts` — `tailorService(cv, overlay, evidenceMap, opts, ctx)`
**Status:** ✅ Active (Tier 1, gateway redesign)
**Requires:** nothing (synthetic fixtures)

Two assertions over truth post-validation (advisory — output is `ok`, not an error):
1. A CV summary containing a phrase that matches a **retired** drift's keywords populates
   `_tailor_meta.truth_warnings` with at least one warning.
2. A clean CV summary produces an empty (or absent) `truth_warnings` array.

---

### FF-FIT-1 · fit-nondegeneracy

**File:** `fitness/src/checks/fit-nondegeneracy.ts`
**Library:** `packages/core/src/scoring/index.ts` — `scoreJd(input): JdScoreResult`
**Status:** ✅ Active (Tier 1, gateway redesign)
**Requires:** nothing (synthetic fixtures)

Non-degeneracy floor for the deterministic fit scorer (ADR 0004 / BUG-2 fix). The deterministic
fit score is a pre-filter/ranking signal, not a Phase DoD gate. The only guaranteed property is:
a JD crafted to match the synthetic archetype must produce a non-null `archetype` match and a
grade other than `"F"`. A result of `archetype === null` or `grade === "F"` fails this check.

---

## Scanner set (active) — introduced with the deterministic scanner (Task T2.3)

### FF-SCAN-1 · scan-liveness

**File:** `fitness/src/checks/scan-liveness.ts`
**Library:** `packages/core/src/scanning/liveness.ts` — `checkLiveness(pageText, opts): LivenessVerdict`
**Status:** ✅ Active
**Requires:** nothing (Tier 1, synthetic fixtures)

Self-test over synthetic page-text fixtures: a Cloudflare/anti-bot challenge page must classify
as `"uncertain"`, never `"expired"` (an expired classification would permanently filter out a
job that is actually still live); a clear "no longer accepting applications" banner must
classify as `"expired"`; a posting with a visible apply control must classify as `"live"`.

---

### FF-SCAN-2 · scan-dedup

**File:** `fitness/src/checks/scan-dedup.ts`
**Library:** `packages/core/src/scanning/dedup.ts` — `isSeen`, `dedupeByCompanyRole`, `dedupeByCompanyRoleFuzzy`
**Status:** ✅ Active
**Requires:** nothing (Tier 1, synthetic fixtures)

Self-test over synthetic fixtures: a URL already recorded in the scan-history ledger is
reported as seen (never re-queued); an unseen URL is not; two postings that normalize to the
same company+title (case/whitespace differences only) collapse to one via
`dedupeByCompanyRole`; "Senior Engineer" and "Sr. Engineer" at the same company collapse to
one via `dedupeByCompanyRoleFuzzy` (Jaccard ≥ 0.5 on stopword-filtered title tokens).

---

### FF-SCAN-3 · scan-never-silent

**File:** `fitness/src/checks/scan-never-silent.ts`
**Status:** ✅ Active (Tier 1)
**Requires:** nothing (static source scan)

Every provider in `packages/adapters/scan-http/src/providers/` that implements an `async fetch()`
method must also contain a `process.stderr.write` call — the mechanism all compliant providers use
to emit a zero-result warn so that a stale tenant slug, expired API token, or changed board layout
fails loudly rather than silently returning an empty result set.

Exclusions: `generic.ts` (fetches a single URL, not a board listing — zero results are normal),
`workday-browser` (lives in `packages/adapters/scan-browser/`, covered by its own test suite).

---

## Phase 2 — Determinism + cost set (active)

### FF-DET-1 · determinism-ratio

**File:** `fitness/src/checks/determinism-ratio.ts`
**Status:** ✅ Active (Phase 2)
**Requires:** nothing (Tier 1, synthetic fixtures)

Runs the deterministic pipeline (`scoreJd` + `computeAts`) twice with identical synthetic
inputs and asserts byte-identical JSON output. Catches any accidental introduction of
`Math.random()`, `Date.now()`, or other non-deterministic operations into the core scoring
and ATS modules.

---

### FF-COST-1 · cost-budget

**File:** `fitness/src/checks/cost-budget.ts`
**Status:** ✅ Active (Phase 2)
**Requires:** nothing (Tier 1, synthetic fixtures)

Verifies that total token spend across all LLM calls in a synthetic application workflow
(research + cover) stays under the per-application budget ceiling of 50,000 tokens. At
Sonnet pricing (~$3/MTok input, ~$15/MTok output) this caps spend at ≤ $0.60 per application.
Alerts early if prompt engineering or new LLM calls create unbounded token growth.

| Ceiling | Synthetic workflow total | Pass condition |
|---------|--------------------------|----------------|
| 50,000 tokens (input + output) | ~12,700 tokens | total ≤ ceiling |

Usage data is recorded to `reports/usage.jsonl` (gitignored) by the `--adapter` headless path
and viewable with `selfwright metrics`.

---

## Phase 3 — Web dashboard safety set (active)

### FF-WEB-1 · web-safety

**File:** `fitness/src/checks/web-safety.ts`
**Status:** ✅ Active (Phase 3, T3.6; extended Phase 4, T4.2 for write actions; extended Phase 5,
T5.9 for the `/api/*` JSON contract; adapted T5.10 for the React cockpit clean cutover)
**Requires:** nothing (Tier 1, static source scan)
**ADR:** 0016, extended by 0019

Locks the privacy/security invariants of `apps/web` (and, from T5.10, `apps/web-ui`) that must
never regress:

| Assertion | Check |
|-----------|-------|
| (a) `hostname: "127.0.0.1"` present in `server.ts` `serve()` call | Positive grep — absence means Node binds all interfaces |
| (b) `app.use()` middleware appears before first `app.get()`/`app.post()` route in `app.ts` | Index comparison in source text |
| (c) No external hosts in `apps/web/src` (allowlist: `localhost`, `127.0.0.1`, `*.ts.net`); `raw()` never used | URL pattern scan; `raw\s*(` grep |
| (d) `c.header("Cache-Control", "no-store")` present in `auth.ts` | Literal string grep |
| (e) Every write route (`app.post(...)`/`app.put(...)` other than `/login`/`/logout`) is absent from `PUBLIC_PATHS`; a `POST` write route additionally has no matching `app.get(...)` for the same path (a `PUT` write route pairing with a `GET` at the same path — e.g. `GET`+`PUT /api/settings` — is standard REST, not a regression) | Extract `app.post("...")`/`app.put("...")` paths, positive-assert no `PUBLIC_PATHS` membership; POST paths additionally checked for no matching `app.get("...")` |
| (f) Each write route's handler calls `verifyCsrfToken(` | Count of literal calls across `apps/web/src` (excluding `auth.ts`, where it's defined) ≥ number of write routes |
| (g) Each **SSR** write route's form template embeds the CSRF token — **N/A since T5.10** (every SSR form was deleted in the clean cutover; the guard clause is vacuously satisfied with zero non-`/api/*` write routes, not skipped — see below) | Count of `name="csrf_token"` in `apps/web/src` ≥ number of non-`/api/*` write routes |
| (h) Each **JSON `/api/*`** write route reads the CSRF token via the header helper | Count of `getCsrfHeaderToken(` calls across `apps/web/src` (excluding `api/shared.ts`, where it's defined) ≥ number of `/api/*` write routes |
| (i) **[T5.10]** Zero SSR page GET routes remain in `app.ts` | Every `app.get("...")` literal path must be `/login`, `/brand-icon.png`, or start with `/api/` — anything else is a reintroduced server-rendered page route |
| (j) **[T5.10]** `apps/web-ui/src` never imports `@selfwright/core`, `@selfwright/adapter-storage-git`, or the full `@selfwright/shared-config` barrel | Import-statement scan of `apps/web-ui/src/**/*.{ts,tsx}`; `@selfwright/api-contract` and `@selfwright/shared-config/schemas` (pure zod, zero I/O) are the sanctioned exceptions |

(e)–(g) were added for ADR 0019 (dashboard v1.1 write actions) and verified with a negative
control: temporarily removing a `verifyCsrfToken(` call fails the check with the expected
message before the change is reverted.

T5.9 (the `/api/*` JSON contract) widened (e) to also enumerate `app.put(...)` routes, scoped (f)
to scan all of `apps/web/src` instead of only `routes/actions.ts` (JSON write handlers live under
`apps/web/src/api/`), narrowed (g) to only the SSR (non-`/api/*`) write routes — a JSON request has
no form to embed a hidden field in — and added (h) as the JSON-contract equivalent of (g): the
cockpit reads its CSRF token from `GET /api/meta` and resends it as an `X-CSRF-Token` header
(`apps/web/src/api/shared.ts`), verified with the exact same `verifyCsrfToken()` used by the SSR
forms. This is an adaptation, not a weakening: every write route, SSR or JSON, still requires a
`verifyCsrfToken(` call (f), and each surface's transport-appropriate token-carrying mechanism is
still independently checked. Both (f)'s and (h)'s exclusions (`auth.ts`, `api/shared.ts`) exist
because those files' own function *definitions* textually match the call regex — an earlier draft
without the exclusion silently passed a broken negative control (a removed call site was masked by
the definition line's own match); this was caught by manually breaking a call site and confirming
the check failed before landing, per the existing (e)–(g) convention above.

**T5.10 (the React cockpit clean cutover)** deleted every SSR page route and SSR write form —
`apps/web` survives as `/api/*` JSON + static host + the still-server-rendered login page. Rather
than delete (g) now that it can never fire, the clause was left unmodified: with zero non-`/api/*`
write routes, its guard (`if (formWritePaths.length > 0)`) is vacuously true, so the check reports
no violation without ever silently skipping anything — if an SSR form write route were ever
reintroduced, (g) reactivates automatically and enforces the same invariant it always has. Two new
clauses were added instead of touching (g): (i) asserts the cutover's own headline guarantee (zero
SSR page routes) as a permanent regression gate — verified with a negative control (a synthetic
`app.get("/pipeline", ...)` correctly fails the check with the expected message); (j) extends the
architecture boundary into the new workspace member, asserting `apps/web-ui` never imports
`@selfwright/core`/`@selfwright/adapter-storage-git`/the full `@selfwright/shared-config` barrel
directly (only `/api/*`, via `@selfwright/api-contract` and the schema-only
`@selfwright/shared-config/schemas` subpath, are sanctioned) — also verified with a negative
control (a synthetic `import { inboxService } from "@selfwright/core"` in `apps/web-ui/src`
correctly fails). A dependency-cruiser rule was considered for (j) instead of a source scan, but
`.dependency-cruiser.cjs`'s existing rules are scoped to `packages/core/src` only (FF-PORT-1/
FF-CONTEXT-1); extending its scope to `apps/web-ui` for one directional import-ban was a larger,
separate config change than adding one more source-scan clause to the fitness function that
already owns every other `apps/web*` architecture invariant.

---

## CI/data-leak gate hardening set (active) — ADR 0017

### FF-EGRESS · egress-guard

**File:** `fitness/src/checks/egress-guard.ts`
**Status:** ✅ Active (Tier 1, static scan)
**ADR:** 0017

The SSRF class. Every outbound `fetch`/`undici`/`page.goto`/`navigate` call site (a real call,
not a function/method declaration) in `packages/adapters/**` and `apps/**` must route its URL
through a named validation guard (`assert*Url`) present in the same file, or be explicitly
listed in the check's `EGRESS_ALLOWLIST` as known-safe egress (a developer-configured local/
infra endpoint — e.g. the LiteLLM gateway, Ollama, mem0 — never attacker- or scanned-content-
influenced). Structural only: asserts the guard is *called*, not that it dominates the call in
the control-flow graph (the guard's own SSRF/DNS-resolve logic lives in `url-guard.ts` and the
per-provider `assert*Url` functions in `scan-http/src/providers/*.ts`).

**Implementation:** deterministic token/regex scan, not an AST. Common aliased/bound-fetch forms
are covered (`= fetch`, `fetch.bind(...)`, `{ fetch } = globalThis`, `globalThis.fetch(`). The
accepted residual: a *fully dynamic or computed* alias — built via `Reflect`, a string-keyed
lookup, or reassigned through an intermediate object the scanner can't statically name — can
evade detection. No such pattern exists in-tree today. **Future hardening candidate:** upgrade
FF-EGRESS to AST-based egress analysis (control-flow reachability) to close this residual
structurally, deferred as out-of-scope pre-publication.

---

### FF-CRED · cred-paths

**File:** `fitness/src/checks/cred-paths.ts`
**Status:** ✅ Active (Tier 1, static scan)
**ADR:** 0017

The credentials.json class. Known secret-bearing path patterns (`web/credentials.json`,
`**/*.key`, `**/*.pem`, `.env*`) must (a) be matched by `.gitignore`, probed via
`git check-ignore` against a representative sample path per class, and (b) be absent from
`git ls-files`. Catches a forced `git add -f`, which `.gitignore` alone cannot stop.
`.env.example` (any depth) is the one deliberately-committed exception, matching the `!.env.
example` negation in `.gitignore`.

---

### FF-INPUT · fuzz-input

**File:** `fitness/src/checks/fuzz-input.ts`
**Status:** ✅ Active (Tier 1, property/fuzz test suite over synthetic inputs)
**ADR:** 0017

The null-YAML-row class. Feeds `computeNorthStar`, `inboxService`, `parseYaml`/
`parseFrontMatter` (`@selfwright/adapter-storage-git`), `IdentitySchema`/`EvidenceEntrySchema`
(Zod), and the sync-db row guards (`isValidApplicationEntry`/`isValidFitnessRecord`) null /
undefined / wrong-type / oversized / malformed values, and asserts each **rejects with a typed
error** (or, for the boolean sync-db type guards, safely returns `false`) — never an unhandled
null-deref (`Cannot read properties of null`). Synthetic inputs only.

This check exercises real hardening added alongside it: `parseYaml`/`parseFrontMatter` now
type-guard their input before touching it; `computeNorthStar` and `inboxService` now validate
top-level shape and skip (rather than crash on) a malformed individual row, matching the
existing "isolate row failures" convention at their sync-db/CLI callers.

---

## Hook-tier controls (commit hygiene — not CI fitness functions)

### Conventional-commit lint

**File:** `tools/src/hooks/commit-msg-lint.ts`
**Runs:** local `commit-msg` — lefthook (`lefthook.yml`) + tool-agnostic
  `.git/hooks/commit-msg` twin (installed by `tools/src/hooks/setup-hooks.ts`)
**Gap closed:** G13 (internal quarterly architectural-fitness review)

Rejects any commit whose first non-blank, non-comment line does not match
`^(feat|fix|docs|chore|refactor|test|perf|build|ci|style|revert)(\([a-z0-9,/-]+\))?!?: .+`.
Git's auto-generated merge messages (`Merge ...`) are allowed. The hook never blocks
a push caused by a merge commit created on GitHub (those are not created by a local
`git commit` call). The pure logic lives in `lintCommitMessage` (exported for unit
tests in `commit-msg-lint.test.ts`); the I/O entry point is covered by the hook
integration in lefthook.yml.

---

## Local-only hooks (not CI fitness functions) — ADR 0017

### Named-entity data-leak scan

**File:** `tools/src/hooks/named-entity-scan.ts`
**Runs:** local `pre-commit` + `pre-push` only (lefthook + a real `.git/hooks` twin) — **never
in cloud CI**, which has no access to `Selfwright-data` (anchor §4.3, local-first).

The authoritative named-entity coverage for the data-leak gate (D25). Derives the confidential-
name/company blocklist **in memory, at hook time**, from `Selfwright-data` (`truth/identity.yml`,
`applications/*.yml`, `contacts/*.yml`, `drifts/companies/*.yml`, `positioning/*`) — never
hand-maintained, so it can't be forgotten or left empty. Case-insensitive word-boundary
matching: multi-word entities match as a flexible-punctuation phrase; a single token matches
alone only if it is ≥4 chars and not in the bundled common-word list
(`tools/src/hooks/common-words.ts`). Reports only the offending **file path**, never the
matched name. False positives are managed per-(term, path) in the committed
`.confidential-allowlist.yml`, whose `term` must itself be a common dictionary word (a unique
name can never be allowlisted — enforced by the checker). Fails closed when no data dir is
found (`SELFWRIGHT_DATA_DIR` unset and no sibling `../Selfwright-data`).

**Pre-merge requirement:** because this scan cannot run in cloud CI, a green CI run is not
evidence that named-entity coverage passed — run it locally (`SELFWRIGHT_DATA_DIR` set) before
merging, same as the FF-TRUTH-* Tier-2 family.

### Machine-identity data-leak scan

**File:** `tools/src/hooks/machine-identity.ts`
**Runs:** `pre-commit` + `pre-push` (via `named-entity-scan.ts`'s `main()`) and `commit-msg`
(via `check-text-for-pii.ts`) — see ADR 0017 Amendment (2026-07-12, Phase 5 T5.1).

A second, independent scanner covering a different leak class than the named-entity scan
above: the owner's Windows username, machine hostname, personal email (from `git config
user.email` and, if present, `truth/identity.yml`'s `contact.email`), and any local user-home
absolute path in either the Windows drive-letter form (`C:\Users\<name>`, any drive letter/
slash direction) or the MSYS/Git-Bash form (`/c/Users/<name>`) — the legal angle-bracket
placeholder form (`C:\Users\<you>` / `/c/Users/<you>`) is excluded in both. A compound
username/hostname (hyphen/underscore/dot-separated, e.g. Windows' own default auto-generated
`DESKTOP-XXXXXXX` shape) is matched both as a flexible-punctuation phrase and, embedded in an
identifier, by requiring all of its component words to co-occur within the same identifier
run. Same file-path-only reporting discipline. **Never allowlistable** —
`.confidential-allowlist.yml` is not consulted for these matches; a machine identifier has no
legitimate reason to appear in the framework repo.

---

## Phase 4 — Data-integrity set (active)

### FF-VOCAB-1 · scoring-vocabulary

**File:** `fitness/src/checks/scoring-vocabulary.ts`
**Status:** ✅ Active (Tier 2, Phase 4)
**Requires:** `SELFWRIGHT_DATA_DIR` set (skips gracefully if absent)

When the owner's private data directory is configured, asserts that the scoring vocabulary loaded
from `positioning/scoring-vocabulary.yml` is **not** byte-identical to the synthetic
`DEFAULT_SCORING_VOCABULARY` shipped in `packages/core`. A match means the real data file is
missing or has been accidentally reverted to the framework default — scoring would silently
degrade to placeholder targets, which is undetectable any other way.

| Condition | Result |
|-----------|--------|
| `SELFWRIGHT_DATA_DIR` absent / `positioning/scoring-vocabulary.yml` missing | ~ skipped |
| File present but deep-equals `DEFAULT_SCORING_VOCABULARY` | ✗ fail |
| File present with real vocabulary | ✓ pass |

---

## Phase 5 — API contract set (active)

### FF-APICONTRACT · api-contract

**File:** `fitness/src/checks/api-contract.ts`
**Status:** ✅ Active (Phase 5, T5.9)
**Requires:** `apps/web`'s workspace dependencies already built (`pnpm build` or `pnpm test`,
which builds them as a side effect via turbo's `^build` dependency — the prescribed gate order
`lint → typecheck → test → fitness` always satisfies this)
**ADR:** 0023

Gates the typed `/api/*` JSON contract introduced in T5.9 (docs/MANUAL.md §2.8): every cockpit read
and write must be exercised by a passing contract test suite before merge.

| Layer | Check |
|-------|-------|
| Structural | `apps/web/src/__tests__/api-contract.test.ts` exists and its source references every endpoint path in a fixed, hand-maintained list (`DOCUMENTED_ENDPOINTS`) — catches an endpoint added to `app.ts`/`@selfwright/api-contract` without matching test coverage |
| Behavioral | Spawns `vitest run` against exactly that file (no `--coverage` — this is a pass/fail gate, not a coverage gate) from `apps/web`, requires exit code 0 |

The contract test suite itself runs entirely against a hermetic temp git data dir
(`mkdtemp` + `git init`, the same pattern as `actions.test.ts`) — it never touches
`SELFWRIGHT_DATA_DIR` or any real data. It authenticates via the same session/CSRF flow as the SSR
tests, and exercises every endpoint: reads return schema-valid payloads, writes mutate the temp
data repo and create a git commit, a missing/wrong CSRF header is rejected, an unauthenticated
request is rejected, and a pre-commit hook rejection reverts the write and surfaces the hook's
message. A dedicated test also fires a concurrent SSR-form write and a JSON-API write on the same
app instance to prove both surfaces share one write-serialization queue (`apps/web/src/write-lock.ts`)
instead of racing two independent ones. Every response is validated with the published zod schema
from `@selfwright/api-contract` (strict `.parse()`) before any field-level assertion, so an
unasserted field being added, renamed, retyped, or having its nullability changed fails the test
immediately instead of passing silently.

**Accepted tradeoff:** `DOCUMENTED_ENDPOINTS` is a hardcoded list maintained by hand in
`api-contract.ts`, not derived from `app.ts` or the contract package. It closes the *silent-deletion*
direction (an endpoint quietly dropped from the test suite while the route and its schema still
exist) but not the *silent-addition* direction — a brand-new `/api/*` route added to `app.ts` and
`@selfwright/api-contract` without a corresponding `DOCUMENTED_ENDPOINTS` entry and test coverage
passes both this check and the test suite silently. Closing that direction would require deriving
the list from `app.ts`'s route registrations rather than hand-maintaining it, deferred as unneeded
complexity for the current known-fixed set of ten endpoints.

Both layers were verified with a negative control before landing: adding an undocumented endpoint
to `DOCUMENTED_ENDPOINTS` fails the structural layer with the expected "missing endpoint" message;
breaking a test assertion fails the behavioral layer with the vitest failure output surfaced in
`details`. Both were reverted after confirming the failure.

---

## Phase 5 — Scoring quality + AI-tell hygiene (active)

### FF-ATS · ats-passthrough

**File:** `fitness/src/checks/ff-ats.ts`
**Library:** `packages/core/src/scoring/ats.ts` — `computeAts(jdText, cv, ontology, registry): AtsResult`
**Status:** ✅ Active (Phase 5, T5.7)
**Requires:** nothing (Tier 1, synthetic fixtures)

ATS pass-through quality floor. Runs `computeAts` against a synthetic golden tailored CV
(Jordan Doe / FictionalCo — fully invented) and a matching synthetic JD, and asserts
`overall ≥ 0.80` (the default threshold). Catches regressions in either:

- **Pass A** — CV structure checks (date format, required sections, contact fields, bullet length,
  skills list) that would reject a well-formed CV.
- **Pass B** — Keyword-coverage logic that would fail to match a CV to its JD when all four
  ontology terms appear verbatim in both.

The synthetic fixture is designed so a correct implementation scores 1.0 overall (Pass A = 1.0,
Pass B = 1.0). A score below 0.80 indicates a regression.

---

### FF-AISOUND · ai-tell-hygiene

**File:** `fitness/src/checks/ff-aisound.ts`
**Library:** `packages/core/src/services/ai-tells.ts` — `BANNED_AI_TELLS`, `scanAiTells(text): string[]`
**Wired into:** all six generation-guard validators (`validateCoverArtifact`, `validateResearchArtifact`,
  `validatePrepPackArtifact`, `validateDrillArtifact`, `validateGapArtifact`, `validateTopicsArtifact`)
**Status:** ✅ Active (Phase 5, T5.7)
**Requires:** nothing (Tier 1, synthetic fixtures)

Zero banned AI-tell phrases in generated artifacts. The `BANNED_AI_TELLS` constant in
`packages/core/src/services/ai-tells.ts` is the published framework artifact — the single source
of truth for the banned-phrase gate. Derived from `~/.claude/skills/human-voice/SKILL.md`
(§1 lexicon, §2 structures, §3 tones); 22 entries as of v0.6.0.

Every generation-guard validator (`validateCoverArtifact` etc.) calls `scanAiTells(text)` on the
full artifact text and pushes any `AI-tell: "<label>"` violation into its `violations` array before
returning. A single hit causes the validator to return `ok: false`.

The fitness check proves the mechanism with two synthetic cover-letter fixtures:

| Fixture | Content | Expected result |
|---------|---------|-----------------|
| Clean | Traceable opening sentence + stopword filler (350–400 words) | `ok: true` — no violations |
| Dirty | Same + `"Let's dive in."` (banned §1 opener) | `ok: false` — at least one `AI-tell:` violation |

Banned phrase categories (full list in `ai-tells.ts`):

| Source | Examples |
|--------|---------|
| §1 verbs | `delve`, `revolutionize` |
| §1 nouns | `tapestry`, `synergies`, `paradigm shift`, `deep dive`, `thought leader` |
| §1 adjective/adverb | `seamlessly` |
| §1 openers | `In today's …`, `In the ever-evolving …`, `it's important to note`, `let's dive in` |
| §1 closers | `In conclusion`, `In summary` |
| §2 structure | negation pivot: `/not just .{0,60} but/i` |
| §3 tone | `Interestingly,`, `Notably,`, `Importantly,`, `Undoubtedly,`, `testament to` |

---

## Phase 5 — Web-UI boundary (active)

### FF-WEB-UI-1 · web-ui-boundary

**File:** `fitness/src/checks/web-ui-boundary.ts`
**Config:** `.dependency-cruiser.cjs`
**Status:** ✅ Active (Phase 5, T5.10)
**Requires:** nothing (Tier 1, static dependency scan)

Enforces that `apps/web-ui/src` never imports from `packages/core` or `packages/adapters`
directly. The React cockpit consumes only the `/api/*` JSON contract; direct imports from the
domain core or storage adapters would bypass the typed contract seam and reintroduce a hard
coupling that the hexagonal architecture explicitly prevents.

| Rule | Forbidden |
|------|-----------|
| `FF-WEB-UI-1-no-core-adapter-imports` | `apps/web-ui/src/**` → `packages/core/**` or `packages/adapters/**` |

**Sanctioned exceptions:** `@selfwright/api-contract` (the typed wire-contract schemas, pure
zod, no I/O) and `@selfwright/shared-config/schemas` (schema-only subpath, also pure zod) are
allowed. The full `@selfwright/shared-config` barrel — which includes I/O helpers — is
forbidden.

Complements the regex clause (j) in `FF-WEB-1`, which scans import statements for the same
forbidden packages. This check runs the dependency-cruiser rule over the compiled module graph,
providing structural confirmation on top of the text-pattern scan.

---

## Phase 5 — Template drift set (active)

### FF-TEMPLATE-1 · template-schema

**File:** `fitness/src/checks/template-schema.ts`
**Status:** ✅ Active (Phase 5)
**Requires:** nothing (Tier 1 — the template ships in the framework repo, no private data)

Validates every file under `examples/data-template/` against the same Zod schema the
framework's real loaders enforce for a user's own data dir:

| File | Schema |
|------|--------|
| `truth/identity.yml` | `IdentitySchema` |
| `truth/evidence/registry.yml` | `EvidenceRegistrySchema` |
| `truth/archetypes/*.md` | `ArchetypeSchema` (front-matter) |
| `truth/gaps.yml` | `GapsFileSchema` |
| `truth/keyword-ontology.yml` | `OntologySchema` |
| `truth/comp-floors.data.yml` | `CompFloorsSchema` |
| `applications/applications.yml` | `z.array(ApplicationRecordSchema)` (`@selfwright/api-contract`) |
| `pipeline/scan-targets.yml` | `ScanTargetsConfigSchema` (`@selfwright/shared-config`) |
| `positioning/scoring-vocabulary.yml` | `ScoringVocabularySchema` (`@selfwright/core`) |

Fails, naming the file and the Zod error, the moment any template file stops matching its
schema — at least one archetype `.md` file is also required. Closes a real gap found in a
from-scratch install E2E: the documented `--init-template` + `SELFWRIGHT_DATA_DIR` +
`pnpm fitness` quick-start flow failed FF-TRUTH-1b/4/5b because `truth/identity.yml` shipped
`phone`/`email` commented out while `ContactSchema` requires non-empty strings, and nothing
gated the template against schema drift.

**Why three files are validated directly against their schema rather than through their
production loader:** `pipeline/scan-targets.yml` and `positioning/scoring-vocabulary.yml` have
production loaders (`parseScanTargets`, `loadScoringVocabularyFile`) that intentionally swallow
schema errors and fall back to a safe default (the framework's never-crash/degrade-gracefully
convention) — correct product behavior, but it would make this check unable to detect drift.
`applications/applications.yml` has no dedicated schema-validating loader at all. All three are
instead parsed and validated directly against the real Zod schema the rest of the app uses.

---

## Planned (not yet active)

| ID | Name | Phase | Purpose |
|----|------|-------|---------|
| FF-SWAP-1 | swap-test | 2 | Identical logic, two models → same output |
| FF-RET-1 | retrieval-quality | 2 | Embedding recalls seeded evidence |

---

## Adding a new fitness function

1. Create `fitness/src/checks/<name>.ts` exporting `check<Name>(repoRoot: string): CheckResult` (repo-level checks) or `check<Name>(dataDir: string): CheckResult` (data-dir checks).
2. Import and add it to the `results` array in `fitness/src/runner.ts`.
3. Add a row to this file under the appropriate phase.
4. Add an ADR entry if the check enforces a new architectural decision.
