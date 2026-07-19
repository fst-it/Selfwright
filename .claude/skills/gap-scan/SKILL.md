---
name: gap-scan
description: Compare an archetype's target keywords against your evidence registry to surface skill/evidence gaps, or validate the gaps.yml ledger. Use when the user wants to know what's uncovered for a role type, wants a "learning plan," or asks to check gaps.yml.
argument-hint: "<archetype-id>"
---

# gap-scan

Fully deterministic — no LLM call, nothing written to `gaps.yml` automatically. Compares an
archetype's `match_keywords` against the evidence registry's actual coverage
(`packages/core/src/coaching/coverage.ts`'s `computeCoverageGaps`) and reports three tiers:
`covered` (a registered keyword hit), `partial` (token overlap but no curated keyword), `uncovered`
(neither).

## How to run it

Requires `SELFWRIGHT_DATA_DIR` set.

```
pnpm selfwright gap-scan <archetype-id>
```

Prints a report grouped uncovered-first (the actionable part), each line showing the topic, its
tier, and either supporting `EVD-*` ids or an `existingGapId`/`suggestedGapId`.

## Turning a candidate into a tracked gap

This command **never writes** `gaps.yml` — it only surfaces candidates. A `suggestedGapId` (e.g.
`GAP-DATA-MESH`) is a plain string suggestion, not a promise it's a good one. If the owner wants to
track a gap for drilling:

1. Draft the row yourself (in this session), following the existing `Gap` shape (`id: GAP-*`,
   `title`, `honest_gap`, `frame`, `tag`, `evidence_ids`, `company_specific`) — `title` should
   contain the keyword phrase so future scans link it to this row automatically.
2. **`honest_gap`/`frame` are the most persuasion-shaped text in this system — never invent them
   speculatively.** Draft them only from what the owner actually tells you about the gap; if you
   don't know the honest framing, ask rather than guessing a plausible-sounding one.
3. Append the row to `truth/gaps.yml` by hand (create the file with a bare YAML list if it doesn't
   exist yet).
4. Validate it: `pnpm selfwright gap-scan <archetype-id> --check` (the archetype id is still required as a
   positional argument even though `--check` validates the whole ledger, not just that archetype —
   any valid id works). This runs `validateGapArtifact` against every row —
   every `evidence_ids` entry must exist in the registry, the honesty boundary must hold, and
   `frame` must itself trace to the evidence it cites. Fix whatever it flags before considering the
   row done.

Once a gap is in `gaps.yml` and passes `--check`, it's picked up automatically by `/drill`'s topic
selection (gaps are weighted above pure-strength topics) and by `/prep-pack`'s "Gaps to rehearse"
section.
