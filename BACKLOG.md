# BACKLOG.md — Enhancement Proposals

This is a living, owner-curated list of future enhancements. The owner reviews and prioritizes
it. Community members may propose additions — see the template and process at the bottom.

Every item here must respect [CONSTITUTION.md](CONSTITUTION.md). Items that tension a
constitutional principle are flagged; they require an ADR before shipping. Items without a flag
are fully aligned and ship when the owner chooses.

Last updated: 2026-07-13.

---

## Near-term priority themes

Themes **A (Ecosystem & Distribution)**, **B (Interoperability & Standards)**,
**C (Intelligence & Retrieval)**, and **D (Coaching Depth)** are active for the next release
cycle. Themes E and F are open but not current-cycle priorities.

---

## Ranking method

Proposals are ranked by **V/C** — Value divided by Complexity. V and C each run 1–5 (Value:
higher = more user impact; Complexity: higher = more build cost). A higher V/C ratio means more
value per unit of effort.

Within the same V/C ratio, the proposal with the lower absolute Complexity comes first. Ties at
identical V and C scores are ordered by dependency and judgment.

**Legend**

- ✅ Aligned — no constitutional tension.
- ⚠️ Opt-in only — tensions CONSTITUTION.md principle 4 (human-in-the-loop) or principle 6
  (local-first/no telemetry). Only ships as a strictly optional, user-configured, locally-
  controlled feature with explicit opt-in.

Note: supervised form pre-fill (item 28) was previously flagged as constitutionally ambiguous.
Under the human-in-the-loop ruling (ADR 0025, 2026-07-13), it is now ✅ — the automation
stops before the final submit control; the human submits.

---

## Themes

| ID | Theme |
|---|---|
| A | Ecosystem & Distribution |
| B | Interoperability & Standards |
| C | Intelligence & Retrieval |
| D | Coaching Depth |
| E | Model Portability & Local-First Rigor |
| F | Cockpit UX & Reach |

---

## Ranked table

| # | Title | Theme | V | C | V/C | Flag |
|---|---|---|---|---|---|---|
| 1 | Onboarding wizard + complete data-template | A | 4 | 1 | 4.00 | ✅ |
| 2 | Harden & publish the Selfwright MCP server + registry listing | A | 5 | 2 | 2.50 | ✅ |
| 3 | JSON Resume import/export bridge | B | 4 | 2 | 2.00 | ✅ |
| 4 | Package skills for agent-skills marketplace | A | 4 | 2 | 2.00 | ✅ |
| 5 | Scan-provider expansion | F/A | 4 | 2 | 2.00 | ✅ |
| 6 | Application funnel / cohort analytics in Reporting | C | 4 | 2 | 2.00 | ✅ |
| 7 | Learning-roadmap tracker (gaps → plan → evidence) | D | 4 | 2 | 2.00 | ✅ |
| 8 | Salary-negotiation prep-pack kind | D | 4 | 2 | 2.00 | ✅ |
| 9 | Community archetype/ontology template library | A | 4 | 2 | 2.00 | ✅ |
| 30 | One-command install across platforms | A | 4 | 2 | 2.00 | ✅ |
| 29 | Cross-platform scheduling + verified macOS/Linux support | A | 5 | 3 | 1.67 | ✅ |
| 10 | schema.org JobPosting structured ingestion | B | 3 | 2 | 1.50 | ✅ |
| 11 | Obsidian / markdown second-brain export | B | 3 | 2 | 1.50 | ✅ |
| 12 | ATS multi-format render + parse-simulation lint | F | 3 | 2 | 1.50 | ✅ |
| 13 | Multi-channel digest (email/RSS/local file) | F | 3 | 2 | 1.50 | ✅ |
| 14 | JD keyword-coverage heatmap in cockpit | F | 3 | 2 | 1.50 | ✅ |
| 15 | pgvector semantic evidence retrieval endpoint | C | 4 | 3 | 1.33 | ✅ |
| 16 | LLM-as-judge rubric quality gate (FF-QUALITY) | C | 4 | 3 | 1.33 | ⚠️ opt-in |
| 17 | Contact / relationship CRM context | D | 4 | 3 | 1.33 | ✅ |
| 18 | Adaptive drill difficulty + question bank | D | 4 | 3 | 1.33 | ✅ |
| 19 | Compensation-intelligence integration | C | 4 | 3 | 1.33 | ⚠️ opt-in |
| 20 | Community scan-provider SDK + adapter registry | A | 4 | 3 | 1.33 | ✅ |
| 21 | Multi-provider swap-test fitness function (FF-SWAP-1) | E | 3 | 3 | 1.00 | ✅ |
| 22 | Ollama offline-generation eval expansion | E | 3 | 3 | 1.00 | ✅ |
| 23 | Public eval leaderboard + model-routing recommendations | C | 3 | 3 | 1.00 | ✅ |
| 24 | PWA / installable mobile cockpit | F | 3 | 3 | 1.00 | ✅ |
| 25 | Voice drill mode (local Whisper STT) | D | 4 | 4 | 1.00 | ⚠️ opt-in/local-only |
| 26 | Semantic honesty-wall via local embeddings | C | 3 | 4 | 0.75 | ✅ |
| 27 | Neo4j GraphRAG people/company projection | C | 3 | 4 | 0.75 | ✅ |
| 28 | Supervised form pre-fill, human reviews & submits | B | 3 | 4 | 0.75 | ✅ |

---

## Proposal details

---

### 1 — Onboarding wizard + complete data-template

**Category:** Developer experience  
**Theme:** A — Ecosystem & Distribution  
**V:** 4 · **C:** 1 · **V/C:** 4.00 · ✅

The setup script handles prerequisites and `.env`, but a first-time user still populates
`truth/identity.yml`, `truth/evidence/registry.yml`, and their archetypes by hand. A guided wizard
walks through each required file with inline prompts and validation feedback, and an expanded
data-template ships with richer Jordan Doe examples covering more evidence types, drift scenarios,
and archetype patterns.

*Notes:* No new architectural decisions needed. Dependency: none. First PR to attempt for a new
contributor.

---

### 2 — Harden & publish the Selfwright MCP server + registry listing

**Category:** Platform  
**Theme:** A — Ecosystem & Distribution  
**V:** 5 · **C:** 2 · **V/C:** 2.50 · ✅

`apps/mcp` is built and tested but not listed in any MCP registry or ecosystem index. This item
covers the hardening pass — capability documentation, auth surface review, error-message hygiene
— and submits the server to the MCP registry so Selfwright tools are discoverable by any
MCP-compatible agent host.

*Notes:* Auth surface review should confirm that the MCP server's transport does not expose
private data to unauthenticated callers. Dependency: none, but items 3 and 4 benefit from a
published MCP server.

---

### 3 — JSON Resume import/export bridge

**Category:** Interoperability  
**Theme:** B — Interoperability & Standards  
**V:** 4 · **C:** 2 · **V/C:** 2.00 · ✅

An import command reads a JSON Resume–format file and produces a pre-populated evidence registry
and identity file. An export command renders the current evidence registry as a valid JSON Resume.
Lets users migrate in from LinkedIn exports and similar tools, and migrate out to any tool that
consumes the standard.

*Notes:* JSON Resume schema is stable at v1.0.0. The import direction requires careful mapping:
not all JSON Resume fields have a direct evidence-registry equivalent, so unmapped fields should
be surfaced in a migration report rather than silently dropped. Dependency: none.

---

### 4 — Package skills for agent-skills marketplace

**Category:** Distribution  
**Theme:** A — Ecosystem & Distribution  
**V:** 4 · **C:** 2 · **V/C:** 2.00 · ✅

The skills in `.claude/skills/` are modular but bundled with the framework. This item extracts
them into a standalone, versioned package for agent-skills marketplace submission, so any Claude
Code user can install and run Selfwright skills without cloning the full framework.

*Notes:* Skills that depend on Selfwright CLI commands must document those dependencies clearly.
The truth-floor and data-leak principles apply to skill outputs — packaging must not weaken those
guarantees. Dependency: item 2 (published MCP server) enables richer tool-use in standalone
skills.

---

### 5 — Scan-provider expansion

**Category:** Discovery  
**Theme:** F/A — Cockpit UX & Reach / Ecosystem & Distribution  
**V:** 4 · **C:** 2 · **V/C:** 2.00 · ✅

**Status: SHIPPING IN 0.6.0.** Oracle Fusion, Recruitee, Personio, Workable, schema.org JSON-LD,
Remotive, Himalayas, Breezy, WeWorkRemotely, and RemoteOK are being implemented in the current
release cycle and are not deferred backlog.

Further providers remain backlog due to API key requirements or terms-of-service constraints:
Teamtailor API, Rippling, JazzHR, Comeet, SAP SuccessFactors. Each needs either a paid API
access tier or clearer scraping terms before the adapter can be added.

*Notes:* New adapters must pass the SSRF egress guard (`FF-EGRESS`) and include a fitness-level
liveness test. Dependency: none beyond the existing `ScanProvider` port.

---

### 6 — Application funnel / cohort analytics in Reporting

**Category:** Analytics  
**Theme:** C — Intelligence & Retrieval  
**V:** 4 · **C:** 2 · **V/C:** 2.00 · ✅

A reporting view that tracks the full funnel from queue to screen to offer, segmented by
archetype, company size, and source channel. Shows where applications stall, which archetypes
convert, and how fit scores at queue time correlate with later outcomes.

*Notes:* Builds on the existing Postgres projection and Evidence.dev reporting profile. Data stays
local. Dependency: the Postgres projection (`sync-db`) must be running for full funnel data.

---

### 7 — Learning-roadmap tracker (gaps → plan → evidence)

**Category:** Coaching  
**Theme:** D — Coaching Depth  
**V:** 4 · **C:** 2 · **V/C:** 2.00 · ✅

Closes the loop between `gap-scan` output and deliberate skill development. Each gap generates a
tracked learning item with a target skill, a plan (course, book, or project), and a completion
check that writes a new evidence entry when the plan is done. A dashboard view shows the roadmap
and evidence coverage change over time.

*Notes:* The completion step must go through the standard evidence-entry flow to pass the truth
floor. No new schema changes needed; tracked items live in the private data directory.
Dependency: none, but pairs well with item 18 (adaptive drill).

---

### 8 — Salary-negotiation prep-pack kind

**Category:** Coaching  
**Theme:** D — Coaching Depth  
**V:** 4 · **C:** 2 · **V/C:** 2.00 · ✅

A new prep-pack variant (`prep-pack --kind negotiation`) that assembles BATNA analysis,
market-rate context, and evidence-backed counterpoints for a specific role offer. Pulls
compensation context from the private data directory; the pack stays local.

*Notes:* Compensation data never leaves the machine. The pack is generated via the same
truth-grounded prompt assembly used by other prep-pack kinds. Dependency: none; item 19
(compensation-intelligence integration) would enrich this with external market data if the user
opts in.

---

### 9 — Community archetype/ontology template library

**Category:** Ecosystem  
**Theme:** A — Ecosystem & Distribution  
**V:** 4 · **C:** 2 · **V/C:** 2.00 · ✅

A curated library of archetype templates for common senior IC and leadership tracks — Staff
Engineer, Engineering Manager, Product-focused Engineer, Data Engineering Lead, and others —
maintained as a separate versioned package. Users start from a community archetype and customize
it rather than building from scratch.

*Notes:* Templates ship as synthetic examples containing no real personal data. The existing
Jordan Doe fixtures demonstrate the pattern. Dependency: item 1 (onboarding wizard) can reference
the library during setup.

---

### 10 — schema.org JobPosting structured ingestion

**Category:** Discovery  
**Theme:** B — Interoperability & Standards  
**V:** 3 · **C:** 2 · **V/C:** 1.50 · ✅

The JSON-LD parser shipping in 0.6.0 (via item 5) handles dedup and basic field extraction.
This item adds enrichment: structured fields from the schema.org `JobPosting` payload — salary
range, remote type, required skills — are extracted and surfaced in scoring and the cockpit queue
view, not just used for deduplication.

*Notes:* schema.org compliance varies widely across job boards. The enrichment pass should be
best-effort with graceful fallback. Dependency: 0.6.0 JSON-LD parser (already shipping).

---

### 11 — Obsidian / markdown second-brain export

**Category:** Interoperability  
**Theme:** B — Interoperability & Standards  
**V:** 3 · **C:** 2 · **V/C:** 1.50 · ✅

Exports the evidence registry, gap list, application history, and coaching notes as a structured
Markdown vault compatible with Obsidian (or any markdown-based PKM). Users can browse and link
their career data in a tool they already use for knowledge management.

*Notes:* Export is one-way and read-only; the vault is not a writable back-channel into
Selfwright. Dependency: none.

---

### 12 — ATS multi-format render + parse-simulation lint

**Category:** Quality  
**Theme:** F — Cockpit UX & Reach  
**V:** 3 · **C:** 2 · **V/C:** 1.50 · ✅

Renders a tailored CV as DOCX, plain-text, and PDF, then runs a parse-simulation pass that checks
for common ATS parsing failures: multi-column layouts, inline graphics, non-standard fonts,
table-based structures. Reports a lint result before the human submits, not after.

*Notes:* The existing Typst renderer handles the rendering path. The lint pass is a separate
post-render check. Dependency: `adapters-render-typst`.

---

### 13 — Multi-channel digest (email/RSS/local file)

**Category:** Notifications  
**Theme:** F — Cockpit UX & Reach  
**V:** 3 · **C:** 2 · **V/C:** 1.50 · ✅

Extends the existing ntfy push digest to additional delivery channels: a daily email summary via a
locally-run SMTP relay, an RSS feed written to a local file, or a plain-text file at a configured
path. All channels carry the same IDs-only payload constraint — no company names, role titles, or
claim content.

*Notes:* SMTP relay must run locally (principle 6). No cloud email service. Dependency: none.

---

### 14 — JD keyword-coverage heatmap in cockpit

**Category:** Cockpit  
**Theme:** F — Cockpit UX & Reach  
**V:** 3 · **C:** 2 · **V/C:** 1.50 · ✅

A visual in the Queue page that overlays a job description's required keywords against the current
evidence registry, colored by coverage strength. Shows at a glance where the evidence is thick
and where tailoring will need to reach further.

*Notes:* The ATS parseability report already computes keyword gaps; this item surfaces that data
visually in the cockpit. Dependency: `FF-ATS` fitness check and the existing ATS scoring path.

---

### 15 — pgvector semantic evidence retrieval endpoint

**Category:** Retrieval  
**Theme:** C — Intelligence & Retrieval  
**V:** 4 · **C:** 3 · **V/C:** 1.33 · ✅

A semantic search endpoint over the Postgres projection's pgvector column, returning the top-k
most semantically relevant evidence entries for a given query string. Enables smarter prompt
assembly: instead of injecting all evidence for a competency, inject only the entries closest to
the JD claim being addressed.

*Notes:* Requires the Postgres + pgvector profile and local embeddings via Ollama. Both are
already Docker-profileable. Dependency: `sync-db`, Ollama embeddings profile.

---

### 16 — LLM-as-judge rubric quality gate (FF-QUALITY)

**Category:** Quality  
**Theme:** C — Intelligence & Retrieval  
**V:** 4 · **C:** 3 · **V/C:** 1.33 · ⚠️ opt-in

An opt-in fitness check that runs a structured LLM rubric over generated artifacts: coherence,
specificity, truth-trace density, and tone. Ships alongside the deterministic gates but cannot
override them. Adds a quality signal that regex and token-matching checks structurally cannot
produce.

*Notes:* Opt-in because it requires `--adapter` and an active model session — it cannot run in
default CI. A failing `FF-QUALITY` check is advisory only unless the owner configures it as a
hard gate. The publish-check skill (ADR 0022) demonstrates the pattern. Dependency: CLI adapter
or LiteLLM proxy.

---

### 17 — Contact / relationship CRM context

**Category:** Research  
**Theme:** D — Coaching Depth  
**V:** 4 · **C:** 3 · **V/C:** 1.33 · ✅

A lightweight contacts module in the private data directory: named contacts, their relationship to
a company or role, interaction history, and potential referral paths. The prep-pack and research
kinds pull relevant contacts as context, surfacing warm paths the human may want to activate
before applying.

*Notes:* Contacts live in the private data directory (never the framework repo). The named-entity
scanner's blocklist derives from this file at hook time — it must remain consistent with the
existing blocklist derivation logic. Dependency: none, but item 27 (Neo4j GraphRAG) would enable
path-finding across the contacts graph.

---

### 18 — Adaptive drill difficulty + question bank

**Category:** Coaching  
**Theme:** D — Coaching Depth  
**V:** 4 · **C:** 3 · **V/C:** 1.33 · ✅

The current drill picks the next topic deterministically from gap scores. This item adds a
question bank per topic and an adaptive difficulty ladder: the bank tracks which questions have
been answered at what confidence and routes harder variants after a confident pass. Drill sessions
get shorter and more targeted over time.

*Notes:* The question bank lives in the private data directory. The difficulty ladder is
deterministic logic in `packages/core`. Dependency: item 7 (learning-roadmap tracker) informs
which topics need the most drilling attention.

---

### 19 — Compensation-intelligence integration

**Category:** Research  
**Theme:** C — Intelligence & Retrieval  
**V:** 4 · **C:** 3 · **V/C:** 1.33 · ⚠️ opt-in

Pulls market salary data from a configured source — Levels.fyi API, Glassdoor export, or a local
YAML file the user maintains — and surfaces it in scoring and prep-pack context. The local-file
variant works fully offline.

*Notes:* Any external API call routes through the SSRF egress guard and requires explicit
configuration (principle 6). Opt-in because the default path should never make outbound calls to
salary data providers without the user setting it up. The local-file variant is ✅; the external
API variants are ⚠️. Dependency: none for the local-file path; item 8 (negotiation prep-pack)
benefits most from this data.

---

### 20 — Community scan-provider SDK + adapter registry

**Category:** Ecosystem  
**Theme:** A — Ecosystem & Distribution  
**V:** 4 · **C:** 3 · **V/C:** 1.33 · ✅

A typed SDK and contribution guide that makes it possible to write and publish a third-party scan
provider without forking the framework. Includes a public adapter registry where community
providers can list their packages and a fitness-function stub that community adapters must pass
before listing.

*Notes:* The SDK is the existing `ScanProvider` port, documented and packaged for external use.
The registry is a maintained YAML or JSON file in the framework repo (not a separate service).
Dependency: item 2 (hardened MCP server) demonstrates the pattern for publishing framework
components.

---

### 21 — Multi-provider swap-test fitness function (FF-SWAP-1)

**Category:** Quality  
**Theme:** E — Model Portability & Local-First Rigor  
**V:** 3 · **C:** 3 · **V/C:** 1.00 · ✅

A fitness check that runs the scan → score → tailor pipeline twice — once with the default model,
once with a configured alternate — and diffs the outputs for deterministic fields. Guards against
provider-specific behavior creeping into code that should be provider-agnostic.

*Notes:* Requires two configured adapters to run. Can run locally; CI runs it only if both
adapters are available. Dependency: at least two LLM adapters configured.

---

### 22 — Ollama offline-generation eval expansion

**Category:** Quality  
**Theme:** E — Model Portability & Local-First Rigor  
**V:** 3 · **C:** 3 · **V/C:** 1.00 · ✅

The Ollama adapter is wired and working, but the eval harness covers a narrow set of prompts.
This item expands the eval suite to cover cover-letter generation, prep-pack generation, and drill
critique at the same depth as the CLI adapter evals, producing a comparable quality report across
local and cloud model paths.

*Notes:* Eval outputs stay local; no personal data enters the comparison. Dependency: Ollama
Docker profile running with at least one evaluated model.

---

### 23 — Public eval leaderboard + model-routing recommendations

**Category:** Transparency  
**Theme:** C — Intelligence & Retrieval  
**V:** 3 · **C:** 3 · **V/C:** 1.00 · ✅

Publishes aggregated, anonymized eval results across model and adapter combinations in a table in
the repository: quality scores, truth-trace pass rates, latency. Lets users choose their adapter
based on real benchmark data rather than general reputation.

*Notes:* Aggregated before publishing — no personal artifacts, evidence content, or identifying
context. Publishing is a manual step by the maintainer after each eval run. Dependency: items 21
and 22 for a meaningful multi-provider dataset.

---

### 24 — PWA / installable mobile cockpit

**Category:** Cockpit  
**Theme:** F — Cockpit UX & Reach  
**V:** 3 · **C:** 3 · **V/C:** 1.00 · ✅

Adds a web app manifest and service worker to the cockpit so it can be installed as a PWA on
mobile devices. The same Tailscale-served cockpit gains a native-app-like launch from the home
screen, with no new hosting or public exposure.

*Notes:* Service worker scope must be restricted to the cockpit origin. The Tailscale-only
access model (principle 6) is unchanged — the PWA loads from the tailnet, not the public
internet. Dependency: ADR 0016 (Tailscale Serve configuration).

---

### 25 — Voice drill mode (local Whisper STT)

**Category:** Coaching  
**Theme:** D — Coaching Depth  
**V:** 4 · **C:** 4 · **V/C:** 1.00 · ⚠️ opt-in/local-only

An opt-in drill mode where the user speaks their answer and Whisper — running locally via a
Docker profile — transcribes it before the coaching pass. Adds a rehearsal channel closer to a
real interview without sending audio outside the machine.

*Notes:* Opt-in/local-only: requires the Whisper Docker profile; audio never leaves the machine.
The SSRF egress guard is unchanged. No cloud STT service is permitted under principle 6.
Dependency: Whisper Docker profile.

---

### 26 — Semantic honesty-wall via local embeddings

**Category:** Quality  
**Theme:** C — Intelligence & Retrieval  
**V:** 3 · **C:** 4 · **V/C:** 0.75 · ✅

Extends the keyword-based honesty-wall to semantic similarity: a retired drift phrase that the
current check misses due to paraphrase is caught by embedding distance. Runs against the local
pgvector store; no external model call. Higher true-positive detection rate at the cost of a
Postgres + embeddings dependency.

*Notes:* The deterministic keyword check remains the primary gate; this is an additional layer.
Dependency: pgvector projection (`sync-db`) and local embeddings via Ollama. Items 15 reuses the
same infrastructure.

---

### 27 — Neo4j GraphRAG people/company projection (deferred)

**Category:** Retrieval  
**Theme:** C — Intelligence & Retrieval  
**V:** 3 · **C:** 4 · **V/C:** 0.75 · ✅

A Neo4j graph projection of the evidence registry, contacts, companies, and role history, enabling
graph-based retrieval for research and prep-pack generation — finding paths between your evidence
and a company's known initiatives, or between contacts and open roles. Deferred until the contacts
module (item 17) and semantic retrieval (item 15) are established and in use.

*Notes:* ADR 0009 documents the existing pgvector projection decision and the rationale for
keeping Neo4j optional. This item does not replace pgvector; it adds a graph traversal layer for
relationship-oriented queries. Dependency: items 15 and 17.

---

### 28 — Supervised form pre-fill, human reviews & submits

**Category:** Application workflow  
**Theme:** B — Interoperability & Standards  
**V:** 3 · **C:** 4 · **V/C:** 0.75 · ✅

A browser extension or Playwright script that reads a tailored CV and fills the visible fields of
an ATS application form. The human reviews the pre-filled form field by field and clicks Submit.

Now fully aligned under the human-in-the-loop principle (ADR 0025, 2026-07-13): the automation
stops before the final submit control; the human submits. The script never reaches the submit
button.

*Notes:* Must pass the SSRF egress guard for any browser navigation. The submit action is
performed by the human, not by any Selfwright code path. Dependency: a tailored CV artifact and
ATS form access. Complexity reflects the per-ATS adapter surface, not the constitutional question
(which is resolved).

---

### 29 — Cross-platform scheduling + verified macOS/Linux support

**Category:** Platform  
**Theme:** A — Ecosystem & Distribution  
**V:** 5 · **C:** 3 · **V/C:** 1.67 · ✅

**Status: near-term — coming soon.**

The scheduling automation (weekly scan, daily digest) ships as Windows Scheduled Tasks and PowerShell `.ps1` scripts. This item delivers cron job equivalents for Linux and launchd plists for macOS, plus a formally tested macOS/Linux support matrix — confirming that the CLI, MCP server, cockpit, and scanner run correctly on both platforms.

*Notes:* The core is already Node/TypeScript with no OS-specific dependencies; the work here is scheduling scripts, CI matrix expansion, and hardware verification. A passing CI run on a Linux runner and a tested macOS run constitutes done. Dependency: none.

---

### 30 — One-command install across platforms

**Category:** Distribution  
**Theme:** A — Ecosystem & Distribution  
**V:** 4 · **C:** 2 · **V/C:** 2.00 · ✅

Replace clone + `pnpm install` with a single command per platform: an `npm`/`npx` global binary, a Homebrew formula or tap (macOS/Linux), and an `irm ... | iex` PowerShell one-liner (Windows). The full setup sequence runs under the hood; the user gets a working `selfwright` binary without cloning the repo first.

*Notes:* The npm/npx path packages the CLI and setup script as a published npm package. The Homebrew formula requires a maintained tap repository. The PowerShell one-liner wraps the npm path or a standalone installer. All three must preserve the existing data-directory pattern and the `--init-template` / `--clone-data` flags. Dependency: item 1 (onboarding wizard) pairs naturally with a smoother first-run path.

---

## Community proposals

This section will list proposals submitted by community members that are under owner review.

To propose an item, open a GitHub issue using the template below. The owner reviews all proposals
and decides whether to add them to the ranked list, request more detail, or decline with a reason.
Issues are the right channel — not PRs — for new proposals.

---

### Proposal template

```
Title: [Short name for the proposal]
Category: [What area of the platform does it affect?]
Theme: [A / B / C / D / E / F — or propose a new one]
User-facing description: [2-4 sentences: what problem does this solve, and how does it solve it?]
Constitutional flag: [Does it tension any CONSTITUTION.md principle? Which one, and how?]
Dependencies: [Existing items or architectural decisions it builds on]
Estimated complexity (1-5): [Your estimate, with a brief rationale]
```

Proposals that tension a constitutional principle need to include a proposed ADR outline before
they can be accepted. Proposals without that context will be asked for it during review.

---

### Contribution note

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full process: DCO sign-off, PR conventions, and
the fitness gate requirements that any implementation PR must pass. The backlog is not the
same as the roadmap — being listed here does not guarantee the item ships, or when.
