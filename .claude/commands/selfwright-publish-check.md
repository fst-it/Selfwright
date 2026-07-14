---
description: Advisory LLM review of outgoing diff for contextual PII, semantic leaks, and ungrounded claims. Mandatory before opening or updating any PR.
---

Follow the `publish-check` skill's instructions to collect the outgoing diff (using $ARGUMENTS as the ref range if provided, otherwise defaulting to `origin/main...HEAD`), apply the rubric section by section, and report findings with file/line, category, and severity. End with the exact verdict line (`PUBLISH-CHECK: CLEAN` or `PUBLISH-CHECK: N FINDINGS`). $ARGUMENTS
