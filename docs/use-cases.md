# Selfwright — use-case catalog

Worked scenarios mapped to exact commands. Each scenario names the entry point, the key
commands, and what the output looks like. For full command flags see the MANUAL's command
reference.

---

## 1. "I found a role on LinkedIn I want to track"

LinkedIn does not expose an ATS API. `queue-add` is the manual capture lane: paste the URL
and job description text; the entry is scored, deduped against your existing queue and
applications, and written to `pipeline/queue.yml` with `source: "manual"`.

```bash
pnpm selfwright queue-add \
  --url "https://www.linkedin.com/jobs/view/123456" \
  --company "FictionalCo B" \
  --role "Principal Data Engineer" \
  --jd-file path/to/pasted-jd.md
```

Or use the `/queue-add` skill in Claude Code, which walks you through the fields
conversationally without leaving the chat.

Output: `pipeline/queue.yml` gains a new entry with a `MAN-<hash>` id and fit score.

---

## 2. "Is this job description worth my time?"

Score any JD file against your archetypes before committing to the full apply workflow.
No LLM involved — runs in under a second.

```bash
pnpm selfwright score path/to/jd.md
```

Output: JSON with best-matching archetype, 7-dimension scores (keyword match, seniority,
leadership, geo fit, company type, ATS keyword overlap, evidence coverage), and a letter grade.
Grade `F` means no archetype match above the non-degeneracy floor.

---

## 3. "I want to apply — set up the ATS and tailoring"

First score to confirm the best archetype, then run ATS to find keyword gaps, then tailor
your CV JSON against the archetype's overlay.

```bash
pnpm selfwright score path/to/jd.md
pnpm selfwright ats path/to/jd.md path/to/cv.json
pnpm selfwright tailor path/to/cv.json \
  --overlay path/to/archetype-overlay.json \
  --out path/to/cv-tailored.json
```

The ATS report shows parseability score and the keyword buckets missing from your CV. Fix
those gaps in your overlay, re-tailor, and re-check.

---

## 4. "Write a cover letter for this application"

Co-piloted generation: Selfwright assembles a grounded prompt and writes it to
`<app-dir>/cover-prompt.md`. Open that file in your Claude session, generate the letter
into `cover-letter.md`, then validate.

```bash
pnpm selfwright cover path/to/app-dir
# → writes cover-prompt.md

# ... write the letter from the prompt ...

pnpm selfwright cover path/to/app-dir --check
# → validates cover-letter.md: truth-trace, honesty, format
```

Or use the `/cover` skill in Claude Code to run the full loop without switching windows.

---

## 5. "Research the company before writing the cover letter"

```bash
pnpm selfwright research "FictionalCo B" "Principal Data Engineer" path/to/jd.md \
  --out path/to/app-dir/company-research.md

# ... generate research from the prompt into company-research.md ...

pnpm selfwright research "FictionalCo B" "Principal Data Engineer" path/to/jd.md \
  --check
```

Include `company-research.md` in the application directory before running `cover` — the
cover prompt will incorporate it automatically.

---

## 6. "Interview tomorrow — prepare"

`prep-pack` assembles a truth-grounded brief: your top evidence for this role, coverage
gaps, likely questions from the JD, and your current drift posture.

```bash
pnpm selfwright prep-pack path/to/app-dir \
  --kind interview \
  --archetype data-platform-architect

# ... generate the prep-pack from the returned prompt ...

pnpm selfwright prep-pack path/to/app-dir --check
```

Or use the `/prep-pack` skill in Claude Code to run it conversationally. Expected output:
`prep-pack.md` with sections for evidence highlights, gap coverage, likely questions, and
honesty notes.

---

## 7. "Just left an interview — log the debrief"

Log what was asked, what went well, and where you wobbled. No person names; reference
interviewers via contacts entries if needed.

```bash
pnpm selfwright debrief add \
  --app fictionalco-b-eng-2026 \
  --date 2026-07-12 \
  --round "technical-1" \
  --asked "data platform design;Kafka throughput;team leadership" \
  --wobbled "Kafka consumer group rebalancing;Spark tuning" \
  --went-well "platform architecture;stakeholder communication"
```

Or use the `/debrief` skill in Claude Code for conversational capture. After saving, run
`gap-scan` to see how the wobbles map to prioritized drill topics.

---

## 8. "What do I need to drill before the next interview?"

`gap-scan` combines evidence coverage, existing gaps, and debrief-derived hints into a
prioritized report. `drill` selects the highest-priority topic and prepares a co-piloted
drill session.

```bash
pnpm selfwright gap-scan data-platform-architect
pnpm selfwright drill data-platform-architect
```

Expected output from `gap-scan`: categorized candidates (uncovered, partial, covered) with
debrief hints highlighted. From `drill`: a prompt file with the selected topic, coaching
rubric, and relevant evidence.

---

## 9. "Which of my applications need attention right now?"

`inbox` runs a deterministic 3-tier triage across your pipeline: Decide-now (action
required today), Review-soon (needs attention this week), FYI (status updates and signals).

```bash
pnpm selfwright inbox
# or with coaching signals:
pnpm selfwright inbox --archetype data-platform-architect
```

Expected output: a dated digest with items in each tier. Decide-now items include expiring
drifts and overdue follow-ups. Review-soon includes unscored queue entries and applications
without a debrief.

---

## 10. "My daily inbox digest — phone push"

The scheduled task `SelfwrightInboxDigest` runs at 08:00 and pushes tier counts and IDs
to ntfy. To trigger it manually:

```bash
pnpm selfwright inbox --archetype data-platform-architect --notify
```

Requires `NTFY_URL` set as an environment variable. The push contains only counts and IDs —
no company names, no claim text.

---

## 11. "Weekly channel check — what are my metrics?"

```bash
pnpm selfwright metrics
pnpm selfwright metrics --format json   # for BI ingestion
```

Expected output: north-star section (submissions, interview conversions, rate per 10 apps),
channel outcomes (how many applications per source channel reached interview), and usage
telemetry summary.

---

## 12. "Add a new company to track"

Edit `pipeline/scan-targets.yml` in your data repo to add the new target, then run a scan:

```bash
# In your Selfwright-data repo:
# Add an entry to pipeline/scan-targets.yml

pnpm selfwright scan --dry-run   # check without writing queue
pnpm selfwright scan             # live run
```

For companies on a portal that blocks automated fetches (iCIMS, Workday with bot protection):
add them as `provider: generic` with the careers page URL. Uncertain-liveness postings are
noted in the queue for manual review.

---

## 13. "Scan a specific company's board"

Pass a custom targets file to scope the scan to one company without editing the main file:

```bash
pnpm selfwright scan --targets path/to/single-company-targets.yml
```

Or run a full scan and filter the queue output by company name afterward.

---

## 14. "Write a weekly content digest for my archetype"

`topics` selects evidence-backed write/read candidates with freshness decay so topics don't
repeat week to week.

```bash
pnpm selfwright topics data-platform-architect

# ... generate the digest from the returned prompt into content/digests/YYYY-MM-DD-data-platform-architect.md ...

pnpm selfwright topics data-platform-architect --check path/to/digest.md
```

Or use the `/topics` skill in Claude Code. The digest must include `## Topics to write` and
`## Topics to read` headings, at least one URL per item, and a `Grounding:` line.

---

## 15. "Content ideas for a specific live application"

Application mode maps the JD's keywords to your strongest evidence:

```bash
pnpm selfwright topics --app path/to/app-dir
```

Expected output: a prompt file in the app directory. The resulting digest is application-specific
and a useful companion to the cover letter.

---

## 16. "Open the dashboard on my phone"

Requires Tailscale installed on the dev machine and the iPhone app connected to the same
tailnet. Start the dashboard:

```bash
pnpm --filter @selfwright/web start
tailscale serve --bg 8787
```

Then open `https://<device-name>.ts.net` in Safari. Log in with the password set by
`pnpm --filter @selfwright/web hash-password`. The overview page shows pipeline status,
inbox tier counts, and coaching signal counts. The pipeline page lets you update application
status and capture debriefs without opening a terminal.

---

## 17. "Review everything in my queue and decide what to apply to"

```bash
pnpm selfwright inbox
# → see queue items in Review-soon
pnpm selfwright score path/to/queue-item-jd.md
# → confirm fit grade before committing time
```

The inbox puts unscored queue entries in Review-soon. Score each one, update the queue entry
with the score, and move the strongest candidates to an application directory to start the
full apply workflow.

---

## 18. "Drift posture review — is anything expiring?"

Drifts appear in `inbox` Decide-now when they are expiring or when the application they
belong to closes. To check the full ledger:

```bash
pnpm selfwright inbox
# → Decide-now tier lists expiring or closed-application drifts
```

To retire or re-target a drift: edit the relevant file in `drifts/companies/` in your data
repo. The drift lifecycle is a human-governed process — the system surfaces signals but does
not auto-retire.

---

## 19. "Set up scheduled tasks for the first time"

```powershell
.\tools\scripts\install-scheduled-tasks.ps1 `
  -DataDir "C:\Users\<you>\Selfwright-data" `
  -ArchetypeId "data-platform-architect"
```

Registers `SelfwrightScan` (Sunday 09:00) and `SelfwrightInboxDigest` (daily 08:00). The scripts
resolve the CLI repo-relative — there is no global `selfwright` link — so they only require
`node` on PATH and the framework built (`pnpm build`). `NTFY_URL` set as a user environment
variable is optional (push notifications only). Run with `-Uninstall` to remove.

---

## 20. "Restore Selfwright on a new machine"

```bash
# 1. Clone the framework
git clone https://github.com/your-handle/Selfwright.git
cd Selfwright && pnpm install && pnpm build

# 2. Clone your data repo
git clone https://github.com/your-handle/Selfwright-data.git
export SELFWRIGHT_DATA_DIR="/path/to/Selfwright-data"

# 3. Regenerate the dashboard credential
pnpm --filter @selfwright/web hash-password

# 4. Verify
pnpm fitness
pnpm selfwright inbox
```

Full playbook in `docs/data-storage-and-backup.md`.
