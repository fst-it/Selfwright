---
name: research
description: Draft company/role research for a specific application, co-piloted (no LLM API call — you write it, a deterministic validator checks it). Use when the user wants company research done or checked for a role.
argument-hint: "<company> <role-title> <jd-path>"
---

# research

Same co-pilot pattern as the `cover` skill (D-1, ADR 0006): `pnpm selfwright research` assembles a
grounded prompt and stops; you write the document; `pnpm selfwright research --check` validates it.

## The loop

1. **Assemble the prompt** (no LLM call, no network):
   ```
   pnpm selfwright research "<Company>" "<Role Title>" <jd-path> [--out <out-path>]
   ```
   Writes a research prompt next to the JD file (default: `<jd-dir>/research-prompt.md`; the
   output path defaults to `<jd-dir>/company-research.md`).

2. **Write the research document yourself**, using real public sources (the owner's own
   knowledge, or web search if you have that capability in this session — never invent company
   facts). Structure it like: a company snapshot (business, tech posture, culture — pure facts
   about the company, no claim about the candidate needed here), what the role needs, and a
   positioning section bridging the JD's needs to the candidate's actual evidence.

   **Important nuance the validator enforces:** only sentences that reference the *candidate*
   (first-person "I"/"my", or the candidate's name) are checked against the evidence registry.
   Plain company facts (revenue, org structure, culture, tech stack) are exempt from that check —
   write them naturally, don't contort every sentence to mention the candidate just to "prove"
   it's grounded. The positioning section's candidate-referencing sentences *do* need to trace
   to real evidence, same as the cover-letter skill's rule.

3. **Validate:**
   ```
   pnpm selfwright research "<Company>" "<Role Title>" <jd-path> --check
   ```
   (Or pass `--out` matching wherever you wrote the file, if you used a custom path.) No
   word-count rule here, unlike `cover`. Fix flagged violations the same way — reword or
   re-anchor the specific sentence named, don't rewrite blind.
