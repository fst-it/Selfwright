---
name: debrief
description: Capture an interview debrief and derive gap/drill hints from it. Use immediately after a real interview while details are fresh. Produces a structured debrief record in coaching/debriefs.yml and surfaces any wobbled or unanswered topics as gap hints.
argument-hint: "<application-id>"
---

# debrief

Interview debriefs close the coaching loop: they turn real interview signals back into the gap and drill system, so rehearsal targets the topics that actually came up in the room, not just the ones predicted from the job description.

## Privacy rule (hard constraint)

**Never include interviewer or any person's name in a debrief.** The data repo's PII hook blocks names outside `contacts/` and `truth/` — any such entry will be rejected. If you need to reference a person, use their `contacts/` id (e.g. `contact-123`).

## The capture flow

1. **Start the conversation.** Ask the owner:
   - Which application? (needed to link the debrief — use the application id from `applications.yml`)
   - What date did the interview happen? (YYYY-MM-DD)
   - What round/stage was it? (e.g. `recruiter-screen`, `technical-1`, `values`)
   - What topics did they ask about?
   - Which topics did you wobble on or feel uncertain about?
   - Which topics went well?
   - Any other notes? (describe situations, not people; no names)

2. **Write the debrief.** Call the CLI (or MCP `add_debrief`) with the collected details:

   ```
   pnpm selfwright debrief add \
     --app <application-id> \
     --date <YYYY-MM-DD> \
     --round <round-label> \
     --asked "system design;behavioural leadership;data modelling" \
     --wobbled "system design;data modelling" \
     --went-well "behavioural leadership" \
     --notes "Focused heavily on distributed systems at scale"
   ```

   Topics in `--asked`, `--wobbled`, and `--went-well` are semicolon-separated strings. Topics are
   stored as-is but matched case-insensitively when deriving gap hints.

3. **Check gap hints.** Run gap-scan to see debrief-derived hints alongside coverage gaps:

   ```
   pnpm selfwright gap-scan <archetype-id>
   ```

   The "Debrief-derived hints" section lists wobbled and unanswered topics ranked by frequency across
   all debriefs. These are **suggestions only** — they are never auto-written to `gaps.yml`. Review
   them and decide which ones to formalise as gap entries.

4. **Check the inbox.** Applications at `interview` status with no debrief logged appear in
   `reviewSoon` as a nudge:

   ```
   pnpm selfwright inbox
   ```

## What to do with wobbled topics

Debrief hints highlight where to focus next drill sessions. The natural next steps after capturing a debrief:

- Run `pnpm selfwright drill <archetype-id>` — the drill system picks the highest-priority gap, which
  may now align with your debrief hints if you decide to formalise them.
- If a wobbled topic has no matching gap entry yet, consider adding one via `gaps.yml` so it enters
  the weighted drill rotation.

## What never to do

Never record a person's name in any debrief field. Never auto-promote debrief hints to `gaps.yml`
without owner review — the hints are signals, not decisions.
