# Selfwright data template

This directory is a minimal, valid starter data directory for Selfwright. Copy it to your
own private git repository, personalize it, and point the framework at it via
`SELFWRIGHT_DATA_DIR`.

All content here is synthetic (Jordan Doe / FictionalCo convention). The named-entity
data-leak gate scans for real names from your private data; none exist here.

## Setup

```bash
# 1. Copy this directory to your private data repo
cp -r examples/data-template /path/to/your-selfwright-data

# 2. Initialize as a git repo (the framework commits changes here at write time)
cd /path/to/your-selfwright-data
git init
git add -A
git commit -m "chore: init from Selfwright data template"

# 3. Add a remote and push (your backup is your push)
git remote add origin https://github.com/your-handle/Selfwright-data.git
git push -u origin main

# 4. Point the framework at your data dir
export SELFWRIGHT_DATA_DIR="/path/to/your-selfwright-data"
# Add this to your shell profile so it persists.

# 5. Try the first commands (run from the Selfwright framework repo root —
#    there is no global `selfwright` link; this runs the root `selfwright`
#    script, node apps/cli/dist/index.js)
pnpm selfwright score path/to/job-description.md
pnpm selfwright inbox
```

## File-by-file guide

| File | Purpose | Required? |
|---|---|---|
| `truth/identity.yml` | Your professional identity: name, titles, contact, roles timeline, honesty boundaries | Yes |
| `truth/evidence/registry.yml` | Evidence registry: verifiable claims from your work history with EVD-* ids | Yes |
| `truth/keyword-ontology.yml` | Domain keyword taxonomy: synonyms and groupings used by scoring, gap-scan, and scan | Yes — commands exit with a clear error if missing |
| `truth/archetypes/*.md` | One or more archetype files: positioning lanes with evidence selection and search config | Yes — at least one |
| `truth/gaps.yml` | Skill gaps ledger: populated by gap-scan and debrief analysis | No (defaults to empty) |
| `truth/comp-floors.data.yml` | Compensation floors by location: used by the scoring engine | No (scoring degrades gracefully) |
| `applications/applications.yml` | Application pipeline records | No (defaults to empty) |
| `pipeline/scan-targets.yml` | Companies and ATS providers to check with `selfwright scan` | Yes if using scan |
| `positioning/scoring-vocabulary.yml` | Industry-tier and anchor-company classification vocabulary | Recommended — FF-VOCAB-1 warns if missing |

Directories created lazily (no template file needed):
- `coaching/` — drill history and debriefs, created on first `debrief add` or drill run
- `content/` — topic history and digests, created on first `topics` run
- `telemetry/` — usage and scheduled-task logs
- `web/` — dashboard credential (`credentials.json`) from `pnpm --filter @selfwright/web hash-password`

## Personalizing

1. Replace `truth/identity.yml` with your own professional identity.
2. Replace `truth/evidence/registry.yml` with your real work evidence. Use EVD-YOURINITIALS-LABEL ids.
3. Replace or extend `truth/keyword-ontology.yml` with your actual domain vocabulary.
4. Replace `truth/archetypes/*.md` with your real positioning archetypes.
5. Replace `positioning/scoring-vocabulary.yml` with real target companies from your search.
6. Edit `pipeline/scan-targets.yml` with the companies you want to track.

The naming convention keeps EVD-* and GAP-* ids short and memorable. Whatever convention you
choose, be consistent: the validators check id existence across all files.

## Privacy note

Your private data repo should remain private. The `web/credentials.json` file (dashboard
password hash) is gitignored in the data repo by default — regenerate it with
`pnpm --filter @selfwright/web hash-password` on each machine.

See `docs/data-storage-and-backup.md` in the framework repo for the full backup playbook.
