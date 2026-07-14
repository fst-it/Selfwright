# 0007 — Deterministic scanner: job discovery, dedup, liveness, scan-time fit

*career_plan is treated as a proof-of-concept; its behavior is not authoritative for Selfwright.*

- Status: Accepted (2026-07-03)
- Supersedes: none. Implements T2.3 (anchor §10 Phase 2, D-7).

## Context

Phase 2's T2.3 calls for a deterministic scanner: role discovery across company career pages and
public ATS job-board platforms, dedup, liveness checking, scan-time fit, and an intake→queue
pipeline (anchor §6.2, "Scanning/Intake"). No LLM is involved — an unattended agent calling Claude
programmatically is incompatible with the "no API keys" constraint (D-7), so the scanner is, and
must remain, ordinary deterministic code.

The anchor's own accelerator list (D30, Appendix D) names `santifer/career-ops` as the intended
starting point. That repo — `https://github.com/santifer/career-ops` (MIT-licensed) — is a real,
independently popular open-source project ("AI-powered job search system... 14 skill modes"), not
to be confused with `santifer/cv-santiago`, an unrelated personal portfolio site that merely writes
*about* career-ops as a case study (confirmed by cloning and reading both repos directly before any
design work began, per the anti-hallucination protocol).

Two pieces of Selfwright's existing core already anticipated this work and are reused, not
rebuilt:
- `scorePosting(posting, archetypes, synonymMap)` (`packages/core/src/scoring/score.ts`) — a
  complete, already-tested 6-dimension scan-time fit rubric over a `Posting` shape
  (`title/company/location/description?`). This *is* the "scan-time fit" requirement.
  (Phase 4 update: `scorePosting` and `packages/core/src/scoring/priority.ts`'s
  `classifyIndustry`/`computePriority` gained a fourth parameter, `vocabulary:
  ScoringVocabulary`, per ADR 0017 — the industry-tier company names, Tier-0 anchors, and
  commodity-trading keywords that used to be hardcoded in those files are the owner's real
  targeting data and now live in the data layer, loaded via `loadScoringVocabularyFile`
  in `packages/adapters/storage-git`; a synthetic default ships in
  `packages/core/src/scoring/vocabulary.ts` so scan-time scoring degrades gracefully with
  no data layer present.)
- `QueueEntry` (`packages/core/src/services/types.ts`) and `Selfwright-data/pipeline/queue.yml`'s
  `{queue: QueueEntry[]}` shape, already read by `selfwright inbox`.

## Decision

### Architecture — hexagonal, a new bounded context

`packages/core/src/scanning/` (pure, no I/O): `types.ts` (`RawPosting`, `ScanTarget`,
`LivenessVerdict`, `SeenEntry`, `ScanResult`), `liveness.ts` (`checkLiveness`), `dedup.ts`
(`isSeen`, `dedupeByCompanyRole`), `queue-entry.ts` (`toQueueEntry`), `scan.ts`
(`evaluatePosting` — liveness + `scorePosting`), `orchestrate.ts` (`runScan` — the full fetch →
dedupe → liveness → score → partition pass). A new port, `ScanProvider`/`ScanFetchContext`
(`packages/core/src/ports/scan-provider.ts`), mirrors career-ops' `{id, detect, fetch}` provider
contract, keeping HTTP entirely out of core (FF-PORT-1). `runScan` takes a `providers:
Record<string, ScanProvider>` map as a parameter — concrete provider objects are constructed in the
app layer (CLI/MCP) from the adapter package and injected in, so core never imports the adapter
(dependency injection, not a service locator inside core).

`packages/adapters/scan-http/` (new driven adapter, the only place `fetch` is used): a real
`ScanFetchContext` (`http-context.ts`, native `fetch`, `redirect: "error"` on every call to guard
against SSRF via server-side redirect) and seven providers under `src/providers/` at initial ship:
`greenhouse`, `lever`, `ashby`, `workday`, `smartrecruiters`, `bamboohr` (all ported from the
real career-ops source, MIT-licensed, with credit in each file's header comment), plus `generic`
— a company-career-page fetcher for targets on no known ATS, built fresh for Selfwright (no
career-ops equivalent). Subsequent phases grew the HTTP provider set to 18 (adding oracle,
recruitee, personio, workable, breezy, adzuna, arbeitnow, remotive, himalayas, weworkremotely,
remoteok) and added a 19th browser provider (`workday-browser` in `packages/adapters/scan-browser`
— Playwright, for bot-gated Workday tenants, ADR 0012).

`config/scan-targets.yml` (new, loaded via `@selfwright/shared-config`'s `loadScanTargets`, same
convention as `models.yml`): the list of companies/providers to scan.

### Dedup ledger: a separate, permanent file — not folded into `queue.yml`

`Selfwright-data/pipeline/scan-history.yml` (new) records every fetched-and-scored posting
(`{url, firstSeen, source, status}`), forever, regardless of whether it was queued. `queue.yml`
stays exactly as it is today — the mutable, human-facing triage list `inbox` reads.

These serve non-overlapping lifecycles, so there is no synchronization problem between them: a
human triaging the queue removes an entry (promotes it to an application, or rejects it) — at that
point it must **stay** "seen" forever, or the next scan would re-surface a job already acted on.
career-ops hits this identical requirement and solves it the same way (a separate
`scan-history.tsv`, distinct from its `pipeline.md` triage checklist). The write path is one
direction, every run: fetch → classify liveness → **always** append to the seen ledger → if new,
live-or-uncertain, and it clears the fit-scorer's non-degeneracy floor (`grade !== "F"`, reusing
FF-FIT-1's bar, D-4) → **also** append a `QueueEntry`. No code path reconciles the two files
against each other after the fact.

### Liveness: HTTP status is a first-class signal, not just page text

`checkLiveness(pageText, opts?: {httpStatus, finalUrl})` (ported from career-ops'
`liveness-core.mjs`): 404/410 → expired; a Cloudflare/hCaptcha bot-challenge page (checked *before*
generic 403/503 handling) → uncertain, never expired (an expired classification would permanently
filter out a job that is actually still live); 403/503 → uncertain (access blocked, likely
anti-bot); a clear "no longer accepting applications" banner → expired; a visible apply-pattern
match → live; otherwise, content-length and listing-page heuristics as a fallback.

`RawPosting` carries optional `httpStatus`/`finalUrl` fields, populated only by single-page
fetchers (the `generic` provider, via `ctx.fetchRaw` which never throws on non-2xx) — the ATS
JSON-API providers fetch a whole board in one call, so no single posting has its own HTTP status;
`evaluatePosting` folds these into `checkLiveness`'s options automatically when present. **Found
and fixed during implementation, not merely designed correctly on paper:** an early version wired
`checkLiveness` to text-pattern-only classification for every provider, silently discarding
`httpStatus`/`finalUrl` even for `generic`. A live smoke test against a major travel portal's careers
page surfaced the gap; `evaluatePosting` now explicitly threads
`posting.httpStatus`/`posting.finalUrl` through, with tests proving a 403 classifies as
`"uncertain"` and a 404 as `"expired"` via the observed status, not text alone.

### iCIMS — investigated, not built; a documented fallback instead

career-ops has no iCIMS provider (confirmed by inspecting its `providers/` directory) — there is no
proven public JSON API pattern to port, and iCIMS tenants are typically fronted by stronger
bot-detection than Greenhouse/Lever/etc. An archived JD note from a real application
(`career_plan/20-applications/2026-06-travel-co-director-architecture/job-description.md`,
2026-06-18) already recorded "Portal returns HTTP 403 to automated fetch" for that portal.
A live check during this work (2026-07-03) found that URL no longer blocks a plain `fetch()`
request — bot-detection posture on a given portal can change over time — but this is not a
guarantee it will stay open. Per the user's own explicit fallback instruction, that same portal
is configured as a `generic`-provider target in `config/scan-targets.yml` rather than as a
dedicated iCIMS provider; if a portal does block automated fetches, the 403 now surfaces as an
`"uncertain"` liveness verdict (see above) rather than a crash or a silent empty result.

### Documented v1 simplifications (scope cuts, not oversights)

Following the precedent set in `dedup.ts`:
- **Ashby**: no 30s custom timeout; no compensation/`INTERVAL_MULTIPLIERS` annualization
  (`RawPosting` has no comp field). Rate-limit retry is now handled at the http-context layer.
- **Workday**: no inter-page delay and no date-based early-stopping. Full pagination (20 pages
  max, 400 postings) and rate-limit retry are now implemented.
- **SmartRecruiters**: pagination cap raised from v1's 3 pages to 10 (1000 postings). Rate-limit
  retry handled at the http-context layer.

### Phase 2 improvements shipped (post-v1)

- **Fuzzy dedup** (`dedup.ts`): `dedupeByCompanyRoleFuzzy` using Jaccard ≥ 0.5 on
  stopword-filtered title tokens. Exports `areSimilarTitles`. `orchestrate.ts` now uses the fuzzy
  version. FF-SCAN-2 updated to test the seniority-variant collapse ("Senior Engineer" ≈
  "Sr. Engineer"). `dedupeByCompanyRole` (exact) retained for backward compatibility.
- **Provider resilience** (`http-context.ts`): `withRetry` wraps `fetchJson`/`fetchText` with
  exponential backoff (base 1s, max 30s) on HTTP 429 responses (rate-limited), max 3 retries.
  Does not retry 5xx — those propagate immediately as genuine failures.
- **Workday full pagination** (`workday.ts`): loop up to MAX_PAGES = 20, exits on short page.
- **SmartRecruiters page cap** (`smartrecruiters.ts`): raised from 3 to 10 pages (1000 postings).

Greenhouse, Lever, and BambooHR are faithful, complete ports (no simplification needed — they're
each a single unpaginated or lightly-paginated request).

### Peer-review findings, fixed before merge

An independent adversarial review of this diff (post-implementation, pre-merge) found two real
issues, both fixed:

- **`generic.ts`'s tag-stripping was O(n²) on pathological input.** `stripHtml`/`extractTitle` used
  backtracking regexes (`/<[^>]+>/g` and similar) — reproduced live: a ~160,000-character run of
  bare `<` with no closing `>` took ~12s; a ~1MB payload didn't finish inside a 3-minute timeout.
  Since the scanner is single-threaded, one `generic`-provider target returning such a body (a
  WAF/error page, code samples, broken markup — not necessarily adversarial) stalls the entire scan
  pass, not just that target. Rewritten as a single indexOf-driven linear pass — genuinely O(n)
  regardless of input shape — with a 2M-character cap as a sane ceiling, not the fix itself.
- **Ashby/Lever's `resolveApiUrl` matched the API host with an unanchored regex against the raw
  `careersUrl` string**, so `https://evil.example/jobs.lever.co/acme` would also match. Confirmed
  *not* currently exploitable — the derived request always targets the hardcoded `api.{lever,
  ashby}` host, never the matched substring — but fragile: a future edit reusing the match for
  anything host-related would silently reintroduce an SSRF path. Both now parse `careersUrl` as a
  real `URL` and check `.hostname` exactly, matching the pattern Greenhouse/SmartRecruiters/
  BambooHR already used.

## Consequences

- `FF-SCAN-1` (scan-liveness) and `FF-SCAN-2` (scan-dedup) — new Tier-1 fitness checks
  (`fitness/src/checks/scan-{liveness,dedup}.ts`), synthetic fixtures, no `SELFWRIGHT_DATA_DIR`
  needed.
- New CLI command `selfwright scan [--targets <path>] [--dry-run]` and MCP tool `scan` (same
  `runScan` core function underneath both — no duplicated orchestration logic between the two
  apps, unlike some other cross-cutting glue in this codebase that is duplicated between CLI/MCP).
- This is the first outbound-HTTP-during-normal-operation adapter in Selfwright. It is
  **inbound-only**: it fetches public job postings and sends no private data anywhere — consistent
  with the data-leak gate and D25. `FF-LLM-1` (no default API-key adapter) is unaffected; the
  scanner never calls an LLM.
- **Deferred (named, not forgotten):** Ashby per-request timeout (no AbortController yet —
  a hanging Ashby fetch stalls the scan pass); a dedicated iCIMS provider (revisit only if a real
  target portal turns out to expose a stable, scrapable pattern); Playwright-based browser
  verification of liveness (career-ops' `--verify` mode, planned for Phase 3) — this scanner is
  fetch-only.

## Alternatives considered

- **Fold the dedup ledger into `queue.yml` itself** (extend `QueueEntry` with a `source_url`/
  `discovered_at` field, drop the separate file). Rejected: `queue.yml` is a mutable triage list —
  entries are expected to be removed once acted on — while dedup needs a permanent record
  independent of that lifecycle. Folding them together would mean a promoted-then-removed job
  could resurface on the next scan. Raised directly by the user during design; the separate-file
  answer above is the response to that question, not an unexamined default.
- **Port career-ops' full retry/backoff/pagination sophistication for every provider immediately.**
  Rejected for this task's scope: real, meaningful engineering effort for behavior (surviving rate
  limits on very large tenants) that doesn't block a working v1. Each simplification is named above
  so it reads as a deliberate scope cut, not a silently-abandoned corner.
