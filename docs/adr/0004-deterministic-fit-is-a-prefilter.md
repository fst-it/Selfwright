# 0004 — Deterministic fit is a pre-filter, not a DoD gate

*career_plan is treated as a proof-of-concept; its behavior is not authoritative for Selfwright.*

- Status: Accepted (2026-07-01)
- Supersedes: the Phase 1 DoD phrase "fit ≥ target" (anchor §10, Phase 1)

## Context

The Phase 1 DoD (anchor §10) reads *"ATS ≥ 0.80, fit ≥ target, all truth fitness functions
green."* "fit ≥ target" was never given a number. The implicit target was `career_plan`'s
holistic ~4.0/5.0 — but that number comes from a **7-dimension LLM judgment** (sector,
seniority, scope, reporting, comp, geo, evidence), not from Selfwright's deterministic
`scoreJd` (`packages/core/src/scoring/jd-score.ts`), which is a **keyword/evidence-overlap**
engine over the same 7 dimensions computed without a model in the loop.

An internal 2026-06-30 acceptance run scored all 6 real roles both ways:

| Role | Selfwright fit (deterministic) | career_plan fit (holistic LLM) | Delta |
|------|------|------|------|
| Target Co | 2.5/5.0 (D) | 4.7/5.0 | −44pp |
| Travel Co | 3.0/5.0 (C) | 4.6/5.0 | −32pp |
| an insurer | 2.5/5.0 (D) | 4.3/5.0 | −36pp |
| a global bank | 2.2/5.0 (D) | 4.0/5.0 | −36pp |
| a consulting firm | 2.2/5.0 (D) | 3.5/5.0 | −26pp |
| Consulting Co | 2.4/5.0 (D) | 4.19/5.0 | −36pp |

Every one of these is a role the owner is actively pursuing or has progressed in — by
construction, none should be rejected. If "fit ≥ target" were interpreted as a literal
≥4.0 (or even ≥3.5) cutoff on the deterministic score, **all 6 would fail**, making Phase 1
DoD unmeetable by a scoring artifact, not by an actual quality problem (BUG-2).

The deterministic and holistic scores are not miscalibrated versions of the same
measurement — they are different measurements on the same nominal 0–5 scale. The
deterministic scorer rewards literal keyword/evidence overlap; the holistic judgment
weighs seniority/scope/comp fit the way a human recruiter would. Compressing one to match
the other's range is a calibration problem, not a units problem.

## Decision

The deterministic fit score (`scoreJd` → `fit_score`/`grade`) is a **ranking and pre-filter
signal**, never a pass/fail gate on Phase 1 (or any phase's) DoD, and never a gate that
rejects a role from the pipeline. Its only enforced guarantee is a **non-degeneracy floor**:
for a role whose archetype the scorer should recognize, `scoreJd` must return a non-null
`archetype` and a non-`"F"` `grade` (`fit_score ≥ 2.0`). This is enforced by **FF-FIT-1**
(`fitness/src/checks/fit-nondegeneracy.ts`), a synthetic, Tier-1 (no `SELFWRIGHT_DATA_DIR`)
regression check: an in-memory archetype plus a JD text crafted to match it must not
degenerate to "no match" or the bottom grade.

Holistic fit (the LLM-judged ~4.0/5.0 quality bar) becomes an **LLM-tier** DoD criterion,
produced by the co-piloted generation path (D-1, this handoff's gateway redesign) and
gated starting Phase 2 — it requires the generation gateway this handoff introduces, which
doesn't exist yet in Phase 1.

Concretely: no code path may reject, filter out, or block a role/application based on a
`fit_score` numeric threshold. `score` output continues to surface `grade` and `fit_score`
as information for the human to weigh, exactly as today.

## Consequences

- No numeric fit gate exists anywhere in the codebase — confirmed by grep across
  `packages/`, `apps/`, `fitness/src/`, `tools/src/` for `fit_score`: the only
  threshold-like use is `packages/core/src/services/inbox.ts`'s `fitScore >= 3.5` check,
  which sorts a queue entry into the `reviewSoon` vs. `fyi` inbox *tier* — every entry is
  still surfaced, none is dropped. That is a UX prioritization concern, not a DoD gate, and
  is unchanged by this ADR.
- `selfwright score <jd>` continues to report `grade` and `archetype`; there is no pass/fail
  exit code tied to the fit number.
- FF-FIT-1 is the only fit-related fitness function until Phase 2. It guards against a
  *regression* (the scorer starting to return null/F for roles it used to match), not
  against low-but-real scores — 2.2–2.5/5.0 on a real, pursued role is expected and correct
  under this scorer, not a bug.
- **Phase 2 follow-up (named, not forgotten):** recalibrate the deterministic 7-dimension
  weights (`jd-score.ts`'s `0.20/0.10/0.25/0.15/0.10/0.10/0.10` split) against a corpus of
  holistic judgments, so the deterministic score becomes a tighter *predictor* of the
  holistic one rather than a differently-scaled cousin of it. Out of scope here — this ADR
  only removes the false gate; recalibration is separate, larger work requiring real
  holistic-judgment data to fit against.

## Alternatives considered

- **Option A — a fixed numeric threshold** (e.g. `fit_score ≥ 2.5`). Rejected: fails real,
  actively-pursued roles (a global bank at 2.2, a consulting firm at 2.2 would both fail a 2.5 cutoff). Any fixed
  cutoff on this distribution rejects genuinely strong roles, which is the opposite of
  useful.
- **Option C — normalize both scales** (e.g. rescale deterministic scores so their
  distribution matches the holistic one). Rejected for now: the gap here is *calibration*
  (what each dimension weighs and how), not a *units* mismatch that a linear rescale would
  fix. A naive rescale would produce a number that looks comparable but still isn't
  measuring the same thing — false precision. Real recalibration (Phase 2 follow-up, above)
  requires refitting the dimension weights against holistic-judgment data, not just
  stretching the output range.
