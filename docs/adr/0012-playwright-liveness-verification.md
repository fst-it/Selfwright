# 0012 — Playwright as an optional, opt-in browser-based liveness verifier

- Status: Accepted (2026-07-09)
- Supersedes: none. Implements T3.1 (anchor §10 Phase 3; the "Playwright-based browser
  verification of liveness" item ADR 0007 named and deferred to Phase 3).

## Context

ADR 0007's scanner is fetch-only, and `checkLiveness`'s tri-state heuristic
(`packages/core/src/scanning/liveness.ts`) already resolves the common cases from a plain-HTTP
response and page text. It explicitly punts to `"uncertain"` on the cases a plain `fetch()`
structurally cannot resolve: an anti-bot interstitial (Cloudflare "Just a moment...", hCaptcha)
that only clears for a real browser; a 403/503 that could mean genuine blocking or could mean
nothing about the posting itself; and a JS-hydrated single-page app whose real content never
appears in the raw HTML a plain fetch sees. ADR 0007 named this gap and deferred the fix to
Phase 3 rather than guessing at a solution before it was in scope.

career-ops (the scanner's own accelerator, ADR 0007) has a `--verify` mode for this same problem,
but its Playwright usage isn't ported here — no local copy of that repo was re-cloned for this
task, and browser automation for a liveness check is standard enough (`goto` + read the rendered
text) not to need porting foreign code for it. Per the anchor's own framing, career-ops is
POC-reference-only, not authoritative.

The real constraint is dependency weight. Playwright ships a full Chromium (and, if you let it,
Firefox/WebKit) — on the order of hundreds of MB — for a solo, local-first tool where most scan
runs will never ask for a browser-backed re-check. This must not become a tax on every `pnpm
install`.

## Decision

### Scope: re-verify "uncertain" only, opt-in only

Browser re-verification only ever targets postings that already came back `"uncertain"` from the
existing HTTP-only path (`packages/core/src/scanning/orchestrate.ts`). `"live"`/`"expired"`
verdicts are never re-checked — re-checking `"live"` adds cost for no benefit, and re-checking
`"expired"` risks a browser-rendering quirk resurrecting a genuinely dead posting. This is also
opt-in at the CLI/MCP layer (`--verify` / `verify: true`) — a scan run that never passes it never
launches a browser, never depends on Chromium being installed, and behaves exactly as it did
before this ADR.

### Port: `ScanFetchContext.fetchRendered` (optional)

`packages/core/src/ports/scan-provider.ts`'s `ScanFetchContext` gains one optional method,
`fetchRendered?(url): Promise<RawFetchResult>` — the same return shape `fetchRaw` already uses
(`{status, text, finalUrl}`), so the caller can feed it straight into `checkLiveness()` without a
new type. Optional, so the existing plain-HTTP context (`createHttpScanContext`) is unaffected and
every other `ScanFetchContext` implementer keeps compiling unchanged. `packages/core` never
imports Playwright — it only sees this narrow optional function signature, keeping FF-PORT-1
(generic dependency-cruiser check, `packages/core/src` → zero adapter/npm imports beyond `zod`)
satisfied with no changes to the check itself.

`orchestrate.ts`'s `runScan` loop calls `ctx.fetchRendered` only when a posting's verdict is
`"uncertain"` and the method is present, re-runs `checkLiveness` against the rendered
text/status/finalUrl, and replaces the verdict if the browser re-check produced one. A rejected
`fetchRendered` call (crashed launch, navigation timeout, Chromium not installed) is caught,
logged as a warning (reusing the existing `providerErrors` bucket, the same "non-fatal, scan
continues" convention already used for a failed provider fetch or an unknown provider name), and
the posting keeps its original `"uncertain"` verdict — a browser failure never aborts the scan
pass. `RunScanStats` gains `browserVerified: number`, counting re-verify *attempts* (the cost
paid — a browser launch/page load) rather than only successes, so an operator can see how often
the run paid for a browser round-trip regardless of outcome.

### Adapter: `packages/adapters/scan-browser`

New package `@selfwright/adapter-scan-browser`, mirroring `scan-http`'s shape.
`createBrowserVerifyContext()` lazily launches one headless Chromium instance on the *first*
`fetchRendered()` call — never at construction, since most scan runs never hit an `"uncertain"`
verdict at all and shouldn't pay a browser-launch cost they don't need. The same instance is
reused across every `fetchRendered()` call within one scan run; the caller (CLI/MCP) calls
`close()` once the run finishes, which is a no-op if the browser was never launched.

Navigation uses `waitUntil: "domcontentloaded"` plus a fixed 2s settle window, deliberately not
`"networkidle"`: career pages commonly keep background polling/websockets alive indefinitely,
which would make `"networkidle"` wait out the full 15s timeout on pages that have already
rendered everything needed. `domcontentloaded` + a short bounded wait is a pragmatic compromise —
enough time for a Cloudflare challenge to clear or a client-rendered app to hydrate, without
risking every re-check paying the full timeout. Rendered text comes from `page.innerText("body")`
(the actual visible, rendered text a user would see), not `page.content()` — this avoids
reimplementing `scan-http`'s own HTML-stripping logic a second time for no benefit, since
`checkLiveness` only ever pattern-matches against visible text anyway.

**SSRF: pinning the final hostname post-navigation.** Every fetch-based provider in `scan-http`
treats a pinned final hostname as load-bearing SSRF protection — `redirect: "error"` at the fetch
layer plus a per-provider hostname check (`bamboohr.ts`, `ashby.ts`, `lever.ts`, etc.) means a
server-side redirect can never bounce the request off-domain. Playwright's `page.goto()` has no
`redirect: "error"` equivalent — it always follows redirects. `fetchRendered` reproduces the same
guarantee after the fact instead: once navigation settles, `new URL(page.url()).hostname` is
compared against the originally-requested URL's hostname, and a mismatch throws (caught by
`orchestrate.ts`'s existing try/catch, same as any other re-verify failure — the posting simply
keeps its prior `"uncertain"` verdict rather than being upgraded from rendered content fetched off
the intended host). Caught in independent review before this ADR's first draft shipped — an
earlier version had no such check at all.

**`close()` on a failed launch.** If Chromium was never installed (`npx playwright install
chromium` skipped) or `launchFn()` otherwise rejects, that failure is cached (the same rejected
promise backs every subsequent `fetchRendered` call, so a broken environment fails identically and
immediately for every posting rather than re-attempting a doomed launch each time). `close()`
swallows that cached rejection rather than re-awaiting and re-throwing it — without this, a scan
run that already completed successfully (results computed, `queue.yml`/`scan-history.yml` already
written) would crash on cleanup in the CLI, or have its correctly-computed MCP tool response
replaced by an error, purely because `--verify` was passed on a machine without Chromium
installed. Also caught in independent review, verified against the shipped code before being
fixed.

**Testability — dependency injection, not module mocking.** `createBrowserVerifyContext(launchFn?)`
takes an injectable `LaunchFn`, defaulting to a real `chromium.launch({headless: true})` wrapped in
a function excluded from coverage (`/* v8 ignore start/stop */`) — the same pattern
`llm-claude-cli`'s `ClaudeCliAdapter` already uses for `child_process.spawn` (a narrow
`SpawnFn`/`SpawnedProcess` surface, injected, with the real OS-level call ignored from coverage).
Tests inject a fake `LaunchFn` returning a fake `MinimalBrowser`/`MinimalPage` — no real browser,
no `vi.mock("playwright", ...)`, and no dependency on Chromium being installed in CI. This also
avoids `@typescript-eslint/unbound-method`: assertions hold onto the raw `vi.fn()` handles
returned alongside the fake object rather than reading a method off the interface-typed fake
directly (again mirroring how `claude-cli-adapter.test.ts` asserts against `child.stdinWrite`
rather than `child.stdin.write`).

### Dependency footprint: no special pnpm gating needed

This repo already gates arbitrary dependency postinstall/build scripts via `pnpm-workspace.yaml`'s
`allowBuilds` allowlist (currently `esbuild`, `lefthook`) — pnpm 11 does not run a package's
lifecycle scripts unless explicitly allowed. The initial expectation going into this task was that
`playwright` would need the same gating to stop `pnpm install` from auto-downloading a ~300MB
Chromium for everyone. Checked directly rather than assumed: `playwright@1.61.1` and
`playwright-core@1.61.1` ship with **no `scripts` field in `package.json` at all** — there is no
postinstall browser download to gate in the first place. Modern Playwright's browser install is
already a fully manual, explicit step (`npx playwright install chromium`) regardless of package
manager. So `pnpm install` picking up this new dependency stays fast and small (confirmed: `+2`
packages, `playwright` + `playwright-core`, no other footprint) — no `allowBuilds` entry was added,
because there was nothing to add one for.

`npx playwright install chromium` remains a one-time manual step for anyone who wants `--verify`
to actually work; if it hasn't been run, `chromium.launch()` throws a clear "executable doesn't
exist" error, which `orchestrate.ts`'s per-posting try/catch surfaces as a warning rather than a
crash (see above) — graceful degradation, not a hard requirement.

## What is NOT changed

`ScanProvider`/provider `fetch()` never call `fetchRendered` — it exists solely for
`orchestrate.ts`'s re-verify step, not as a general-purpose alternative fetch path providers could
opt into. No provider was changed. `checkLiveness` itself is unchanged; the browser path re-runs
the exact same function against different input, rather than duplicating its pattern logic.

## Consequences

- `--verify` (CLI) / `verify: true` (MCP tool input) opts a scan run into browser re-verification;
  omitting it reproduces T2.3/Phase 2 behavior exactly, including on machines with no Chromium
  installed.
- Scan wall-clock time increases only for runs that both pass `--verify` and actually encounter
  `"uncertain"` postings — bounded per-posting by the 15s navigation timeout plus the 2s settle
  window.
- `FF-PORT-1` needed no changes — its dependency-cruiser rules are generic path globs
  (`packages/core/src/` → `packages/adapters/` etc.), so the new adapter package is covered
  automatically.
- No new fitness function was added for this task. `checkLiveness` itself is already covered by
  FF-SCAN-1; the re-verify branch is ordinary feature logic (covered by `orchestrate.test.ts`), not
  an architectural invariant worth a permanent regression gate — revisit if real usage surfaces a
  regression worth guarding against.

## T5.4 amendment — Workday browser listing provider (2026-07-12)

Some Workday tenants are bot-gated: a plain HTTP POST to the CXS endpoint returns HTTP 422
regardless of headers, where the same request works when issued from inside a real browser page
(the cookies the browser acquires navigating the listing page are accepted; a cold server-side POST
is not). The existing `workday` provider in `scan-http` documents this and leaves those tenants as
`# TODO: browser`. T5.4 closes that gap.

### New surface: `createWorkdayBrowserProvider`

`packages/adapters/scan-browser/src/providers/workday-browser.ts` adds a second exported
provider. Unlike `createBrowserVerifyContext` (which re-checks individual posting liveness), this
one drives the *listing* fetch — it has `detect()` / `fetch()` like every other `ScanProvider` and
is registered as provider id `workday-browser` in the CLI's `scanProviders` dict.

**In-page CXS first, DOM fallback second.** The provider navigates to the tenant's public listing
URL, then calls `page.evaluate(jsScript)` — a string-form evaluate rather than a function callback,
because `tsconfig.base.json` uses `"lib": ["ES2022"]` with no DOM lib, so `document`, `HTMLElement`,
and browser-side `fetch` are not in scope for TypeScript to type-check inside a function callback.
The string eval runs inside the browser where those globals exist at runtime. The in-page fetch
sends a CXS POST with the page's own cookies — the same approach the browser uses when a user
navigates the site. If the CXS response is non-2xx or the parsed count is zero, the provider falls
back to DOM extraction using Workday's stable `data-automation-id` attributes (`jobItem`,
`jobDetailsLink`, `jobLocations`, `paginationNextButton`). Both paths paginate up to
`MAX_PAGES=20`; `POLITENESS_DELAY_MS=2000` (a named constant, not a bare literal) is waited
between requests/page-clicks.

**SSRF.** `assertPubliclyRoutableUrl` + `assertDnsResolvesPublicly` run before the browser
launches. The `resolveEndpoint` function (regex copied from the existing `workday.ts` for
consistency) requires `https://`, so non-HTTPS targets are rejected before URL-guard even runs.
Posting URLs are validated against an allowlist: same-origin with the tenant site, or
`*.myworkdayjobs.com` using the leading-dot suffix pattern (`h.endsWith(".myworkdayjobs.com")`) —
matching the `adzuna.ts` `isAllowedPostingUrl` precedent from T5.3 that replaced an over-permissive
regex. Post-navigation off-host redirect check uses the same `page.url()` hostname comparison that
T3.1 established.

**Never-silent.** 0 postings after a successful navigation → stderr warn naming the tenant.
`MAX_PAGES` truncation → stderr warn with fetched/estimated counts. Navigation error → stderr warn
+ the target is isolated (error returned rather than crashing the whole scan run).

**Lazy lifecycle, same as T3.1.** `createWorkdayBrowserProvider()` returns a
`ScanProvider & { close(): Promise<void> }`. The browser is launched on the first `fetch()` call,
reused for all subsequent targets in the same scan run, and closed in the CLI `finally` block.

**Testability.** 27 unit tests. Injectable `ListingLaunchFn` defaults to
`chromium.launch({headless: true})` (excluded from coverage with `v8 ignore`). Tests inject a fake
that returns typed `MinimalListingBrowser` / `MinimalListingPage` objects built from raw `vi.fn()`
handles. The same `@typescript-eslint/unbound-method` convention from T3.1 applies: assertions use
the raw handles from the fake builder, not property accesses through the interface-typed object.

**`skipLibCheck` note.** With `skipLibCheck: true`, Playwright's `Browser` structurally satisfies
`MinimalListingBrowser` without an explicit cast — the `return chromium.launch(...)` in the default
launch wrapper does not need `as unknown as MinimalListingBrowser`.

### CLI wiring

`apps/cli/src/index.ts` constructs `workdayBrowserProv` inside the scan action and merges it into a
local `scanProviders` dict (alongside the static `SCAN_PROVIDERS` constant) instead of mutating the
module-level constant. The `finally` block calls `workdayBrowserProv.close()`. The static constant
itself is unchanged — `workday-browser` is not present in it, keeping the module-level dict clean.

## Alternatives considered

- **Always browser-first, instead of HTTP-first with browser re-check.** Rejected: far more
  expensive/slow for the common case where a plain fetch already gives a confident verdict: most
  postings are unambiguously live or expired without ever needing a browser.
- **`playwright-core` + require a system-installed Chrome.** Rejected: trades a larger bundled
  download for environment fragility (which Chrome, which version, where) on a solo dev machine —
  not worth it for a tool with exactly one real user and one real environment.
- **Fold this into the existing `scan-http` package instead of a new one.** Rejected: keeps
  `scan-http` dependency-light (no consumer of it is forced to resolve `playwright` transitively
  for a capability they may never enable) and matches this codebase's existing one-adapter-per-
  concern convention (`llm-litellm`/`llm-claude-cli`/`llm-ollama` are separate packages despite
  all implementing the same `LlmPort`).
- **Re-verify `"live"` and `"expired"` too, for extra confidence.** Rejected: no named failure mode
  in ADR 0007 or in practice motivates second-guessing a confident verdict, and doing so would
  multiply browser cost by the scan's entire result set instead of just its ambiguous tail.
