---
name: ats
description: Run ATS parseability + keyword pass-through analysis for a CV against a job description. Use when the user asks whether a CV will pass ATS screening, wants an ATS score, or asks about keyword coverage.
argument-hint: "<jd-path> <cv-content.json> [--threshold <n>]"
---

# ats

Runs the two-pass ATS check (`packages/core/src/scoring/ats.ts`): Pass A (structural
parseability — sections present, contact fields, period formats, bullet length, no markdown
tables) and Pass B (JD keyword/ontology coverage, split into truthfully-covered vs. genuinely
missing terms).

## How to run it

Requires `SELFWRIGHT_DATA_DIR` set (loads the evidence registry + ontology).

```
pnpm selfwright ats <jd-path> <cv-content.json> [--threshold <n>] [--out <file>]
```

Default pass threshold is 0.80 (overall). `--out` writes the JSON report to a file instead of
stdout.

## Interpreting the output

`{ passA: {score, checks[]}, passB: {score, jdTermsCount, covered[], missingTruthful[],
missingUnsupported[]}, overall, threshold, passes }`.

- `missingTruthful` — JD terms the CV genuinely doesn't cover, but for which the evidence
  registry *does* have supporting `EVD-*` entries. These are legitimate additions to raise via a
  tailoring overlay (`suppress_evidence`/`include_evidence`/bullet reordering) — never by
  inventing new CV text.
- `missingUnsupported` — JD terms with no evidence-registry backing at all. **Never suggest
  adding these to the CV** — that would be fabrication, a direct truth-floor violation. Surface
  them to the user as an honest gap to address verbally in an interview, not a CV edit.
