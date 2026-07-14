---
name: cover
description: Draft a truth-grounded cover letter for a specific application, co-piloted (no LLM API call — you write it, a deterministic validator checks it). Use when the user wants a cover letter drafted or checked for a role.
argument-hint: "<app-dir>"
---

# cover

Selfwright's cover-letter generation is co-piloted by design (D-1, ADR 0006): there is no LLM
gateway call. `pnpm selfwright cover` assembles a truth-grounded prompt and stops; **you** (this
session) write the actual letter from it; `pnpm selfwright cover --check` then validates the result
deterministically (truth-trace, honesty walls, format rules).

## The loop

An "app-dir" is a folder holding one application's working files. It needs `job-description.md`
and `cv-tailored.json` (produced by the `tailor` skill/command) already present.

1. **Assemble the prompt** (no LLM call, no network):
   ```
   pnpm selfwright cover <app-dir>
   ```
   Writes `<app-dir>/cover-prompt.md` (system + user prompt, grounded in the tailored CV,
   identity, honesty boundaries, and optional company research if `company-research.md` exists
   in the same folder).

2. **Draft the letter yourself.** Read `cover-prompt.md`. Write `<app-dir>/cover-letter.md`
   following its instructions exactly:
   - 350-400 words.
   - Never open with "I am writing to...".
   - Every substantive claim must be traceable to the tailored CV / evidence registry — draw
     phrasing closely from the tailored CV's actual bullets and summary rather than paraphrasing
     loosely, since the validator checks keyword overlap against the evidence registry per
     sentence.
   - Respect the honesty boundaries listed in the prompt exactly (e.g. "value not revenue",
     specific retired phrases, band-restricted claims) — these are absolute, not stylistic
     suggestions.

3. **Validate:**
   ```
   pnpm selfwright cover <app-dir> --check
   ```
   Exits 0 with "OK" when clean. On failure it lists specific violations (`Untraceable claim(s):
   ...`, `retired evd-retired: "..."`, `Word count N outside the 350-400 range`, or the banned
   opening). Fix the specific sentence(s) named and re-run `--check` — don't rewrite the whole
   letter blind. A word-count miss is usually fixed by adding/trimming one supporting sentence
   grounded in another evidence-registry claim, not padding with filler.

## What never to do

Never fabricate a claim to fill space or sound stronger — if `--check` flags something as
untraceable, the fix is to remove/reword it or find the real evidence-registry entry it should
map to, never to keep it and hope the reviewer doesn't notice.
