---
name: topics
description: Generate a weekly content-topic digest (3–5 ranked, cited topics to write and read) grounded in real evidence and skill gaps — or generate per-application topic suggestions. Use when the user wants to know what to write about, asks for "weekly topics", "content digest", "top voice suggestions", "what should I publish", or "content ideas for this application".
argument-hint: "<archetype-id> | --app <app-dir>"
---

# topics

Content strategy is co-piloted, the same discipline as `cover`/`drill`: `pnpm selfwright topics`
deterministically selects the candidates and assembles a grounding bundle, but the actual research
and ranking happens live, in this session — never headlessly. The truth floor applies: every
**write** topic must be backed by real evidence the owner can cite; every **read** topic must
trace to a known gap or credibility-gap in the evidence registry.

Two modes:
- **Digest mode** (`<archetype-id>`): weekly cadence, freshness decay prevents back-to-back
  repeats, candidates are split write (evidence-backed strength) and read (gaps to close).
- **Application mode** (`--app <app-dir>`): JD-driven, fully deterministic per JD, no freshness
  decay — gives the owner targeted topics to write about for a specific role.

## The loop

### 1. Deterministic candidate selection (no LLM call)

```
pnpm selfwright topics <archetype-id>
```
or
```
pnpm selfwright topics --app <app-dir>
```

Selects topic candidates via `selectContentTopics` (digest) or `selectContentTopicsForApplication`
(application), writes the grounding prompt to:
- Digest: `<SELFWRIGHT_DATA_DIR>/content/topics-prompt.md`
- Application: `<app-dir>/topics-prompt.md`

Also appends the selected topics to `content/content-history.yml` (digest mode only) so the next
digest run picks fresh topics via freshness decay.

Prints a summary table of all candidates with their direction, kind, and supporting EVD-* ids.

### 2. Research each candidate topic on the live web

Use the grounding bundle from step 1 to focus the research. **30-day freshness window** — prefer
sources published or updated within the last 30 days. Prefer high-engagement, authoritative sources
(conference talks, technical blogs, practitioner reports, community discussions with high upvotes/
engagement) over SEO-driven overview pages.

**Privacy rule (hard):** web search queries must contain ONLY generic topic terms. Never include
the owner's name, employer names, application targets, or any content from `Selfwright-data`
beyond the topic phrase itself. Correct: `"data mesh implementation 2026 best practices"`.
Incorrect: `"[owner name] data mesh"` or `"[company] platform engineering"`.

For each candidate:
- Run 1–2 targeted searches using the topic phrase
- Note the highest-quality sources with real URLs
- Identify what is current (last 30 days) and what is the main conversation angle right now

### 3. Produce the digest

Write the digest in this exact format:

```markdown
## Topics to write

- [Topic title] — [1-sentence angle grounded in EVD-* evidence] (EVD-001, EVD-002)
  Sources: https://...

## Topics to read

- [Topic title] — [1-sentence explanation of why this gap matters] (GAP-A)
  Sources: https://...

Grounding: EVD-001, EVD-002, GAP-A
```

Rules:
- 3–5 topics TOTAL across both sections (not 3–5 each)
- Each topic is a markdown list item starting with `- ` at line start
- Every topic item must include at least one real `https://` URL
- **Write topics** must cite the EVD-* ids from the provided bundle — never claim experience
  beyond what the cited entries support; draw the angle from the actual evidence text
- **Read topics** must reference the GAP-* id where present
- The `Grounding:` line appears AFTER `## Topics to read`, listing every EVD-*/GAP-* id cited
- Never invent evidence, metrics, titles, or source URLs

Save to:
- Digest: `<SELFWRIGHT_DATA_DIR>/content/digests/<YYYY-MM-DD>-<archetype-id>.md`
- Application: `<app-dir>/topics.md`

### 4. Validate

```
pnpm selfwright topics <archetype-id> --check <digest-path>
```
or
```
pnpm selfwright topics --app <app-dir> --check <digest-path>
```

Exits 0 when clean. Violations name the exact rule broken — fix the specific line, then re-run
`--check`. Never rewrite the whole digest blind.

Common violations and how to fix:
- "Missing required heading: ## Topics to write" → add the heading verbatim
- "Combined topic count is N; must be between 3 and 5" → add or remove topic list items
- "Topic item missing a source URL" → add an `https://` URL to the flagged item
- "## Topics to write section must cite at least one EVD-* id" → add an EVD-* citation
- "Missing required 'Grounding:' line after the '## Topics to read' section" → add `Grounding: EVD-..., GAP-...` as the last line after the read section
- "Untraceable claim(s)" → remove first-person claims about the owner that aren't backed by the evidence bundle

## What never to do

Never fabricate a source URL to fill a citation. If you can't find a real source for a topic
within the 30-day window, replace the topic with one you can back with real sources. Never
claim the owner has experience or expertise beyond what the EVD-* bundle explicitly states.
