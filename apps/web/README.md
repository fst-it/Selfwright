# @selfwright/web — Web dashboard backend

Hono server implementing ADR 0016 (Tailscale-accessible, password/session auth) and ADR 0023 (the
`/api/*` JSON contract). As of T5.10's clean cutover this package no longer renders any page
itself: it serves the typed `/api/*` read/write endpoints, hosts the built React cockpit
(`@selfwright/web-ui`) as static files with an SPA fallback, and serves the one remaining
server-rendered page, `/login`. See `docs/MANUAL.md` §2.6 for the cockpit build/run/E2E steps.

## Generating credentials

```sh
SELFWRIGHT_DATA_DIR=/path/to/selfwright-data \
  pnpm --filter @selfwright/web hash-password
```

Or pass the passphrase without a prompt:

```sh
SELFWRIGHT_WEB_PASSPHRASE=mypassphrase \
SELFWRIGHT_DATA_DIR=/path/to/selfwright-data \
  pnpm --filter @selfwright/web hash-password
```

This writes `<SELFWRIGHT_DATA_DIR>/web/credentials.json` (the data dir — ensure `web/credentials.json` is gitignored there; see setup).

Alternatively, set the env override directly (useful for systemd or similar):

```sh
SELFWRIGHT_WEB_PASSWORD_HASH=<salt>:<hash>
```

Both the salt and hash are hex strings produced by the command above.

## Running

Foreground (build first with `pnpm --filter @selfwright/web build`):

```sh
SELFWRIGHT_DATA_DIR=/path/to/selfwright-data \
  pnpm --filter @selfwright/web start
```

Binds to `127.0.0.1:8787` only. Override port with `SELFWRIGHT_WEB_PORT`.

### Persistent (auto-start) — reproducible, per platform

Pick the one script for your OS; each is parameterized (no hand-editing of a GUI):

- **Windows** — registers a Scheduled Task that starts the server at logon:

  ```powershell
  ./scripts/install-windows-task.ps1 -DataDir "C:\path\to\selfwright-data"
  ```

- **Linux (systemd, user service)** — create `~/.config/systemd/user/selfwright-web.service`:

  ```ini
  [Unit]
  Description=Selfwright web dashboard
  [Service]
  Environment=SELFWRIGHT_DATA_DIR=/path/to/selfwright-data
  WorkingDirectory=/path/to/selfwright/apps/web
  ExecStart=/usr/bin/node dist/server.js
  Restart=on-failure
  [Install]
  WantedBy=default.target
  ```
  then `systemctl --user enable --now selfwright-web`.

- **macOS (launchd)** — a `~/Library/LaunchAgents/dev.selfwright.web.plist` with
  `SELFWRIGHT_DATA_DIR` in `EnvironmentVariables`, `WorkingDirectory` set to
  `apps/web`, and `ProgramArguments` = `[node, dist/server.js]`, then
  `launchctl load` it.

## Tailscale remote access

The server binds loopback-only. Reach it from your iPhone via Tailscale Serve
(tailnet-scoped, **never Funnel** — Funnel exposes to the public internet):

**One-time tailnet setup (owner, in the Tailscale admin console):**
1. Enable **HTTPS certificates / Serve** for the tailnet (Settings → Features).
2. Install the Tailscale app on the iPhone and sign into the same tailnet.
3. Use a **non-descriptive device name** — Serve issues a public Let's Encrypt
   cert whose `<device>.<tailnet>.ts.net` hostname is logged in public
   Certificate Transparency logs; a neutral name (e.g. `home-node-1`) reveals
   nothing about you or the app.

Then, on the machine (Tailscale ≥ 1.98 syntax):

```sh
tailscale serve --bg 8787
```

This proxies `https://<device>.<tailnet>.ts.net/` → `http://127.0.0.1:8787`,
terminating TLS locally on your own machine. Verify with `tailscale serve status`.

See ADR 0016 for the full rationale (Cloudflare Tunnel rejected — its edge would
terminate TLS and see plaintext PII; Tailscale Serve chosen because WireGuard
end-to-end encryption means the coordination server never sees plaintext PII).
