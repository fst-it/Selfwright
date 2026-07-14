---
name: tailor
description: Apply a tailoring overlay (headline/summary/skills/bullet-order/drift selections) to a base CV and produce a tailored CV JSON. Use when the user wants to tailor their CV for a specific role or apply a drift.
argument-hint: "<cv-content.json> --overlay <overlay.json> [--map <evidence-map.json>] --out <out.json>"
---

# tailor

Applies a `CvOverlay` (select/suppress evidence, reorder roles/bullets, headline/summary
override, and governed drift applications) to a base `CvContent` JSON, producing a
`TailoredCvContent` JSON (`packages/core/src/tailoring/`).

## How to run it

Requires `SELFWRIGHT_DATA_DIR` set (loads the evidence registry, identity, and drift ledger for
validation/honesty-scanning).

```
pnpm selfwright tailor <cv-content.json> --overlay <overlay.json> --map <evidence-map.json> --out <tailored-out.json>
```

- `<cv-content.json>` — the base CV (`name, headline, summary, skills[], roles[], ...`).
- `--overlay` — a `CvOverlay` JSON. Legacy career_plan overlays using the old `inject_drifts`
  shape (bare strings or `{id, role, mode, replace_bullet}` objects) are auto-migrated — you don't
  need to hand-convert them. The canonical shape uses `drift_applications: [{id, mode, target?,
  allow_high_risk?}]`.
- `--map` — the evidence map (which `EVD-*` IDs back each role/bullet); defaults to
  `cv-evidence-map.json` next to the CV file if omitted.
- `--out` — where to write the tailored CV JSON.

## What can go wrong (and is not a bug)

- **Exits non-zero with a Zod validation error** on a malformed overlay — this is the boundary
  validation working as intended, not a crash to route around. Read the error and fix the overlay.
- **A `high-risk`-band drift is refused** unless the overlay entry sets `allow_high_risk: true` —
  this is the governed drift-application policy (ADR 0005), not a bug. Only set that flag if the
  user has explicitly reviewed and accepted the risk for that specific drift.
- Check `_tailor_meta.applied_drifts` in the output to confirm which drifts actually applied and
  with what claim text — never assume an overlay's `drift_applications` silently no-op'd.
