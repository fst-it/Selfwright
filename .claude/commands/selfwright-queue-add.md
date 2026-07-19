---
description: Manually add a job posting to the pipeline queue from pasted text (LinkedIn-safe)
---

Follow the `queue-add` skill's instructions.

The user has shared a job posting. Extract company and role from the pasted text, then run
`pnpm selfwright queue-add` (or the `queue_add` MCP tool) and report the queue id, fit score, and any
dedup rejections. $ARGUMENTS
