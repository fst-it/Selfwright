# 0016 — Local web cockpit: React SPA over typed /api/* JSON, behind Tailscale + app auth

- Status: Accepted (T3.6, 2026-07-08; rewritten in place T5.13, 2026-07-13 — living ADR
  convention, docs/adr/README.md). Prior stack (Hono JSX SSR) is recorded in git history.
- Supersedes: none. Implements T3.6 + T5.10. Consciously overrides anchor §13 ("markdown +
  chat + push, not a bespoke web app — until proven necessary"). References ADR 0019 (write
  actions), 0023 (/api/* contract), 0024 (queue promote/dismiss).

## Context

T3.6 shipped `apps/web`, a local web dashboard. The anchor §13 override — the owner wants an
at-a-glance view reachable from his iPhone, outside the home network, which a terminal cannot
serve — is the original proof of necessity. Because the dashboard renders PII (applications,
comp figures, named contacts), the privacy boundary below is what makes the override safe.

By T5.10 the cockpit had grown from a read-only summary page into the primary daily workflow
surface: pipeline board with status transitions, queue triage with promote/dismiss, debrief
capture, settings management. SSR handled read pages but made the interactive features
awkward — each action needed a full page round-trip, and the pipeline board's sort/filter
state had no clean home in server-rendered HTML. The typed /api/* contract (ADR 0023, T5.9)
already existed, which made a React SPA the natural next step: the client consumes JSON from
the same Hono server, and the boundary is enforced by FF-APICONTRACT rather than by
convention. The SSR pages were deleted in the same T5.10 release; no dual-run period.

`apps/web` survives T5.10 as: /api/* JSON routes + static host for the cockpit bundle + SPA
fallback + the still-server-rendered login page (deliberately server-side, so auth decisions
happen before any cockpit code loads). `apps/api` remains a 1-line stub.

Two prior boundaries still constrain everything here. Anchor §4.3: "no data leaves the machine
except the private GitHub repo; Anthropic is the one accepted processor; no other third party
gets data." ADR 0009/0015: Postgres is a rebuildable projection; nothing reads back from it
into core, and the dashboard follows the same rule.

## Decision

### Remote access — Tailscale Serve, not Cloudflare Tunnel (§4.3 forces it)

Remote reach is via an authenticated tunnel only, never raw port-forwarding. Cloudflare Tunnel
terminates TLS at Cloudflare's edge — Cloudflare would see plaintext PII in transit, making it
a second data processor in direct conflict with §4.3. That disqualifies it despite
`cloudflared` being installed. **Tailscale is chosen.** Its data plane is WireGuard end-to-end:
the coordination server sees only metadata and public keys, and even DERP-relayed connections
forward WireGuard-encrypted packets it cannot read. We use **`tailscale serve`**
(tailnet-only, never Funnel). Serve terminates TLS locally on the owner's machine with a
MagicDNS `*.ts.net` cert and reverse-proxies to `http://127.0.0.1:8787`. The concrete recipe
(Tailscale >= 1.98): `tailscale serve --bg 8787`, after a one-time tailnet HTTPS/Serve
enablement in the admin console.

Honest residuals: Tailscale Inc. is a dependency for coordination and identity — accepted
because it never sees PII. The `*.ts.net` cert lands in CT logs; the device name must be
non-descriptive. `tailscale serve` exposes the service to every device on the tailnet per its
ACL; the assumption is a single-owner tailnet. `cloudflared` remains installed but unused.

### App auth — password to session cookie, on top of the tunnel

The tunnel alone is insufficient; app-level auth is the backstop for a brief window where the
tunnel is misconfigured and `:8787` is reachable. A password field producing a persistent
session cookie beats a bearer token: typing a password once into Safari and staying logged in
is the natural iPhone flow.

- **Credential:** scrypt hash (`node:crypto`, no new dependency) of a passphrase; random
  16-byte salt; stored as `{salt, hash}` in `Selfwright-data/web/credentials.json` (gitignored
  data dir, never committed; env override `SELFWRIGHT_WEB_PASSWORD_HASH` is accepted). Login
  does a constant-time compare.
- **Session store:** in-memory `Map<sessionId, {createdAt, csrfToken}>`. Single-user,
  single-process — in-memory is correct; a restart forces re-login.
- **Cookie:** `sw_session`, flags `HttpOnly; Secure; SameSite=Strict; Path=/`, `Max-Age` 30
  days. `Secure` is honored because Tailscale Serve presents HTTPS.
- **Brute force:** fixed failure delay + lockout after 5 failures for 15 minutes. The lockout
  counter is in-memory and resets on process restart (an accepted low-severity residual —
  exploiting it requires tailnet or loopback access already, and restart is the documented
  revocation lever).
- **Lifecycle:** `POST /logout` clears the session and cookie. Restarting the process is the
  credential-rotation/revocation mechanism: after changing the passphrase, restart — every
  outstanding cookie dies with the map.

### Data source — read the git truth dir directly, never the Postgres projection

The Hono server's /api/* handlers read the data dir via core services + `storage-git` + raw
YAML, exactly as the CLI and MCP do. The cockpit (apps/web-ui) never imports
`@selfwright/core` or `@selfwright/adapter-storage-git` directly — FF-WEB-1 clause (j)
enforces this. Data reaches the cockpit only via typed /api/* JSON responses. This preserves
the "nothing reads back from the projection" spirit of ADR 0009/0015: the dashboard surfaces
the reporting tools' output (Evidence iframe or Metabase link-out, when those profiles are
enabled) rather than duplicating BI. North-star is computed live via `computeNorthStar`; the
fitness trend is read from the data repo's `telemetry/fitness-history.jsonl`.

### Stack — React cockpit in apps/web-ui, Hono as /api/* + static host

**apps/web-ui:** Vite + React 18 + TypeScript strict + Tailwind CSS + hand-authored
shadcn/ui-style components, dark-first brand tokens sampled from `docs/brand`. Eight
client-routed pages: Overview, Inbox, Pipeline, Queue, Coaching, Content, Reporting,
Settings. All data comes through `@selfwright/api-contract` (Zod schemas and inferred TS
types, zero I/O). `@selfwright/shared-config/schemas` (pure Zod, no `node:fs`) is the one
other sanctioned import — needed for `SettingsSchema` on the Settings page without pulling
`node:fs` into the browser bundle. No CDN, no analytics, no external fonts; everything is
compiled into the bundle.

**apps/web:** after the T5.10 cutover, serves three things. The `/api/*` typed JSON contract
(ADR 0023), backed by the same Hono + `@hono/node-server` server that existed before. A
static host for apps/web-ui's built bundle (`../web-ui/dist`), with SPA fallback: any
authenticated GET that isn't `/api/*` serves `index.html` and react-router takes over. The
still-server-rendered login page (unchanged, deliberately out of scope for the cutover). Zero
SSR page routes remain — FF-WEB-1 clause (i) enforces this permanently.

Build order: `pnpm --filter @selfwright/web-ui build`, then `pnpm --filter @selfwright/web
build`. The server binds **`127.0.0.1:8787` only** — Tailscale Serve connects over loopback,
so binding loopback both suffices and prevents LAN/WAN exposure if the tunnel breaks.

### Cockpit pages

Overview (north-star + fitness sparkline + inbox counts); Inbox (three-tier digest —
decideNow/reviewSoon/fyi — with all five signal kinds); Pipeline (applications.yml + queue
with status transitions); Queue (scan queue with promote/dismiss); Coaching (next drill,
saved drills, prep-packs, debrief form); Content (latest digests, write/read topics);
Reporting (north-star detail, fitness trend, Evidence iframe or Metabase link-out when the
corresponding compose profile is enabled — labeled as requiring that profile in the UI);
Settings (settings.yml write surface, T5.11).

### Write surface

Six write routes, all behind session auth + fail-closed Origin check + CSRF token +
per-session write throttle (<=10 writes/minute) + audited git commit in the data repo:

- `POST /api/applications/:id/status` — status enum + optional note (ADR 0019).
- `POST /api/debriefs` — debrief capture, appended to coaching/debriefs.yml (ADR 0019).
- `POST /api/queue/:id/promote` — turns a triaged queue entry into a new application record
  (status `evaluating`) and removes it from queue.yml in one atomic git commit (ADR 0024).
- `POST /api/queue/:id/dismiss` — removes a queue entry the owner has decided not to pursue;
  scan-history prevents resurfacing (ADR 0024).
- `PUT /api/settings` — settings.yml write, validated against SettingsSchema (T5.11).
- `PUT /api/scan-targets` — pipeline/scan-targets.yml write, validated against
  ScanTargetsConfigSchema (T5.11).

CSRF transport: the cockpit fetches the session's token once from `GET /api/meta`
(`csrfToken` field) and resends it on every write as `X-CSRF-Token`. `verifyCsrfToken()`
validates it with a constant-time compare, identical to how the prior SSR forms worked.
`SameSite=Strict` cookie + fail-closed Origin check remain the primary defense; the header
is defense-in-depth. A pre-commit hook rejection in the data repo is handled fail-closed:
the file is reverted and the hook's stderr is returned as a 422 response.

### Logging & errors

Logs through `@selfwright/shared-logger`, no PII: method + route template, status, latency,
auth outcome only. Error pages are generic; no stack traces and no data echoed to the client.
Every authenticated response sets `Cache-Control: no-store` so rendered PII never lands in
Safari's disk or back-forward cache. Page titles are generic section names.

### Fitness & tests

**FF-PORT-1** unchanged (apps/web-ui imports core via /api/*; core never imports the app).
**FF-WEB-1** (web-safety check, `fitness/src/checks/web-safety.ts`) locks the invariants that
must never regress — ten assertions as of T5.10:

- (a) `hostname: "127.0.0.1"` positive assertion in `server.ts`
- (b) auth middleware registered before first route in `app.ts`
- (c) no external hosts in `apps/web/src`; `raw()` never used
- (d) `Cache-Control: no-store` in `auth.ts`
- (e) every write route is absent from `PUBLIC_PATHS`; POST routes have no matching GET
- (f) every write route's handler calls `verifyCsrfToken(`
- (g) every SSR write route's form embeds the CSRF token — vacuously satisfied (zero SSR
  forms since T5.10); reactivates automatically if an SSR form write route is reintroduced
- (h) every /api/* write route reads the CSRF token via the header helper
- (i) zero SSR page GET routes remain in `app.ts` (T5.10 regression gate)
- (j) `apps/web-ui/src` never imports `@selfwright/core`, `@selfwright/adapter-storage-git`,
  or the full `@selfwright/shared-config` barrel (T5.10 architecture boundary)

FF-APICONTRACT (ADR 0023) gates the /api/* contract test suite separately.

## What is NOT changed

Core stays I/O-free; no new port (the cockpit is a driving adapter, same as CLI/MCP). The
data-leak gate and the truth floor are untouched and absolute. The Postgres projection posture
(0009/0015) is unchanged — neither server nor client reads from it. No scheduler/daemon: the
web server is a manually started (or owner-opted OS service) process; every other surface
works without it. `cloudflared` is left installed and unused.

## Consequences

- The owner has a full-featured authenticated cockpit reachable from anywhere on his tailnet —
  the §13 override is bounded and justified by real usage, not speculation.
- The cockpit is the primary daily surface; the CLI and MCP co-pilot remain the tools for
  sessions with `AGENTS.md` context.
- React + Vite + Tailwind is a larger dependency tree than the original Hono JSX approach.
  The tradeoff is deliberate: the interaction requirements (client routing, live state, form
  validation feedback) outgrew what server-side HTML could serve cleanly.
- Build order matters: the web-ui bundle must be built before starting the web server.
  `scripts/setup.mjs` handles this for first-time setup.

## Alternatives considered

- **Cloudflare Tunnel** (pre-installed). Rejected: edge TLS termination makes Cloudflare a
  second processor of plaintext PII — the exact thing §4.3 forbids.
- **Tailscale Funnel / raw port-forward.** Rejected: both expose the app to the public
  internet; the requirement is tunnel-only, tailnet-scoped.
- **Bearer token instead of a session cookie.** Rejected: awkward to inject on iPhone Safari.
- **Read the Postgres projection.** Rejected: requires containers + a manual sync-db, breaks
  the zero-infra and freshness goals.
- **SSR with Hono JSX (original T3.6 through T4 stack).** Served the read-only dashboard
  and v1.1 write actions correctly through v0.4.0. Replaced in T5.10 once the cockpit became
  the primary workflow surface and the interaction requirements exceeded what SSR could serve
  without a client-side router. The decision to build and own a client app required the
  /api/* contract (ADR 0023) to already exist — T5.9 made T5.10 clean.
- **HTMX or similar.** Considered briefly. Rejected: still requires managing client state and
  routing for the queue triage and pipeline board; the marginal dependency saving over React
  was outweighed by unfamiliar patterns for the cockpit's specific interaction needs.
