# CLAUDE.md

Claude Code: read **AGENTS.md** (the canonical agent brief) first. This file only adds
Claude-Code-specific notes.

- Use plan mode for multi-step tasks; one task per branch → PR; stop at each PR for review.
- Follow the model policy in AGENTS.md (Sonnet primary; Opus only for the listed design topics).
- The data-leak gate, the truth floor, and the fitness functions are absolute — never bypass.
- Prefer the repo's deterministic tools over ad-hoc shell. **Never commit `data/`.**
- Keep `docs/adr/` updated when a decision changes.
