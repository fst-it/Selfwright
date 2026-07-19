# 0005 — Drift application is a governed operation

*career_plan is treated as a proof-of-concept; its behavior is not authoritative for Selfwright.*

- Status: Accepted (2026-07-01)
- Supersedes: none. Adds anchor **D31** (new ledger entry — see the correction note below)

## Context

`packages/core/src/tailoring/overlay.ts` declared `inject_drifts: z.array(z.string())`. Real
overlays — including ones migrated from `career_plan` — carry **objects**
(`{ id, role, mode, replace_bullet }`), not bare drift-id strings. Because overlays were loaded
with a raw `JSON.parse` and cast (`as CvOverlay`) at the CLI (`apps/cli/src/index.ts`) and MCP
(`apps/mcp/src/index.ts`) boundaries — no Zod validation ran — those objects reached
`applyOverlay` unchanged. There, `missing.join(", ")` over an array of object references
stringified each entry as `[object Object]`, so `selfwright tailor` failed for every overlay that
injected a drift (BUG-1, confirmed on a real target-company acceptance-run overlay:
`VALIDATION_ERROR: Unknown drift ID(s) in inject_drifts: [object Object]`).

Beyond the crash, the feature itself was an incomplete stub: `applyOverlay` only **unioned drift
keywords into skills**. It never replaced or injected bullet prose, despite `DriftEntry.claim`
existing precisely to carry that prose. `confidence.band` (`safe` / `caution` / `high-risk`) was
loaded from the drift ledger but never read — a drift scored `high-risk` applied exactly like one
scored `safe`. `FF-TAILOR-2` tested the stub's keyword-union behavior as if it were the intended
spec, freezing the gap in place.

Drifts are Selfwright's only sanctioned, scored, ledgered exception to the truth floor (anchor
§4.1, §6.2) — the moat that makes outward claims defensible to a repeat, high-stakes audience
(a specific target company). An ungoverned, silently-incomplete implementation of that exception is a truth-floor
risk, not a cosmetic bug. Pre-cutover (Phase 1, before real applications route through it in
volume) is the cheapest point to fix the architecture rather than patch the crash and leave the
gap.

## Decision

Replace the `inject_drifts: string[]` stub with a first-class governed operation,
`drift_applications: DriftApplication[]`, on `CvOverlay`:

```ts
export const DriftApplicationModeSchema = z.enum(["replace", "inject", "keywords-only"]);
export const DriftApplicationSchema = z.object({
  id: z.string().regex(/^DRIFT-[A-Z0-9-]+$/),
  mode: DriftApplicationModeSchema,
  target: z.object({ role: z.string(), bullet: z.number().int().nonnegative().optional() }).optional(),
  allow_high_risk: z.boolean().default(false),
}).superRefine((v, ctx) => {
  if ((v.mode === "replace" || v.mode === "inject") && v.target === undefined)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `mode "${v.mode}" requires target.role` });
  if (v.mode === "replace" && v.target?.bullet === undefined)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `mode "replace" requires target.bullet` });
});
```

- **Object-only wire form.** No `string | object` union. An overlay either names a
  `drift_applications` entry with a real shape, or it doesn't reference the drift at all.
- **The applied text is always the ledgered `drift.claim`.** Overlays carry no free text for a
  drift — they only select *which* drift, *how* (`mode`), and *where* (`target`). This keeps the
  ledger, not the overlay author, as the source of the claim, consistent with the truth floor.
- **Status and confidence-band gating.** Non-`active` drifts (`proposed` / `promoted` / `retired`)
  are silently skipped — referencing one is not an error, it simply doesn't apply. Active drifts
  are gated by `confidence.band`: `safe` and `caution` auto-apply; `high-risk` is refused with an
  explicit `VALIDATION_ERROR` unless the directive sets `allow_high_risk: true`. The whole
  operation fails closed — never silently drops a high-risk claim, never silently applies one.
- **Structured provenance.** Every applied drift is recorded in `_tailor_meta.applied_drifts` as
  an `AppliedDrift { id, mode, role?, bullet?, claim, band }`, not a bare id string. This is what
  the honesty scan (`services/tailor.ts`) now walks alongside the summary — a replaced or injected
  bullet is as much an outward claim as the summary is, so it gets the same retired-phrase check.
- **Zod validation at the boundary.** Both `apps/cli/src/index.ts` (`tailor` action) and
  `apps/mcp/src/index.ts` (`tailor` tool) now parse the raw overlay through
  `CvOverlaySchema.safeParse` before it reaches the core, and fail loudly (non-zero exit /
  `isError: true`) on a malformed overlay instead of casting and letting a bad shape reach
  `applyOverlay`. This is the direct fix for BUG-1's `[object Object]` crash: a bare string in
  `drift_applications` is now rejected at the boundary, not stringified deep in the pipeline.
- **Legacy compatibility lives in the adapter, not the core.** career_plan's
  `inject_drifts` shape (string ids, or the richer `{ id, role, mode, replace_bullet }` object) is
  handled by `migrateCareerPlanOverlay` in `packages/adapters/storage-git/`, which
  translates it to canonical `drift_applications` before anything reaches `packages/core`. The
  core never special-cases the legacy shape.

## Consequences

- **Breaking, and intended** — every consumer is owned by this repo. `TailoredCvMeta.applied_drifts`
  changes from `string[]` to `AppliedDrift[]`. The bare-string `inject_drifts` wire form is
  dropped entirely (no dual-write, no deprecation window — anchor D8 "iterative, not
  speculative": there is no external consumer to break gently for).
- `FF-TAILOR-2` (`fitness/src/checks/tailor-drift-apply.ts`, renamed from
  `tailor-inject-drifts.ts`) is rewritten to assert the governed contract: replace/inject/
  keywords-only application, the band gate (both refused and allowed paths), non-active skip, and
  that an unknown id names the real id rather than `[object Object]`.
- `confidence.band` becomes load-bearing for the first time — a ledger entry's band now changes
  runtime behavior, not just reporting. Ledger data quality on `band` matters more than it did.
- **Correction (added in Task 7):** this ADR originally said it "supersedes anchor D25
  (`inject_drifts` schema `z.array(z.string())`)". The founding ledger's actual D25 is the
  data-leak gate — unrelated to drift injection. There was never a ledger entry for the
  `inject_drifts` schema; the original citation was wrong (mis-cited by the design session that
  authored the gateway-redesign handoff). Task 7 adds a **new ledger row, D31**
  ("Drift application = governed operation"), rather than amending D25. The real D25 is untouched
  by this decision.
- **Deferred (named, not forgotten):** drift-ledger write-back of `applications[]` on the
  `DriftEntry` itself (so the ledger records where a drift was used); a per-archetype application
  policy DSL (today's `policy.autoApplyBands` is a single global default); evidence-anchored
  bullet targeting (an `inject`-mode splice shifts the original bullet indices the
  `EvidenceMap` was keyed against — acceptable for Phase 1, revisit if suppress/include overlays
  are combined with drift injection on the same role in practice).

## Alternatives considered

- **Keep a `string | object` union** for `inject_drifts`, tolerant-parsing whichever shape shows
  up. Rejected: this freezes the POC's ambiguity in place — the exact ambiguity that caused BUG-1
  — and still leaves the feature at keyword-union-only. It optimizes for not touching call sites
  today at the cost of carrying architectural debt through Phase 2.
- **Fix only the crash** (correct the `.join()` call / stringify objects safely) and leave
  `inject_drifts` as a keyword-union stub. Rejected: passes the immediate acceptance-test bug but
  leaves `confidence.band` unused and bullet-level drift application (the actual point of a
  drift — see anchor §6.2, "Drifts — per-company advisory, scored, ledgered exceptions to
  truth") unbuilt. Anchor D-8 (career_plan is POC-reference-only) means the stub's incompleteness
  is not "existing behavior to preserve."
