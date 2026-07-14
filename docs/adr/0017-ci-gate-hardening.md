# 0017 — CI/data-leak gate hardening: named-entity detection, the local-vs-CI split, and three adjacent fitness functions

- Status: Accepted (2026-07-09)
- Supersedes: none. Hardens D25 (the data-leak gate, anchor §7.4) and extends the fitness catalog
  (anchor §7.2). Opus-tier because it changes the platform's #1 privacy/safety control (anchor §17).

## Context

A deep adversarial review of Phase 3 found that a green fitness gate had missed eight blockers.
The load-bearing gap concerns D25 — the data-leak gate, the platform's #1 safety control. Today it
is **regex-only** (`BASE_PII_PATTERNS`: phone, salary, email in `tools/src/data-leak-gate.ts`)
plus an **optional, gitignored `.confidential-names.local`** denylist (and its CI twin, the
`SELFWRIGHT_CONFIDENTIAL_NAMES` env var) that *nothing forces to be populated*. A person's or
company's name has no syntactic signature a regex can match, so named-entity PII is structurally
outside the regex gate. The concrete failure: real confidential company/person names (a target
employer, a named contact, the owner's own name) were committed into the framework repo and passed
CI, because the optional denylist was empty and no gate required otherwise.

**The hard constraint, stated up front.** Cloud CI (GitHub Actions) has **no access to the private
data** — local-first, data never leaves the machine (anchor §4.3). Therefore **named-entity
detection cannot run in cloud CI**: the ground-truth set of confidential names lives only in
`Selfwright-data` (`contacts/`, `applications/`, `truth/identity.yml`, `drifts/`), which CI never
checks out. The gate must be split explicitly — regex + structural checks in cloud CI; the
named-entity scan as a **local** git hook that reads the private data layer. The design must
**fail closed**, never silently no-op and give false assurance that names were checked when the
data dir was simply absent.

## Decision

### 1. Named-entity detection — DERIVE the blocklist from the private data layer at hook time

The confidential-name blocklist is **derived in memory** at hook time from `Selfwright-data`, not
hand-maintained. Rationale: a hand-maintained list is exactly what failed — it can be forgotten,
left empty, or drift stale, and there is no way to *require* a human to keep it current. A derived
list is always current and cannot be forgotten to be populated.

- **Source (union, read live from `SELFWRIGHT_DATA_DIR`):** `truth/identity.yml` → `name` and
  every `roles_timeline[].company`; `applications/*.yml` → `company` plus any contact / hiring-
  manager / referrer name field; `contacts/*.yml` → person and company names; `drifts/companies/
  *.yml` → the company (filename stem + `company` field); `positioning/*` company names. The
  existing `.confidential-names.local` / `SELFWRIGHT_CONFIDENTIAL_NAMES` sources are **retained as
  an additive override** for names that live only in a human's head (e.g. a verbally-named hiring
  manager), never as the primary source.
- **Matching:** case-insensitive, word-boundary. Multi-word entities (`Blorptech.io`, `Jane Doe`)
  match as a full phrase with flexible internal whitespace/punctuation; additionally, any *single*
  token that is not in a bundled common-word set and is ≥4 chars matches on its own (so `Acme`
  is caught alone, but a common surname like `Jane` is not). Identifier-embedded matches are also
  caught: a single-token term inside `snake_case`/`camelCase`/`SCREAMING_SNAKE_CASE` (no true word
  boundary), **and** a multi-word term where every component word appears as a sub-token within the
  *same* identifier run (e.g. `zorblattFenwickWebhookUrl`, `zorblatt_fenwick_webhook_url` for the
  two-word term "Zorblatt Fenwick") — an identifier carrying only one of the words does not match.
  Reuses the existing `escapeRegex` helper; the scan is deterministic (anchor §4.5), no model.
  Honest residual: this is regex/token matching, not an NLP or fuzzy scan — homoglyph
  substitution, base64/hex-encoded names, or a computed/concatenated string built at runtime can
  still evade it. That gap is structural to a deterministic scanner and is not closed here.
- **Open-core boundary (absolute):** the derived list is held in process memory only. It is
  **never written into the framework repo or its history** — no file, no cache, no log line. The
  scanner (following the existing `findPiiViolationsInContent` discipline) prints only the offending
  *file path*, never the matched name, because a name in a log defeats the denylist. The only
  framework-committed artifacts are the checker code and the allowlist below.
- **Allowlist (false-positive management):** a committed `.confidential-allowlist.yml` of
  `{ term, path-glob, reason }` entries. Collisions are contextual — `orchard` as a generic
  document-context word in `packages/core/src/documents/` is legitimate; the same word inside a
  cover-letter fixture naming a real employer would be a leak — so allowlisting is **per (term,
  path)**, never global. Invariant that keeps the allowlist
  itself leak-free: an allowlist `term` **must also be a common dictionary word**; a unique
  non-dictionary name (e.g. `Acme`) must never appear in the allowlist and is always blocked
  everywhere. The checker enforces this (a non-dictionary allowlist term fails the check).
- **Bus factor:** plain Node built-ins, no daemon, runnable by hand
  (`node tools/dist/hooks/named-entity-scan.js`), scans only already-bounded staged files
  (`MAX_SCAN_BYTES`), <100 ms on the real data set (anchor §4.8).

### 2. Local hook vs CI split — and fail-closed

| Runs where | Checks |
|---|---|
| **Cloud CI** (no data) | `data/` path emptiness, gitleaks, `BASE_PII_PATTERNS` regex, all existing fitness functions, and the new FF-EGRESS / FF-CRED / FF-INPUT (§3). The `SELFWRIGHT_CONFIDENTIAL_NAMES` secret regex may still run as a *weak supplement*, explicitly labeled **not** authoritative named-entity coverage. |
| **Local hook** (data present) | The §1 derived named-entity scan — the authoritative coverage. |

- **lefthook integration:** add the derived scan to `pre-commit` (staged files, fast feedback) and
  to a new `pre-push` stage (the true last line before anything leaves the machine — scans the
  commits about to be pushed). Also install it into real `.git/hooks/pre-commit` + `pre-push`
  (anchor §7.3 "also a real `.git/hooks` for tool-agnostic coverage") so coverage does not depend
  on lefthook alone.
- **Fail closed:** the local scan distinguishes "data dir present → scanned → clean" (pass) from
  "`SELFWRIGHT_DATA_DIR` unset/absent" (**hard fail** with a clear message), so an unconfigured
  environment can never masquerade as a clean named-entity result. This is the anti-false-assurance
  requirement.
- **Non-bypassable posture:** `--no-verify` bypasses lefthook, so integrity rests on (a) the real
  `.git/hooks` twin, (b) the CI regex + structural net for the subset CI can see, (c) branch
  protection requiring CI green, (d) the standing "never `--no-verify`" rule (anchor). **Honest
  residual:** a determined owner who runs `--no-verify` *and* pushes a unique non-dictionary name
  can still leak it, because cloud CI fundamentally cannot see the private names to catch it. Named-
  entity coverage lives and dies with the local hook + discipline; this is stated, not papered over.

### 3. Three adjacent fitness functions

| ID | Kind | Where | Pass / Fail |
|----|------|-------|-------------|
| **FF-EGRESS** | static scan | CI (Tier 1) | The SSRF class. **Pass:** every outbound `fetch`/`undici`/`page.goto`/navigate call site in `packages/adapters/**` and `apps/**` — including a fetch reached via a common alias/bind form (`= fetch`, `= globalThis.fetch`, `fetch.bind(...)`, destructured `{ fetch } = globalThis`) — routes its URL through a named validation guard (e.g. `assertAllowedUrl`). **Fail:** any raw or aliased fetch/navigate on a non-literal URL with no guard call in the file. Structural only — it asserts the guard is *called*; the guard's own DNS-resolve/SSRF logic is implemented separately (see Scope). Honest residual: still deterministic token/regex matching, not an AST — a fully dynamic or computed alias (built via `Reflect`, a string-keyed lookup, or reassigned through an intermediate object the scanner can't statically name) can still evade detection; that gap is structural to a regex-based scanner and is not closed here. |
| **FF-CRED** | static scan | CI (Tier 1) | The credentials.json class. **Pass:** known secret-bearing paths (`web/credentials.json`, `**/*.key`, `**/*.pem`, `.env*`) are matched by `.gitignore` **and** absent from `git ls-files`. **Fail:** any is tracked (catches a forced `git add -f` that `.gitignore` alone cannot). |
| **FF-INPUT** | property/fuzz **test suite** (not a scan) | CI (Tier 1) | The null-YAML-row class. Feeds core loaders/validators (`TruthLoader`, the yaml parsers, Zod schemas, `sync-db` row mapping) null / empty / wrong-type / oversized / malformed rows and asserts each **rejects with a typed error** and never throws an unhandled `Cannot read properties of null`. Synthetic inputs — no private data needed. Lives beside the core under test (`packages/core/**/__tests__`), added to the runner as a normal Vitest suite. |

Each is registered in `fitness/src/runner.ts` (FF-EGRESS, FF-CRED as `check*` functions;
FF-INPUT as a test suite) and documented in `docs/fitness-functions.md`.

### 4. Selfwright-data repo hardening (documented here, implemented in that repo)

The private repo has its own `lefthook.yml` and dependency-free `scripts/`. Two additions, tracked
as a change in `C:\Users\<you>\Selfwright-data`, not implemented by this ADR:

- **Block committing credentials/web:** a pre-commit check (and the data repo's CI) that rejects any
  staged `web/` path or `web/credentials.json` — belt-and-suspenders over `.gitignore`, which only
  stops an accidental `git add`, not a forced one. This is FF-CRED mirrored into the data repo.
- **Schema-validate structured data on commit:** a dependency-free Node validator over
  `applications/*.yml` (plus `identity.yml`, `truth/evidence/registry.yml`, `drifts/*`) that catches
  malformed rows — null row, missing required keys, wrong types — **at the source**. This is the
  upstream fix for the null-YAML-row class (complementing FF-INPUT's defensive floor): malformed
  data never enters the truth layer in the first place.

### 5. Process / verification changes

- **Run the gate uncached before "done":** the fitness suite must be certified with
  `turbo run fitness --force` (cache bypassed). Turbo cache masked a real failure this cycle — a
  cached green is not evidence.
- **Check remote CI before declaring green:** a local pass ≠ a remote pass. Confirm with
  `gh pr checks` / `gh run list` before any "CI is green" claim (anchor discipline; cf. the
  verification-before-completion practice).
- **Documented local pre-merge step for Tier-2 checks:** the checks that need `SELFWRIGHT_DATA_DIR`
  (the FF-TRUTH-* family and the new §1 named-entity scan) **cannot run in cloud CI** and must be
  run locally before merge, per a documented runbook step — so "CI green" is never mistaken for
  "named-entity + real-data checks passed."

## What is NOT changed

- `BASE_PII_PATTERNS` (phone/salary/email), the `data/`-path emptiness check, and gitleaks stay
  exactly as they are — the named-entity scan is *additive* defense-in-depth, not a replacement.
- The truth floor (D26) and honesty walls are untouched and absolute.
- Core stays I/O-free: the named-entity scanner lives in `tools/` and a lefthook hook, reading the
  data dir like every other adapter — never in `packages/core` (FF-PORT-1 unaffected).
- The Postgres projection posture (ADR 0009/0015) is unchanged.

## Consequences

- The #1 safety control gains coverage of the entire class it was structurally blind to (named
  entities), with zero ongoing maintenance and no way to forget to populate it.
- The local-vs-CI split is now explicit and honest: cloud green covers regex + structure; named-
  entity coverage is a local, fail-closed hook whose residual (`--no-verify` bypass of a unique
  name) is documented, not hidden.
- Three new fitness functions close the SSRF, credential-path, and malformed-input classes surfaced
  by the review; the data repo stops malformed rows and credential files at the source.
- Small added cost: one committed allowlist file, a `pre-push` stage, a common-word set bundled with
  the scanner, and a documented pre-merge Tier-2 step. All deliberate.

## Alternatives considered

- **(a) Mandatory hand-maintained `.confidential-names.local`.** Rejected: this *is* the mechanism
  that failed — nothing can force a human to keep a hand list current or non-empty, and the whole
  incident was an empty optional list. Kept only as an additive override for out-of-band names.
- **(c) NER model.** Rejected: violates deterministic-first (§4.5) and bus-factor (§4.8 — a model
  dependency, no plain-file hand-run), and cannot know *which* proper nouns are confidential — it
  would flag `TypeScript`, `Postgres`, `Anthropic` while the derived scan knows the exact real set
  from ground truth. Worse false-negative risk (recall gaps) on the one control that must not miss.
- **Ship the derived list to CI as a secret to run named-entity detection in the cloud.** Rejected:
  it can only ever be a curated subset (secrets are hand-set, reintroducing the maintenance failure),
  and it risks the names landing in retained CI logs/history — the exact leak the gate prevents. The
  supplement is kept but explicitly labeled non-authoritative.
- **An encrypted/`git-crypt` names file committed to the framework repo.** Rejected: the derived
  list must never enter the framework repo or its history in any form; in-memory-only is the only
  boundary-safe option.
- **Global (non-path-scoped) allowlist.** Rejected: it would either over-block legitimate common-
  word usage everywhere or force unique confidential names into the allowlist (a leak). Per-(term,
  path) with the dictionary-word invariant keeps unique names always-blocked.

---

*Scope boundary: the truth-floor residual fixes (spelled numbers, id-case, r19-guard, adversarial
corpus), the SSRF DNS-resolve check itself (FF-EGRESS only asserts the guard is called), lockout
decay, and the mcp test harness are being implemented separately and are out of scope for this ADR.*

## Amendment — 2026-07-12: machine-identity patterns (Phase 5 T5.1)

The §1 named-entity scan derives a confidential-*name* blocklist from the private data layer.
It has no coverage for a structurally different leak class: MACHINE identifiers — the owner's
Windows username, machine hostname, personal email, and any `C:\Users\<name>`-style local
absolute path — none of which live in `Selfwright-data` at all; they're derivable at runtime
from the OS and git config. Publication readiness (Phase 5) requires these can never leave the
machine in a commit, push, or commit message.

**New module, `tools/src/hooks/machine-identity.ts`:**

- `deriveMachineIdentity(dataDir?)` (IO, not unit-tested) gathers the real values at hook time:
  `os.userInfo().username`, `os.hostname()`, `git config user.email`, and — if a data dir is
  available — `truth/identity.yml`'s `contact.email` field (via the pure, unit-tested
  `extractIdentityEmail`, mirroring the existing `extractIdentityOwnName` split between IO and
  pure extraction).
- `buildMachineIdentityPatterns({ username, hostname, emails })` and
  `getIdentifierEmbeddedTokenGroups(...)` are pure and injectable — unit tests use only synthetic
  values (`zqxbot`, `SYNTH-HOST-42`, a synthetic `planted.synthetic (at) example.test` email),
  never real ones.
  Eligibility is checked *once* against the whole raw value (empty, <4 chars, or a bundled
  common word is skipped) — the same rule as §1's single-token names, and never applied
  per split component (see next point). Username and hostname additionally get
  identifier-embedded matching via `extractIdentifierRunTokenSets`
  (`tools/src/hooks/identifier-tokens.ts`, shared with §1 without a circular import) — closes
  the same snake_case/camelCase \b-blind-spot as §1. Email gets a plain word-boundary match
  only (no identifier-embedded form is meaningful for an email address).
- **Correction (2026-07-12, same-day adversarial review):** a *compound* hostname/username
  (hyphen/underscore/dot-separated — Windows' own default auto-generated hostname shape is
  `DESKTOP-XXXXXXX`) was originally stored as ONE opaque lowercased token
  (`getIdentifierEmbeddedTokens`), which could never equal any single sub-token that
  `extractIdentifierRunTokenSets` extracts from an identifier run (it always splits on
  underscore/hyphen/camelCase boundaries) — a compound value's embedded form silently never
  matched. Fixed by splitting a compound value into its component words (`splitWords`, same
  separator set as §1's multi-word terms) and renaming the function to
  `getIdentifierEmbeddedTokenGroups`: it now returns one word-group per eligible value, and a
  match requires ALL of a group's words to co-occur within the SAME identifier run — mirrors
  §1's `multiWordTokens` handling exactly. `buildMachineIdentityPatterns` gained the same
  flexible-punctuation phrase matching §1 uses for multi-word names, so a compound value also
  matches plain prose written with a different separator than the one it was derived with.
- The local-path pattern (`WINDOWS_USER_PATH_PATTERN`) is **static and value-free** — it
  reveals nothing about any particular machine, so unlike the derived values it can safely be a
  literal regex, always included. It matches TWO real-shaped forms of the same local per-user
  path: the Windows drive-letter form (`C:\Users\...` / `C:/Users/...`, any drive letter,
  either slash direction) **and** the MSYS/Git-Bash form (`/c/Users/...` — Git Bash on Windows
  renders drive `C:` as `/c/`, the exact same real path under a different shell's rendering;
  added same-day after the adversarial review found the drive-letter-only pattern missed it).
  Both forms require the segment after `Users\`/`Users/` to start with a real `\w` character —
  this is exactly what keeps the legal angle-bracket placeholder form `C:\Users\<you>` /
  `/c/Users/<you>` (used legitimately in docs/scripts) un-flagged, while catching a real
  absolute path. The whole-tree audit performed when this amendment landed found five tracked
  files using a bare, non-bracketed placeholder segment after `Users\` (`CHANGELOG.md` and four
  `.ps1` `.EXAMPLE` blocks) — indistinguishable in form from a real path, so correctly flagged;
  fixed to the bracketed `C:\Users\<you>\...` form throughout.
- **Absolute, never allowlistable:** `findMachineIdentityViolations` takes no allowlist
  parameter at all — `.confidential-allowlist.yml`'s per-(term, path) mechanism exists for
  common-word false positives on confidential *names*; a machine identifier has no legitimate
  reason to appear in the framework repo, so there is no contextual exception to carve out.
- **Wired into all three hook surfaces**, same file-path-only reporting discipline as §1:
  `named-entity-scan.ts`'s `main()` (pre-commit and pre-push — both already had a resolved data
  dir, fail-closed) and `check-text-for-pii.ts`'s `checkTextForPii`/`main()` (commit-msg). The
  commit-msg path is deliberately **not** fail-closed on a missing data dir — the OS username/
  hostname and `git config user.email` sources are independent of it and still checked; only
  the `identity.yml` email source is skipped if the data dir can't be resolved.

**What is NOT changed:** the §1 confidential-name derivation, allowlist, and CI/local split are
untouched — this amendment is additive, a second independent scanner sharing the same file-
contents input and reporting shape, not a modification of the existing one.
