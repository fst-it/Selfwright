# 0024 — Queue-triage write actions: promote and dismiss

- Status: Accepted (2026-07-13, owner-approved)
- Supersedes-in-part: 0016 (`0016-local-web-dashboard.md`), specifically the "no write action
  currently qualifies as cheap... inbox dismissal would need a ledger that didn't exist" framing
  for the queue-dismiss case. 0019 and 0023 are unchanged and extended, not replaced: the same
  validate → write → commit → fail-closed-revert pattern (0019), the same session/CSRF/origin/
  throttle/write-lock posture and JSON error envelope (0023), and FF-WEB-1's assertions all apply
  unchanged to the two new write routes this ADR adds.

## Context

T5.10 (the React cockpit) specs a queue-triage page with promote/dismiss actions on each queue
entry. Neither capability exists anywhere in the platform today: ADR 0023 explicitly noted "the
SSR dashboard has no queue-triage promote/dismiss forms today, so none are added here; that
decision is deferred to whoever specs it explicitly." This ADR is that spec. It is a new write
capability (not an extension of an existing one), so it gets its own ADR rather than folding into
T5.10's page-building work.

ADR 0007 (the deterministic scanner) already names the conceptual lifecycle: "a human triaging the
queue removes an entry (promotes it to an application, or rejects it) — at that point it must
*stay* 'seen' forever, or the next scan would re-surface a job already acted on." No code anywhere
— not the CLI, not the MCP server, not any skill — implements "promote" today. The only existing
building blocks are `packages/core/src/scanning/types.ts`'s `QueueEntry` (the persisted shape) and
`packages/core/src/services/types.ts`'s `ApplicationRecord` (the target shape, which already
carries an unused `dates.promoted?: string` field — evidence this was anticipated but never
wired up).

## Decision

### 1. Promote semantics: QueueEntry → new ApplicationRecord, field by field

`packages/core/src/services/queue-promote.ts` (`promoteQueueEntry(entry, today)`), pure, no I/O:

| ApplicationRecord field | Source |
|---|---|
| `id` | The queue entry's own `id`, reused as-is (not a new scheme). Entry ids are already unique and collision-free (`SCAN-<hash>` for scan-derived entries, a dedup-checked id for `queue-add` manual entries) — reusing it makes the resulting application traceable back to the exact queue/scan-history record it came from, at zero extra cost. `"APP-NNN"` in the existing fixtures is a convention, not an enforced format, so this does not violate anything. |
| `company` | Carried over as-is. |
| `role` | `derived_role`, or `"Unknown role"` if absent. |
| `status` | `"evaluating"` — a queue entry has already cleared scan-time scoring and triage (past "discovered"); promoting it means the human is now deciding whether to actually apply, which is exactly what `"evaluating"` denotes in the canonical `APPLICATION_STATUSES` vocabulary. |
| `fit_score` | Carried over as-is (`null` if absent). |
| `dates.discovered` | `queuedAt` truncated to `YYYY-MM-DD`, or `today` for legacy entries with no `queuedAt` (pre-T5.5). |
| `dates.promoted`, `dates.last_update` | `today`. |
| `channel`, `ats_score`, `notes` | Left unset. None of this exists on a `QueueEntry`: `channel` is a submission-channel concept (referral/portal/direct) unrelated to which ATS board a posting was scanned from; `ats_score` is computed at CV-tailoring time, not scan time; there is no scan-time note field to carry. |

**No posting URL is carried over, and this is a real, checked finding, not an oversight:**
`QueueEntry` does not store one. The URL only ever lives in the separate `scan-history.yml` seen
ledger (ADR 0007); `queue.yml` intentionally never duplicates it. A reader might expect the
promoted application to link back to the posting — it can't, because the data to do so was never
persisted in `queue.yml` in the first place. Fixing that is future scope (see "Not changed"),
not invented here.

The composition (removing the entry from `queue.yml`, appending the record to
`applications.yml`, committing both) lives in `apps/web/src/api/queue.ts`, matching the existing
convention that `packages/core` supplies pure domain functions and `apps/web` +
`packages/adapters/storage-git` supply the I/O.

### 2. Dismiss semantics: clean removal, no dismissal ledger

ADR 0016 flagged "inbox dismissal would need a ledger that didn't exist" as the reason dismiss was
out of scope for v1. That concern doesn't apply here once resurfacing-prevention is examined
directly: `scan-history.yml` (ADR 0007) already records **every** fetched-and-scored posting's
URL, permanently, the moment it is first scanned — regardless of whether it was ever queued, and
independent of anything that later happens to the `queue.yml` entry. A scan run re-encountering
that URL will see it in the seen ledger and skip re-queueing it, whether the `queue.yml` entry
was dismissed, promoted, or simply still sitting there. **Resurfacing-prevention already does not
depend on keeping a queue entry around after triage — a ledger would add nothing dismiss
actually needs.**

Decision: dismiss is a **clean removal** from `queue.yml` (`removeQueueEntry` in
`packages/adapters/storage-git/src/queue-store.ts`), no separate dismissals section or file. The
git commit that removes the entry (`web: dismiss <company> (<date>)`, naming the company in the
message the same way `web: promote` does) is the audit trail — identical in kind to every other
write in this app, where "the git history of the data repo *is* the audit log" (ADR 0019). This
is a **narrower** question than the one 0016 deferred: 0016 was weighing a general "inbox item
dismissal" ledger across applications/queue/drifts/content; this ADR only ever removes a
`QueueEntry` from `queue.yml`, a single well-scoped operation with an existing lifecycle owner
(the scan/dedup system) that already solves the one problem a ledger would exist to solve.

Backward compatibility: `removeQueueEntry` operates on the existing `{ queue: QueueEntry[] }`
shape unchanged — no migration, no new top-level key, no schema version bump.

### 3. Audited git-commit write semantics — same pattern as ADR 0019, with one extension

Both writes follow ADR 0019's pattern exactly: `checkOrigin` → session lookup → `verifyCsrfToken`
(header token, per ADR 0023) → `checkWriteThrottle` → `withWriteLock` → read → mutate → write →
`commitDataDirFile` → on failure, revert the file(s) to their pre-write content and surface the
hook's stderr as a `422`.

**Extension: `commitDataDirFile` now accepts `string | readonly string[]`.** Promote must move
one queue entry into one new application record — two files — in a single atomic commit, not two
separate commits. Two commits would create a window where `queue.yml` has already dropped the
entry but `applications.yml` doesn't have it yet (or a failure between the two commits leaves the
entry permanently lost). `commitDataDirFile(dataDir, [QUEUE_REL, APPLICATIONS_REL], message)`
stages and commits both paths together; a single string still behaves exactly as before (every
existing caller — status update, debriefs, settings — is unaffected). On hook rejection, both
paths are unstaged and both files are reverted to their pre-write snapshots (or, for
`applications.yml`, to `stringifyYaml([])` if this would have been the very first application
ever recorded — mirroring the existing "delete on first-ever write" convention from
`addDebriefRoute`/`putSettingsRoute`).

Commit message family: `web: promote <company> - <role> (<date>)`, `web: dismiss <company>
(<date>)` — same shape as `web: status ...` / `web: debrief ...`.

No optimistic-lock content hash on either write (unlike the status-update write's
`hashApplicationsContent` check): both operations act on `queue.yml`, which has no
client-visible content-hash contract field today (`QueueResponseSchema` doesn't expose one), and
the existing global write-lock plus a `NOT_FOUND` on a since-removed id already make a concurrent
double-action safe (the loser gets a 404, not a corrupted file) without adding a new field to the
wire contract for a narrow race window.

### 4. New contract schemas

`packages/api-contract/src/queue.ts` adds:
- `PromoteQueueEntryResponseSchema` — `{ application: ApplicationRecordSchema }`, reusing the
  existing `ApplicationRecordSchema` from `applications.ts` (not a duplicate declaration) so the
  two response shapes can never silently drift apart.
- `DismissQueueEntryResponseSchema` — `{ dismissed: QueueEntrySchema }`.

Both request bodies are empty (`{}`) — everything the operation needs is already in the URL's
`:id` param and the session's CSRF token; there is nothing else for the client to submit.

### 5. New endpoints

`apps/web/src/api/queue.ts` adds `promoteQueueEntryRoute` and `dismissQueueEntryRoute`, wired in
`app.ts` as:

- `POST /api/queue/:id/promote` — 201 with the new `ApplicationRecord` on success; 404
  `NOT_FOUND` for an unknown id; 409 `CONFLICT` if an application with that id somehow already
  exists (defensive — not expected in practice, since queue ids and pre-existing application ids
  come from disjoint namespaces).
- `POST /api/queue/:id/dismiss` — 200 with the removed `QueueEntry` on success; 404 `NOT_FOUND`
  for an unknown id.

Both: `FORBIDDEN_ORIGIN` (missing/mismatched Origin), `FORBIDDEN_CSRF` (missing/wrong header
token), `RATE_LIMITED` (429 past the per-session write throttle), `HOOK_REJECTED` (422, pre-commit
hook rejection, file(s) reverted), `CONFLICT`/`INTERNAL_ERROR` (500) for git-level failures — the
same `ApiErrorCode` vocabulary every other write route already uses; no new error codes were
needed.

### 6. Tests and fitness accounting

`apps/web/src/__tests__/api-contract.test.ts` gains contract tests for both routes (missing/wrong
CSRF, missing origin, unknown id, successful write with schema `.parse()` on the live response,
pre-commit hook rejection with a revert assertion for both files on promote, and a 429 throttle
test), following the exact pattern already used for the other five write routes.
`fitness/src/checks/web-safety.ts` (FF-WEB-1) needed **no code changes**: its write-route
detection is generic regex scanning over `app.post(...)`/`app.put(...)` call sites and
`verifyCsrfToken(`/`getCsrfHeaderToken(` call counts, so the two new routes are picked up
automatically and FF-WEB-1's clause (e)/(f)/(h) counts now include them without any check-file
edit. `fitness/src/checks/api-contract.ts`'s `DOCUMENTED_ENDPOINTS` already contains `"/api/queue"`,
which is a substring of both new route paths and therefore already gates their presence in the
contract test file; no entry was strictly required, but `"/promote"` and `"/dismiss"` were added
as explicit, self-documenting entries per the owner's directive.

## What is NOT changed

- Core stays I/O-free: `promoteQueueEntry` is a pure mapping function; the write/commit logic
  lives in `apps/web` + `packages/adapters/storage-git`, exactly like every other write action.
- No posting URL is added to `QueueEntry` or carried through to the promoted `ApplicationRecord`
  — that would be a `QueueEntry` schema change (affecting the scanner, `queue-add`, and every
  existing `queue.yml`), out of scope for a write-action ADR. Flagged as a real gap, not silently
  worked around.
- The truth layer, drifts, gaps, and settings writes are untouched.
- `scan-history.yml`'s own lifecycle (write-once, append-forever) is untouched — dismiss/promote
  never touch it, because they don't need to (see "Dismiss semantics" above).

## Consequences

- The cockpit's queue-triage page (T5.10) can promote a high-fit queue entry into a real
  application, or dismiss one the owner has decided to pass on, from the phone or the browser —
  closing the gap ADR 0023 explicitly deferred.
- `commitDataDirFile`'s widened signature is a strict superset of its previous behavior — no
  existing caller changes, and the new multi-path form is exercised by both the promote endpoint
  and its own dedicated test.
- A promoted application has no link back to the original posting URL. Any future work that wants
  one must first decide whether `QueueEntry` (and therefore every producer of `queue.yml`: the
  scanner, `queue-add`, and every existing on-disk `queue.yml`) should carry a URL field — a
  separate, larger decision this ADR deliberately does not make.

## Alternatives considered

- **A separate `dismissals.yml` ledger recording reason/timestamp per dismissed entry.** Rejected:
  the only thing a ledger would need to guarantee — "a dismissed posting never resurfaces" — is
  already guaranteed by `scan-history.yml`'s independent, write-once lifecycle. Adding a second
  ledger that tracks the same fact a different way is duplication with no behavioral benefit, and
  the git commit history already answers "what was dismissed and when."
- **Soft-delete (a `dismissed: true` flag left on the queue entry) instead of removal.** Rejected:
  the queue-triage page and `GET /api/queue`/`selfwright inbox` would then need a filter everywhere
  they read `queue.yml`, for a state no consumer needs to distinguish from "gone" — nothing in this
  codebase currently asks "show me dismissed entries." Removal is simpler and matches how
  `applications.yml` status updates already work (in place, no soft-delete tombstones elsewhere).
- **Two separate commits for promote (one per file).** Rejected: creates a window where the two
  files disagree about whether the entry was promoted, and a mid-sequence failure could lose the
  entry entirely (removed from the queue, never added to applications). One atomic commit across
  both paths avoids both failure modes.
- **Requiring a `contentHash` optimistic lock on queue writes, mirroring the status-update write.**
  Rejected for this iteration: `queue.yml` has no existing content-hash contract field, the global
  write-lock already serializes concurrent writers, and a since-removed id already fails closed
  with `NOT_FOUND` — adding a hash field to the wire contract for a narrow, already-safe race
  isn't justified yet. Revisit if real concurrent-triage usage surfaces a problem this doesn't
  cover.
