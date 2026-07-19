## What & why
<!-- short summary; link the ADR if this is an architectural change -->

## Checklist (definition of done)
- [ ] One focused task; conventional-commit title (`feat`/`fix`/`docs`/... scope: subject)
- [ ] All commits signed off with `git commit -s` (DCO — no CLA required)
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm fitness` all pass
- [ ] All 33 fitness functions pass (`pnpm fitness`); named-entity + machine-identity hooks
      run locally with `SELFWRIGHT_DATA_DIR` set before pushing (Tier-2 checks skip in CI)
- [ ] Tests added/updated (TDD for deterministic code; evals for LLM paths)
- [ ] No `data/`, secrets, PII, machine paths, or personal email committed
- [ ] No TODO/stub/placeholder/skipped tests (FF-LAZY-1 enforces this)
- [ ] Strict types (no `any`); hexagonal boundaries respected (FF-PORT-1 + FF-CONTEXT-1)
- [ ] Docs/ADR updated if behavior or architecture changed
- [ ] Truth floor respected (no fabricated facts; outward claims trace to evidence)
