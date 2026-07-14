# INSTRUCTIONS.md — Running Your Job Search with Selfwright

> Task-oriented guide for end users. Read this when you want to do something, not understand how
> the system works. For technical architecture, see `DESIGN.md`. For setup help beyond the quick
> start below, see `DEVELOPMENT.md`.

---

## Quick start

**First time:**

```bash
git clone https://github.com/fst-it/Selfwright.git
cd Selfwright
node scripts/setup.mjs --init-template --data-dir /path/to/your-data-repo
```

The setup script handles prerequisites, creates the data directory with starter files, writes
`.env`, runs `pnpm install`, and installs the git hooks. See `DEVELOPMENT.md` for the full
prerequisites list (Node 22+, pnpm, optionally Docker).

**Set your data directory.** Every CLI command and fitness check reads `SELFWRIGHT_DATA_DIR`.
Set it in your shell profile:

```bash
export SELFWRIGHT_DATA_DIR=/path/to/your-data-repo
```

**Running the CLI.** There is no global `selfwright` link — every command below is invoked as
`pnpm selfwright <cmd>` from the repository root (it runs the root `selfwright` script, which
wraps `node apps/cli/dist/index.js`). You can also call
`node apps/cli/dist/index.js <cmd>` directly.

**Verify the install:**

```bash
pnpm test && pnpm fitness
```

Both should pass with no personal data yet — the Tier 1 checks use synthetic fixtures.

---

## The core loop

Selfwright follows a fixed sequence for each application. Work through the steps in order.

```
scan  →  score  →  tailor  →  cover/research  →  [human submits]  →  prep-pack  →  debrief
                                                              ↓
                                                         drill / gap-scan (between rounds)
```

---

### 1. Discover: find and capture roles

**Automated scan (ATS job boards):**

Add companies and ATS providers to `<dataDir>/pipeline/scan-targets.yml`. Format is in
`config/scan-targets.yml` in this repo. Then run:

```bash
pnpm selfwright scan
```

The scanner fetches each target, checks liveness, dedupes by company and fuzzy title (Jaccard
≥ 0.5 on title tokens), scores each posting against your archetypes, and writes new entries to
`pipeline/queue.yml`. The Sunday 09:00 scheduled task does this automatically if you have set it
up (see `docs/scheduled-tasks.md`).

Supported providers (19 total): ATS boards — Greenhouse, Lever, Ashby, Workday, SmartRecruiters,
BambooHR, Oracle Fusion, Recruitee, Personio, Workable, Breezy; aggregators — Adzuna (requires
`SELFWRIGHT_ADZUNA_APP_ID` and `SELFWRIGHT_ADZUNA_APP_KEY`), Arbeitnow, Remotive, Himalayas,
WeWorkRemotely, RemoteOK; a generic schema.org JSON-LD fetcher; and a Playwright browser provider
for bot-gated Workday tenants (requires `--with-playwright` at setup).

Skill: `/scan`

**Manual capture (LinkedIn, referrals, direct):**

```bash
pnpm selfwright queue-add --company "Acme Corp" --role "Staff Engineer" --url "https://..."
```

Pass `--jd-file path/to/jd.txt` to score the posting at capture time.

Skill: `/queue-add`

**Check what is in the queue:**

```bash
pnpm selfwright inbox
```

The inbox shows three tiers: Decide-now (overdue follow-ups, active queue entries), Review-soon
(new scan results, flagged gaps), and FYI (stale entries, expiring drifts). Queue entries go
stale after 30 days by default (configurable in `<dataDir>/settings.yml`).

Skill: `/inbox`

---

### 2. Assess: score and check fit

**Score a JD:**

```bash
pnpm selfwright score path/to/jd.md
```

A sample job description ships at `examples/sample-jd.md` for quickstart testing. Run
`pnpm selfwright score examples/sample-jd.md` to try the scorer before you have a real JD.

Output: best-matching archetype and a grade A–F across 7 dimensions. Grade F means no archetype
matched above the non-degeneracy floor — the role is probably off-target, or the JD vocabulary
does not overlap with your ontology.

Skill: `/score`

**ATS check:**

```bash
pnpm selfwright ats path/to/jd.md path/to/cv.json
```

Output: ATS parseability score (pass/fail at 0.80 default), keyword bucket breakdown, and the JD
terms absent from your CV. Use these to tune your tailoring overlay before generating.

Skill: `/ats`

**Gap check:**

```bash
pnpm selfwright gap-scan <archetype-id>
```

Output: evidence-coverage report for the archetype — keywords fully covered, partially covered,
or absent. Uncovered gaps are either real skill gaps or competencies you have not documented yet.
Running this before you write the overlay saves time: you can see which missing keywords to focus
on in your evidence before tailoring.

Skill: `/gap-scan`

---

### 3. Prepare: tailor, cover, research

Create a directory for each application (e.g. `~/applications/2026-07-acme-corp/`). Put the JD
and any company notes there.

**Step 1 — Tailor the CV.**

Create an overlay JSON specifying which evidence to foreground, a summary grounded in EVD-* ids,
and any drift applications. Run:

```bash
pnpm selfwright tailor path/to/cv.json \
  --overlay path/to/overlay.json \
  --out path/to/cv-tailored.json
```

The engine validates the overlay summary against your evidence registry. An untraceable claim in
the summary produces a `VALIDATION_ERROR` rather than a flawed output.

Skill: `/tailor`

**Step 2 — Research the company.**

```bash
pnpm selfwright research "Acme Corp" "Staff Engineer" path/to/jd.md
# → writes research-prompt.md

# Generate the research document from the prompt in your Claude Code session, then validate:
pnpm selfwright research "Acme Corp" "Staff Engineer" path/to/jd.md --check
```

`--check` reads `company-research.md` from the application directory and validates it against the
truth floor, the honesty wall, and the AI-tell scanner.

Skill: `/research`

**Step 3 — Write the cover letter.**

```bash
pnpm selfwright cover path/to/app-dir
# → writes cover-prompt.md

# Generate the cover letter in your Claude Code session, save as cover-letter.md, then validate:
pnpm selfwright cover path/to/app-dir --check
```

`--check` rejects any sentence that cannot be traced to an EVD-* entry, any banned AI-tell
phrase (e.g. "delve", "seamlessly", "not just X but"), or any keyword from a retired drift.

Skill: `/cover`

**How co-piloted generation works.**

The `cover` and `research` commands (and `prep-pack`, `drill`, `topics`) write a prompt file and
stop. They do not call an LLM. Open the prompt in your Claude Code session, let Claude generate
the output, paste or save it into the expected output file, then run `--check`. This is the
default because it requires no API key and uses your existing subscription.

If you want headless generation, pass `--adapter cli` (shells `claude --print`) or
`--adapter litellm` (requires a running LiteLLM proxy):

```bash
pnpm selfwright cover path/to/app-dir --adapter cli
```

---

### 4. Submit

Selfwright stops here. You review and submit.

Pre-submit checklist:
- ATS score ≥ 0.80 (or understood if lower)
- `cover --check` passes all validators
- `research --check` passes (if written)
- Tailoring overlay has no `VALIDATION_ERROR`
- Drift confidence scores reviewed and accepted
- Application entry added or updated in `applications/applications.yml` with status `applied`
  and the submission date

You can also promote from the web dashboard: open the queue table, click Promote on the entry,
then update the status to `applied` once you have submitted.

---

### 5. Interview loop

**Before the interview — build a prep pack:**

```bash
pnpm selfwright prep-pack path/to/app-dir \
  --kind interview \
  --archetype <id>
# → writes prep-pack-prompt.md

# Generate in your Claude Code session, save as prep-pack.md, then validate:
pnpm selfwright prep-pack path/to/app-dir --check
```

The prep pack includes a curated evidence bundle, key keywords from the JD, and a framing
narrative. Validation checks for EVD-* integrity, honesty-wall compliance, and that no sentence
makes a claim the evidence does not support.

Skill: `/prep-pack`

**After the interview — log the debrief immediately:**

```bash
pnpm selfwright debrief add \
  --app <application-id> \
  --date 2026-07-14 \
  --round "technical-1" \
  --wobbled "topic-a;topic-b"
```

Debrief data from this command feeds back into `gap-scan` and `drill` to surface the specific
topics you struggled with alongside general evidence-coverage gaps.

Skill: `/debrief`

**Between rounds — drill and gap-scan:**

```bash
pnpm selfwright gap-scan <archetype-id>   # shows debrief-derived hints alongside coverage gaps
pnpm selfwright drill <archetype-id>      # selects a fresh question on your highest-priority gaps
```

The drill selector uses a freshness decay to avoid repeating recent topics.

Skill: `/drill`

---

### 6. Content

Generate ranked article topics backed by evidence and JD context:

```bash
pnpm selfwright topics <archetype-id>
# → writes topics-prompt.md in <dataDir>/content/

# Generate the digest, then validate:
pnpm selfwright topics <archetype-id> --check path/to/digest.md
```

For per-application topics (before writing a cover letter for a new application):

```bash
pnpm selfwright topics --app path/to/app-dir
```

Skill: `/topics`

---

## Skills reference

The skills below auto-invoke inside a Claude Code session when you describe the task. You can also
trigger them explicitly with the `/` prefix.

| Skill | Invokes | What it does |
|-------|---------|--------------|
| `/scan` | `pnpm selfwright scan` | Fetch new postings, score, queue |
| `/score` | `pnpm selfwright score` | Score a JD against your archetypes |
| `/ats` | `pnpm selfwright ats` | ATS keyword coverage check |
| `/gap-scan` | `pnpm selfwright gap-scan` | Evidence-coverage report for an archetype |
| `/tailor` | `pnpm selfwright tailor` | Apply an overlay and produce a tailored CV |
| `/cover` | `pnpm selfwright cover` | Assemble a cover-letter prompt, or validate an artifact |
| `/research` | `pnpm selfwright research` | Assemble a research prompt, or validate an artifact |
| `/prep-pack` | `pnpm selfwright prep-pack` | Build a pre-interview prep pack |
| `/drill` | `pnpm selfwright drill` | Select a targeted coaching question |
| `/debrief` | `pnpm selfwright debrief add` | Log a post-interview debrief |
| `/topics` | `pnpm selfwright topics` | Generate ranked content topics |
| `/queue-add` | `pnpm selfwright queue-add` | Manually capture a role to the queue |
| `/inbox` | `pnpm selfwright inbox` | Show the three-tier digest |

---

## Web dashboard

Start the dashboard for an overview, queue triage, and pipeline management from your phone:

```bash
pnpm --filter @selfwright/web-ui build   # first time and after UI changes
pnpm --filter @selfwright/web build
pnpm --filter @selfwright/web start
```

Visit `127.0.0.1:8787` on the machine, or enable Tailscale Serve for phone access:

```bash
tailscale serve --bg 8787
# Then open https://<device-name>.ts.net on any device on your tailnet
```

First-time setup requires generating a password hash:

```bash
pnpm --filter @selfwright/web hash-password
```

See `docs/MANUAL.md` §2.6 for scheduled startup on Windows.

---

## Optional services

All optional. The CLI, MCP, and web dashboard work without any of these running.

```bash
# Start Postgres (pgvector projection — enables sync-db and embeddings):
docker compose --env-file .env -f infra/docker-compose.yml up -d

# Add local embeddings (nomic-embed-text via Ollama):
docker compose ... --profile embeddings up -d

# Add episodic memory (mem0 + Ollama):
docker compose ... --profile memory up -d

# Add Evidence.dev dashboards (iframe in the cockpit's Reporting page):
docker compose ... --profile reporting-evidence up -d
```

---

## Absolute rules (not configurable)

1. **Never use `--no-verify`** on a git commit or push. The hooks carry the data-leak gate.
2. **Human submits.** Selfwright produces the application; you send it.
3. **`--check` before using any generated artifact.** The validator is not optional.
4. **All personal data in `<dataDir>` only.** Never in the framework repo.

For the full rationale behind these rules, see `CONSTITUTION.md`.

**Security posture:** the framework collects no telemetry and makes no autonomous network calls
by default. See `SECURITY.md` for the full data-egress policy (job boards, optional gateway,
ntfy) and the CI checks (`FF-EGRESS`, `FF-LLM-1`, `FF-DATA-LEAK-1`) that enforce it.
