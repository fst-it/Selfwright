---
name: inbox
description: Show the 3-tier signal digest (Decide-now / Review-soon / FYI) across the application pipeline, queue, and drift ledger. Use when the user asks what's pending, what needs a decision, or "what's in my inbox".
---

# inbox

Prints the deterministic 3-tier digest built from `Selfwright-data/applications/applications.yml`,
`pipeline/queue.yml`, and the drift ledger (`packages/core/src/services/inbox.ts`).

## How to run it

Requires `SELFWRIGHT_DATA_DIR` set.

```
pnpm selfwright inbox [--format json|text]
```

Default is a human-readable text digest with three sections:

- **🔴 Decide-now** — items genuinely blocking on a human decision (e.g. an active drift with no
  application yet attached, an overdue follow-up).
- **🟡 Review-soon** — queued/pending items worth a look but not urgent.
- **ℹ️ FYI** — informational, no action implied.

Use `--format json` when you need to process the digest programmatically rather than just show it
to the user.

## What this is not

The inbox is a plain reflection of the data files on disk — it doesn't rank or prioritize beyond
the deterministic tier assignment already in `inboxService`. Don't editorialize about urgency
beyond what the tier itself says; if the user wants prioritization advice, that's a judgment call
for the conversation, not something the tool computes.
