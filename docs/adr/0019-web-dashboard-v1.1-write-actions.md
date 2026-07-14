# 0019 — Web dashboard v1.1: two write actions on top of the read-only surface

- Status: Accepted (2026-07-11, owner-approved; updated in place 2026-07-13 — living ADR
  convention, docs/adr/README.md).
- Supersedes-in-part: 0016 (`0016-local-web-dashboard.md`), specifically the "v1 is
  read-only" decision and its stated rationale ("no write action currently qualifies as
  cheap"). Per ADR 0018 (§2), superseding a load-bearing ADR is a MAJOR trigger *in
  general*, but this platform is pre-1.0 (SemVer 0.x): a superseding capability lands as a
  MINOR bump under 0.x semantics. This rides the already-open `0.4.0` line rather than
  forcing a `1.0.0` — 1.0.0 is reserved for the open-core extraction (ADR 0018 §2).
  Product-surface label: **dashboard v1.1** (distinct from the platform SemVer, per ADR
  0018 §"Consequences").
- Note: the two write actions shipped here (status update, debrief capture) were originally
  implemented as SSR HTML forms (Hono JSX). The SSR forms were deleted in T5.10; both
  actions continue to exist as `POST /api/applications/:id/status` and `POST /api/debriefs`
  in the typed /api/* JSON contract (ADR 0023). The decisions below describe the design as
  originally shipped; current transport details are in ADR 0023 and ADR 0016 (rewritten).

## Context

ADR 0016 shipped the dashboard strictly read-only, reasoning that no write action was
"cheap": editing `applications.yml` status from a form was flagged as safety-sensitive
versus the deliberate CLI/co-pilot flow, and inbox dismissal would need a ledger that
didn't exist. Phase 4 usage surfaced two write actions the owner actually wants from his
phone, away from a terminal: (1) moving an application's status forward without opening a
laptop, and (2) capturing an interview debrief the same day it happens, before memory
fades — today this requires `selfwright debrief add` from the CLI. Both already have a
governed shape in `packages/core`: `ApplicationRecord.status`/`dates.last_update` and the
`Debrief`/`DebriefSchema` schema (`packages/core/src/coaching/debrief.ts`), so neither
write invents a new file format. The design below is scoped to exactly those two writes —
inbox dismissal, drift edits, and truth-layer edits remain out of scope, unchanged from
0016.

The two prior boundaries from 0016 still apply unchanged: no data leaves the machine
except the private GitHub repo (anchor §4.3), and the dashboard reads/writes the git truth
directly, never the Postgres projection (ADR 0009/0015).

## Decision

### Scope — exactly two writes, nothing else

1. **Update an application's status.** New status must be one of the fixed vocabulary
   `discovered | evaluating | ready | outreach | applied | screen | interview | offer |
   rejected | withdrawn | skipped`, plus an optional one-line note (≤500 chars, no control
   characters). The write sets `dates.last_update` to today (`YYYY-MM-DD`) and, if a note
   was submitted, overwrites `notes` with it (replace, not append — `applications.yml` has
   one `notes` field per record; no changelog-of-notes is introduced).
2. **Capture an interview debrief.** Same fields/schema as the CLI's `selfwright debrief
   add`: `application_id`, `date`, `round?`, `asked?`, `wobbled?`, `went_well?`, `notes?`
   (`DebriefSchema` in `packages/core/src/coaching/debrief.ts`), appended to
   `coaching/debriefs.yml`.

No drift edits, no truth-layer edits, no deletes of any kind. Inbox dismissal remains
deferred exactly as 0016 left it (no ledger exists).

### Storage & audit — auto-commit in the data repo is the audit log

Both writes: (a) validate strictly, (b) read-modify-write the target YAML file, (c) run
`git add` + `git commit` **inside the data dir's own git repository**
(`SELFWRIGHT_DATA_DIR`, a separate repo from the framework repo), with a message like
`web: status 2026-06-x applied->interview` or `web: debrief 2026-06-x 2026-07-11`. The git
history of the data repo *is* the audit log — no separate audit table or log file. There is
**no auto-push**; the owner pushes at his own cadence (durability comes from the local
commit, matching how the owner already works with the data repo from the CLI).

The commit always applies `-c user.name=selfwright-web -c user.email=selfwright-web@local`
so it succeeds regardless of whether the data repo has a global git identity configured —
this is unconditional, not a fallback, to keep the code path simple and deterministic
(`packages/adapters/storage-git/src/git-commit.ts`).

**Pre-commit hook rejection (e.g. a person name in a note, caught by the data repo's PII
hook) is handled fail-closed:** the file is reverted to its pre-write content (the
in-memory original the write handler already held, not a `git checkout` — this also
correctly handles the "debrief file didn't exist before this write" case, where revert
means deleting the file rather than restoring content) and the git index entry is reset so
it doesn't carry a stale staged change. The hook's stderr is surfaced verbatim to the UI as
a 422 response. Nothing is ever silently swallowed or bypassed.

`spawn()` is always called with an args array and an explicit `cwd` (the data dir) — never
a shell string with interpolated input — matching the CWD-bug lesson already learned in
`tools/src/data-leak-gate.ts` (commit e88117a).

### Reuse — one YAML read/append path, not three

The debrief read/append logic previously lived duplicated in `apps/cli` and `apps/mcp`.
It is moved to `@selfwright/adapter-storage-git` (`debrief-store.ts`: `loadDebriefs`,
`appendDebrief`, `readDebriefsRaw`) so `apps/cli` and `apps/web` both consume the same
function — `apps/cli`'s local `tryLoadDebriefs`/`appendDebrief` are now aliases/re-exports
of the moved functions, not a second implementation. `apps/mcp` still has its own inline
copy; that duplication is unchanged by this ADR (flagged as a follow-up, not fixed here —
out of scope for a security-critical write-action PR). A parallel `application-store.ts`
in the same package holds the (new) applications.yml read/update/hash logic. Neither module
performs the git commit itself — `git-commit.ts` is a separate, reusable primitive; the
write route in `apps/web` composes read → update → write → commit → (revert on failure).

### Security posture — extends ADR 0016, does not relax it

The decisions below reflect the original v1.1 implementation (Hono JSX SSR forms, shipped
in v0.4.0). The SSR forms were deleted in T5.10; the transport changed to JSON /api/* with
an `X-CSRF-Token` header (ADR 0023). Auth, throttle, optimistic lock, and git-commit audit
posture carry forward unchanged.

- **Transport/auth:** Tailscale Serve, password → session cookie, all as 0016. Both write
  routes sit behind `authMiddleware` — i.e. absent from `PUBLIC_PATHS` (the auth bypass
  list, now a named `ReadonlySet` in `auth.ts`).
- **CSRF:** a per-session random token (`crypto.randomBytes(32)`, generated at session
  creation, held in the in-memory session store alongside `createdAt`), validated with
  `timingSafeEqual` after an equal-length precheck (`verifyCsrfToken` in `auth.ts`). A
  missing token is treated identically to a wrong one (403), before any business logic
  runs. Originally carried as a hidden form field (`name="csrf_token"`) in the SSR forms;
  after T5.10 carried as an `X-CSRF-Token` header fetched from `GET /api/meta`. The
  `verifyCsrfToken()` function is unchanged in both cases.
- **Per-session write throttle:** ≤10 writes/minute (rolling window) → 429 past the
  limit. Bounds the blast radius of a compromised session.
- **Strict validation:** status is a closed enum; dates are `YYYY-MM-DD` via regex; list
  fields capped at ≤20 items × ≤200 chars each; the one-line note capped at ≤500 chars.
  Every free-text field rejects ASCII control characters (checked with `charCodeAt` scan
  rather than a regex literal — an early regex draft was silently corrupted by the
  file-write path; the char-code scan sidesteps that class of bug entirely).
- **`Cache-Control: no-store`** on every response on the write path, matching 0016.
- **Optimistic lock on the status write:** a SHA-256 hex hash of `applications.yml`'s raw
  content is embedded at read time and checked on write; a mismatch returns `409` rather
  than clobbering a concurrent edit. The debrief write is a pure append — no lock needed.

### Read-only v1.1 enrichments (original SSR implementation — historical)

These enrichments shipped in v0.4.0 alongside the SSR write forms. After T5.10 the
equivalent reads are served by the React cockpit pages consuming `/api/*` JSON endpoints.

- Pipeline/queue page: server-rendered sort toggle on fit score (`?sort=fit_desc` /
  `?sort=fit_asc` via a plain link in the column header).
- Pipeline applications table: Notes column rendering `app.notes`.
- Coaching page: Recent Debriefs list above the debrief form (rendering the loaded
  `Debrief[]` from `coaching/debriefs.yml`).

## Fitness — FF-WEB-1 extended

Three new positive assertions in `fitness/src/checks/web-safety.ts` (full detail in
`docs/fitness-functions.md`), verified with a negative control (temporarily removing a
`verifyCsrfToken(` call and confirming the check fails with the expected message, then
reverting) before landing:

- (e) every write route (`app.post(...)` other than `/login`/`/logout`) is POST-only (no
  matching `app.get(...)`) and absent from `PUBLIC_PATHS`.
- (f) each write route's handler calls `verifyCsrfToken(`.
- (g) each write route's form template embeds the CSRF token (`name="csrf_token"`).

## What is NOT changed

Core stays I/O-free — the write logic lives in `apps/web` (composition) and
`packages/adapters/storage-git` (the read/update/append/commit primitives), never in
`packages/core`. No new port. The truth layer (`truth/`), drifts, and gaps are untouched
and remain read-only from the dashboard. The data-leak gate and the truth floor are
absolute and untouched. Tailscale Serve, password/session auth, and the "read the git
truth directly, never Postgres" posture from 0016 are all unchanged. No scheduler/daemon
is introduced.

## Consequences

- The owner can move an application's status and log a debrief from his phone, the two
  write actions Phase 4 usage actually asked for — without opening a laptop or breaking the
  "git history is the audit log" discipline the rest of the platform already relies on.
- The dashboard is no longer purely a read mirror; ADR 0016's "it can never corrupt state"
  claim is narrowed to "corruption is bounded to two validated, throttled, auditable
  writes, each reversible via `git revert` like any other commit."
- Zero new dependencies; the CSRF/throttle machinery reuses `node:crypto` and the existing
  in-memory session store, consistent with 0016's "no new dependency" posture for security
  primitives.
- The debrief read/append duplication between `apps/cli` and `apps/web` is eliminated;
  the same duplication in `apps/mcp` is now the *only* remaining copy and is a natural
  follow-up, not addressed here.

## Alternatives considered

- **Inbox dismissal ledger.** Rejected (still, per 0016): inbox is fully derived; adding a
  dismissal ledger is a bigger, separate feature with its own schema questions, orthogonal
  to the two writes the owner actually asked for.
- **Append-only notes (changelog) instead of overwrite.** Rejected for v1.1: `notes` is a
  single field on `ApplicationRecord` today; introducing a structured note history is a
  data-schema change (MAJOR per ADR 0018) for a feature that isn't requested yet. Overwrite
  is simple and matches the field's existing single-value shape; the CLI's fuller edit
  flow remains available for anything more nuanced.
- **Auto-push after commit.** Rejected: 0016's owner-pushes-when-ready cadence is
  preserved; auto-push from an unattended web process is a bigger trust boundary (network
  credentials, force-push risk) for marginal benefit over local durability.
- **JS-based inline edit (fetch + optimistic UI) instead of full-page POST/Redirect/Get.**
  Rejected at the time (v1.1): 0016 committed to zero client JS; a fetch-based inline
  editor would have been the first client JS in the dashboard. The React cockpit (T5.10)
  subsequently adopted a full client-side approach, but that was a separate decision
  (ADR 0016 rewritten) for a broader surface, not a reconsideration of this v1.1 scope.
- **`git checkout HEAD -- <path>` for revert instead of caller-held original content.**
  Rejected: fails cleanly for a file that didn't exist in HEAD yet (the first-ever
  debrief) — the caller already has the pre-write content (or knows there was none) in
  memory, so restoring from that is simpler and correct in both cases.
