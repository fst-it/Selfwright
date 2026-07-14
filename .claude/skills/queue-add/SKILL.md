---
name: queue-add
description: Manually add a job posting to the pipeline queue from pasted text (LinkedIn-safe; no URL fetching). Use when the user pastes a LinkedIn or other job posting URL and JD text and wants to add it to the queue, or when the user says "add this to my pipeline" without going through the automated scanner.
argument-hint: "--url <url> --company <name> --role <title> [--jd-file <path> | --jd-stdin]"
---

# queue-add

Adds a manually captured job posting to the pipeline queue (`pipeline/queue.yml`) and records the
URL in the seen ledger (`pipeline/scan-history.yml`) so a future automated scan never re-surfaces
the same posting.

## IMPORTANT: no-scraping rule (PLAN.md D3)

LinkedIn's Terms of Service prohibit automated scraping. **Never fetch the LinkedIn URL.** The user
must paste the job description text directly into chat. Extract company name and role title from
the pasted text — do NOT navigate to or fetch the URL.

## How to run it (co-pilot flow)

When a user shares a job posting URL and description:

1. **Extract** company name and role title from the pasted text.
2. **Run the CLI** to add the entry:
   ```
   pnpm selfwright queue-add \
     --url "<posting-url>" \
     --company "<company name>" \
     --role "<role title>" \
     --jd-stdin
   ```
   Pipe the pasted JD text via `--jd-stdin` (or write it to a temp file and use `--jd-file`) so
   `queue-add` scores the posting automatically.

3. **Report** the result:
   - If added: the `MAN-` queue id and fit score.
   - If rejected by dedup: the existing entry id and why (already in queue / already applied).

## MCP alternative

The `queue_add` tool mirrors the CLI. Pass `url`, `company`, `role`, and optionally `jd_text`.

## Interpreting the output

- `MAN-<hash>` — the new queue entry id. The hash is derived from the URL — same URL always
  produces the same id.
- `fit_score` — deterministic scan-time score (same rubric as `pnpm selfwright score`). Like the scan
  skill, this is a pre-filter signal only: a low score doesn't mean the role is bad.
- Dedup rejection messages name the existing entry so the user can find it in `pnpm selfwright inbox`.
