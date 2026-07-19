# 0023 — Typed `/api/*` JSON contract on the existing Hono server (T5.9)

- Status: Accepted (2026-07-12)
- Supersedes-in-part: none. Extends 0016 (local web dashboard) and 0019 (v1.1 write actions) —
  every decision in those two ADRs (Tailscale Serve, password/session auth, reading/writing the
  git truth directly, logging/error posture, the two audited writes' semantics, FF-WEB-1) is
  unchanged and still binding. This ADR adds a second response format (JSON) alongside the
  existing SSR HTML on the same server, same origin, same auth boundary.

## Context

T5.10 (next task) replaces the server-rendered pages with a React cockpit via a clean cutover —
the SSR routes are deleted in that release. The Hono server does not go away: it survives as the
cockpit's `/api/*` JSON backend plus static asset host. This ADR is the seam T5.10 builds against:
a typed contract, covering every read/write the cockpit needs, with the exact same security
posture as the SSR dashboard it's replacing.

Two things must NOT regress: the auth/CSRF/loopback/no-CORS posture locked by 0016 and FF-WEB-1,
and the audited-git-commit write semantics locked by 0019 (validate → write → commit → fail-closed
revert on hook rejection, per-session throttle, optimistic lock on `applications.yml`).

## Decision

### Endpoint inventory — full parity with the SSR feature set + the enumerated additions

Every SSR page's read data gets a JSON equivalent (`/api/overview`, `/api/applications`,
`/api/queue`, `/api/coaching`, `/api/content`, `/api/reporting`), the two existing v1.1 writes get
JSON equivalents (`POST /api/applications/:id/status`, `POST /api/debriefs`), and one new pair is
added: `GET`/`PUT /api/settings` (settings.yml did not have a web-writable surface before). No
other write capability is invented — the SSR dashboard has no queue-triage promote/dismiss forms
today, so none are added here; that decision is deferred to whoever specs it explicitly. A cheap
`GET /api/meta` (contract version, platform version, this session's CSRF token) doubles as the
"service status" placeholder — a dedicated status endpoint would be redundant at this scale. Full
endpoint table: `docs/MANUAL.md` §2.8.

### Contract types — a new package, not an extension of `shared-config`

`packages/api-contract` (new) holds the zod request/response schemas and inferred TS types, not
`packages/shared-config`. Justification: `shared-config` is the home for *config-file* schemas
(`models.yml`, `scan-targets.yml`, `settings.yml`) consumed by the CLI and MCP server — packages
that have nothing to do with the web dashboard. The `/api/*` wire contract is specific to
`apps/web` (server) and, from T5.10, `apps/web-ui` (client); folding it into `shared-config` would
make a CLI-facing package grow a web-only concern. `@selfwright/api-contract` depends on
`@selfwright/core` (reusing `APPLICATION_STATUSES`, `DebriefSchema`, `GapSchema`,
`EvidenceTagSchema` — no re-derivation) and `@selfwright/shared-config` (re-exporting
`SettingsSchema` rather than duplicating it), matching the existing adapter → shared-config
dependency direction already used by `llm-litellm`.

### CSRF for JSON writes — header token, not a hidden form field, same verification

0019's SSR forms embed the per-session CSRF token as a hidden `<input name="csrf_token">`. A JSON
request has no form. The cockpit fetches the token once from `GET /api/meta` (`csrfToken` field)
and resends it on every write as an `X-CSRF-Token` header. The token itself and its verification
are unchanged: the same per-session random `crypto.randomBytes(32)` value, checked with the same
`verifyCsrfToken()` (`timingSafeEqual`, missing treated identically to wrong, checked before body
validation). This is not weaker than the form-field mechanism: a custom request header cannot be
attached by a cross-site `<form>` submission, and — because this server never sends
`Access-Control-Allow-Origin` (no CORS is opened) — a cross-origin `fetch()` that tries to set the
header is blocked by the browser's own preflight enforcement before it ever reaches this server.
The existing `SameSite=Strict` cookie and fail-closed `Origin` check (0016) remain in place
underneath, unchanged, as they were always the primary defense.

### Auth — same session check, content-type-appropriate response

`/api/*` sits behind the same `app.use("*", authMiddleware)` as every other route (unchanged
position, unchanged session-validity check). Only the failure *response* differs by path prefix:
an unauthenticated SSR request still gets the 302-to-`/login` redirect; an unauthenticated
`/api/*` request gets a JSON `401` (`{ "error": { "code": "UNAUTHORIZED", ... } }`) instead,
because a `fetch()` caller cannot follow an HTML redirect the way a browser navigation can. Same
for `/api/*` 404s and 500s: a consistent JSON error envelope, never a stack trace or file path,
versus the SSR pages' plain-text generic messages.

### Write semantics — identical audited-commit path, one shared serialization queue

The JSON write handlers (`apps/web/src/api/applications.ts`, `api/coaching.ts`, `api/settings.ts`)
call the *same* `@selfwright/adapter-storage-git` primitives as the SSR write actions
(`applyStatusUpdate`, `appendDebrief`, `commitDataDirFile`, and the new `settings-store.ts`), with
identical validation limits (status vocabulary, note/list-item caps, control-character rejection —
now expressed as zod `.refine()`s in the contract package so both the schema and the check are one
artifact), identical throttle (`checkWriteThrottle`), and identical fail-closed revert on a
pre-commit hook rejection. The write-serialization lock (originally a private module-scoped queue
inside the since-deleted `routes/actions.ts`) lives in `apps/web/src/write-lock.ts` so every write
route shares exactly one queue — two independent queues would reintroduce the exact git-index-lock
race 0019's serialization was built to prevent. (This ADR was authored during T5.9, when SSR write
forms still coexisted with the JSON routes and both shared the lock; T5.10's clean cutover deleted
the SSR forms, so the lock now serializes the JSON write routes only — the invariant is unchanged.)
Verified with a dedicated test that fires two concurrent writes on the same application id and
confirms exactly one wins (2xx) while the other gets a clean `409`, never a corrupted working tree.

`GET`/`PUT /api/settings` is new capability, not present in 0016/0019. It reuses the identical
read → validate → write → commit → fail-closed-revert shape, validated by
`@selfwright/shared-config`'s `SettingsSchema` (already zod, already used by the CLI/scan path) —
designed additively so T5.11's settings.yml schema growth needs no endpoint change.

### FF-WEB-1 — adapted, not weakened

The static-scan fitness function that locks the dashboard's safety invariants needed three
adjustments to stay meaningful once a second (JSON) write surface exists, all documented in detail
in `docs/fitness-functions.md`:
- Assertion (e)'s write-route enumeration now also matches `app.put(...)` (for `PUT
  /api/settings`), and its "no matching GET" collision check applies only to `POST` routes — a
  `PUT` route pairing with a `GET` at the same path is standard REST (read + replace), not the
  regression the original check existed to catch.
- Assertion (f) (every write route calls `verifyCsrfToken(`) now scans all of `apps/web/src`
  instead of only `routes/actions.ts`, since JSON write handlers live under `apps/web/src/api/`.
- Assertion (g) (CSRF hidden form field) now applies only to non-`/api/*` write routes; a new
  assertion (h) is the JSON-contract equivalent — every `/api/*` write route must call the shared
  `getCsrfHeaderToken(` helper, one call per route, the same shape of check as (g).

Every adjustment widens or redirects the check's coverage; none removes a requirement a route
previously had to meet. Both new/changed assertions were verified with a manual negative control
(temporarily breaking a call site, confirming the expected failure message, reverting) before
landing — the same discipline 0019 established for (e)–(g).

### New fitness check — FF-APICONTRACT

A dedicated check (`fitness/src/checks/api-contract.ts`) gates the contract's own test suite:
structurally, that `apps/web/src/__tests__/api-contract.test.ts` exists and references every
documented endpoint path; behaviorally, that `vitest run` against exactly that file exits 0. The
suite itself runs against a hermetic `mkdtemp` + `git init` data dir, never the real one.

## What is NOT changed

Core stays I/O-free — all new logic lives in `apps/web`, `packages/adapters/storage-git`, and the
new `packages/api-contract` (itself dependency-free of any I/O). No new port. Tailscale Serve,
password/session auth, the loopback bind, and "read/write the git truth directly, never Postgres"
are all unchanged. The truth layer, drifts, and gaps remain read-only from the dashboard (the
coaching endpoint surfaces gaps for display; nothing writes them). No CORS is opened — `/api/*` is
same-origin only. The SSR pages are untouched and keep passing their existing test suite unchanged;
T5.10 deletes them in a later, separate release.

## Consequences

- T5.10's React cockpit has a stable, typed contract to build against, sharing types with the
  server via `@selfwright/api-contract` instead of hand-maintaining a parallel shape on each side.
- Two write surfaces (SSR forms, JSON API) now exist simultaneously during the T5.9→T5.10
  transition window; they are proven, by test, to serialize safely against the same data repo.
- `FF-WEB-1`'s scope widened from "one write surface" to "any number of write surfaces sharing the
  same CSRF/throttle/audit machinery," which should make future write-surface additions (if any)
  cheaper to gate correctly.

## Alternatives considered

- **Extend `shared-config` instead of a new package.** Rejected: would grow a CLI/MCP-facing
  config-schema package with a web-only wire contract, muddying its purpose.
- **CORS-enabled separate API service.** Rejected: adds a second listening surface and an
  attack-surface-widening CORS policy for zero benefit — the cockpit is same-origin static assets
  served by this same Hono process.
- **Bearer-token CSRF instead of a header carrying the existing session-bound token.** Rejected:
  would introduce a second credential type to manage/rotate; the existing per-session token is
  already the right shape, it only needed a transport that works for JSON.
- **Skip a per-surface write-lock audit and assume the existing queue would "just work."**
  Rejected: extracting the queue without proving both surfaces share it (rather than each closing
  over its own copy) is exactly the kind of subtle regression a security-critical write path
  cannot absorb silently — hence the dedicated cross-surface serialization test.
