# Data, storage & backup

## The two-repo model

Selfwright uses two Git repositories:

- **Framework repo** (`fst-it/Selfwright` or your fork) — open-core code, prompts, and
  configuration. Safe to share or publish. Contains no personal data by design.
- **Private data repo** (your own, e.g. `your-handle/Selfwright-data`) — your truth layer,
  applications, contacts, drift files, telemetry. This is your personal vault. Keep it in a
  private remote. Pushing it is your backup.

Point the framework at your data repo by setting `SELFWRIGHT_DATA_DIR` to its absolute path, or
place it as a sibling directory named `Selfwright-data` next to the framework repo.

## What lives where

| Artifact | Location | Durable? |
|---|---|---|
| Truth layer (evidence, identity, archetypes, `truth/keyword-ontology.yml`) | `<dataDir>/truth/` — data repo | Yes — versioned + pushed |
| Applications | `<dataDir>/applications/` — data repo | Yes |
| Contacts | `<dataDir>/contacts/` — data repo | Yes |
| Coaching (debriefs, drill history) | `<dataDir>/coaching/` — data repo, **created lazily** | Yes, once it exists — not present until the first `debrief add` / drill-history write |
| Positioning / drifts | `<dataDir>/positioning/`, `<dataDir>/drifts/` — data repo | Yes |
| Fitness telemetry | `<dataDir>/telemetry/fitness-history.jsonl` — data repo | Yes |
| Usage telemetry | `<dataDir>/telemetry/usage.jsonl` — data repo | Yes |
| Dashboard credential | `<dataDir>/web/credentials.json` — data repo, **gitignored** | No — regenerate with `hash-password` |
| Framework code | Framework repo | Yes — versioned + pushed |
| Build artifacts | `dist/`, `node_modules/` — framework repo, gitignored | No — regenerate via `pnpm install && pnpm build` |
| MCP error log | `reports/mcp-errors.jsonl` — framework repo, gitignored | No — ephemeral debug log, safe to lose |

`truth/keyword-ontology.yml` is not optional enrichment: `score`, `gap-scan`, `inbox --archetype`,
and `scan` all load it and exit with an error if it's missing. A minimal data dir needs at least
`truth/identity.yml`, `truth/evidence/registry.yml`, one file under `truth/archetypes/`, and
`truth/keyword-ontology.yml` — see the README's "Minimal data-dir file set" for the full list.

## New-machine recovery playbook

```bash
# 1. Clone the framework repo
git clone https://github.com/your-handle/Selfwright.git

# 2. Clone your private data repo
git clone https://github.com/your-handle/Selfwright-data.git

# 3. Set the data dir (add to your shell profile)
export SELFWRIGHT_DATA_DIR="/absolute/path/to/Selfwright-data"

# 4. Install dependencies and build
cd Selfwright
pnpm install && pnpm build

# 5. Regenerate the dashboard credential
pnpm --filter @selfwright/web hash-password
# Follow the prompt; the new hash is written to <dataDir>/web/credentials.json

# 6. Verify everything
pnpm fitness
```

That is the full recovery. Your data (truth, applications, telemetry) is already in the data repo.
Nothing precious was in the framework repo's gitignored paths.

## What to back up

Push your private data repo regularly — that push is your backup:

```bash
cd "$SELFWRIGHT_DATA_DIR"
git add -A
git commit -m "chore: checkpoint"
git push
```

Nothing durable lives only in gitignored paths of the framework repo anymore. The framework repo
itself is safe to delete and re-clone at any time.
