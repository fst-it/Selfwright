---
name: drill
description: Run an interactive interview-practice drill grounded in a target archetype and the real evidence registry — asks one question, critiques the answer against the evidence, never lets an untraceable claim pass uncorrected. Use when the user wants to rehearse interview answers or practice a specific gap/topic.
argument-hint: "<archetype-id>"
---

# drill

Interview rehearsal is co-piloted, the same discipline as `cover`/`prep-pack`: `pnpm selfwright drill`
deterministically picks the next topic and assembles a grounding bundle, but the question is asked
and the answer critiqued live, in this session — never headlessly. The truth floor applies at full
strength here: this is the highest-stakes rehearsal surface in Selfwright, since the whole point is
practicing what the owner will say out loud in a real interview.

## The loop

1. **Get the next topic** (no LLM call):
   ```
   pnpm selfwright drill <archetype-id>
   ```
   Picks the next topic via `selectNextDrillTopic` (known gaps from `gaps.yml` are weighted above
   pure-strength topics, with a freshness rule so the same topic never repeats back-to-back) and
   writes the grounding bundle — the topic, its kind (`gap`/`stretch`/`strength`), and the relevant
   evidence entries — to a prompt file. It also appends the topic to `coaching/drill-history.yml`
   so the next run picks something fresh.

2. **Ask ONE question yourself**, grounded only in the bundle you were just handed. Never invent
   evidence, systems, or metrics outside it. If the topic's kind is `gap`, probe exactly what the
   gap's `title` names — don't reveal the gap's `honest_gap`/`frame` in the question itself.

3. **The owner answers.**

4. **Critique the answer** — work this checklist in order and report every hit:

   1. **Traceability.** Take each factual claim in the answer — every named system, title, scope,
      employer, metric. For each, point to the specific `EVD-*` in the bundle (or, for a gap, to
      the `honest_gap` text) that supports it. Any claim with no support in the bundle is an
      **OVER-CLAIM**: quote the exact words and state what is missing. Do not accept a claim
      because it sounds plausible — an untraceable claim in practice becomes an untraceable claim
      in the room.
   2. **Honest framing is not over-claiming.** Distinguish "I haven't done X directly, but I led
      the architecture / assessed it / have working knowledge" from "I did X." The first is the
      target behaviour — reward it. Only flag when the owner asserts a depth or ownership the
      evidence doesn't carry. Read each cited entry's `honesty` note as a hard constraint (e.g.
      "AWS strong; GCP/Azure aware-only" means claiming multi-cloud depth is an over-claim even
      though cloud is covered).
   3. **Metric fidelity.** Any number in the answer must match the cited entry's `metric` field
      verbatim, framing word included. "$55M value" is correct; "$55M revenue" is a **violation**
      if the metric is value, never revenue. Flag every mismatch.
   4. **Known-gap topics — use the gap's own text as the model answer.** When the bundle contains a
      `GAP-*`, its `honest_gap` is the truth the owner must not paper over and its `frame` is the
      sanctioned pivot to adjacent real evidence. Build your model answer from `frame`, grounded in
      the gap's `evidence_ids`. Reward the honest form ("I haven't done X directly, but I've done
      adjacent Y"); **fail** the over-claiming form ("I've done X") for the same topic. Never
      invent a smoother framing than `frame` — if it feels weak, say so as feedback, don't silently
      replace it, and never coach the owner to erase the gap.
   5. **Defensibility of soft/claim evidence.** If the answer rests on a `soft`- or `claim`-tagged
      entry, note it must be defensible verbally and not presented as documented (`hard`) fact.
   6. **Your critique must itself pass the honesty boundary.** Never repeat a retired phrase
      approvingly; if the owner used one, flag it as something to drop.
   7. **You assess; you do not rewrite the owner.** Point out over-claims and missed evidence,
      offer a grounded model answer, and stop. Don't edit the owner's words into the transcript as
      if they'd said something different.

   **Output & close.** Give a verdict of `PASS` or `REVISE`, then the numbered flags with exact
   quoted words and the rule each breaks, then — for a gap topic — the assembled model answer
   (`honest_gap` + `frame`). Be terse and specific; never soften an over-claim into a suggestion.

5. **Save the transcript** with these exact sections, then validate it:
   ```markdown
   ## Question
   <the question you asked>

   ## My answer
   <the owner's answer, verbatim>

   ## Coach critique
   <your critique from step 4>

   Grounding: EVD-..., GAP-...
   ```
   ```
   pnpm selfwright drill <archetype-id> --check <transcript-path>
   ```
   (the archetype id is still required as a positional argument even in `--check` mode, though
   unused by the check itself). The validator only checks the `## Coach critique` section onward
   (your model answer must be
   grounded) — the owner's raw answer is never trace-gated, since flagging their practice mistakes
   is the entire point.

## What never to do

Never let a critique pass an over-claim to be encouraging. Never invent evidence outside the
grounding bundle to make either the question or the model answer sound stronger.
