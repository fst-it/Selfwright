---
name: score
description: Score a job description against your archetypes to get a deterministic fit signal (archetype match, grade, 7-dimension full-JD fit score — 6 dimensions at scan time). Use when the user wants to know how well a role fits, asks to "score this JD", or is deciding whether a role is worth pursuing.
argument-hint: "<jd-path>"
---

# score

Runs Selfwright's deterministic full-JD fit scorer against the owner's truth-layer archetypes
(`packages/core/src/scoring/jd-score.ts`'s `scoreJd`). The 7 weighted dimensions are: evidence
coverage (25%), domain match (20%), leadership match (15%), seniority (10%), geo fit (10%),
company type (10%), keyword density (10%). Title family is included in output as an informational
field (0% weight) but does not contribute to the score. At scan time, `scorePosting` uses 6
dimensions (the same set minus evidence coverage and keyword density).

## How to run it

Requires `SELFWRIGHT_DATA_DIR` to be set in the environment (the truth-layer data vault).

```
pnpm selfwright score <jd-path>
```

`<jd-path>` is a file containing the job description text (plain text or markdown).

## Interpreting the output

The command prints JSON: `{ archetype, fit_score, grade, why_surfaced, dimensions }`.

**Important — this is a pre-filter signal, not a verdict (D-4 / ADR-0004).** The deterministic
score is a compressed, keyword/evidence-overlap scale — strong roles routinely score 2.0-3.0/C-D
here even when a holistic human or LLM read would call them a strong 4+ fit. The only thing this
score actually gates is non-degeneracy: `archetype !== null` and `grade !== "F"` means the role
matches a real archetype at all. Do not tell the user a role is "bad" because the deterministic
grade is low — report the number, the matched/missing dimensions from `why_surfaced`, and let the
user (or a holistic read of the JD) make the actual judgment call. If `archetype` is `null` or
`grade` is `"F"`, that's the one meaningful signal: the role doesn't match any of the owner's
archetypes at all.
