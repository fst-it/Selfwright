# 0011 — Observability foundation: shared logger, MCP error persistence, adapter telemetry parity

- Status: Accepted (2026-07-08)
- Supersedes: none. Implements T3.0 (anchor §10 Phase 3).

## Context

Phase 3 opens with a gap noticed while closing out Phase 2: there is no shared logging utility
anywhere in the repo (only ad-hoc `console.error`/`process.stderr.write` calls with hand-written
`[tool-name]` prefixes, duplicated per file), the MCP server's single central `catch` block
(`apps/mcp/src/index.ts`) turns every thrown tool-call error into an `isError: true` response and
then discards it — nothing is persisted server-side, so a failure is only ever visible to whichever
harness happened to be attached at the time — `ClaudeCliAdapter` and `OllamaAdapter` never write a
`UsageRecord` to `reports/usage.jsonl` even though `LiteLlmAdapter` has since Phase 0 (Task 0.5),
and `infra/mem0-service/main.py` (FastAPI) has zero error handling on any route — an unhandled
exception there is invisible except as a generic 500 to the caller.

None of this blocks a feature; all of it makes every later Phase 3 task (coaching, content,
reporting) harder to debug once it's running unattended (scheduled tasks, ntfy pushes) rather than
watched live in a terminal.

## Decision

**A new package, `packages/shared-logger` (`@selfwright/shared-logger`), not an extension of
`packages/shared-config`.** `shared-config` is scoped narrowly and explicitly to typed config-file
loading (`loadModelsConfig`/`loadScanTargets`); logging is a different cross-cutting concern, and
folding it in would dilute that package's purpose for the sake of avoiding one more `package.json`.
The new package mirrors `shared-config`'s scaffolding exactly (single `src/index.ts`, same
tsconfig/vitest pattern) and has zero runtime dependencies beyond `node:fs`/`node:path` — no
winston/pino/etc., matching the brief's "no heavy framework." It sits alongside `shared-config` as
a peer utility package, not under `packages/adapters/`: `packages/core` never does I/O (confirmed —
zero `fs`/`console`/`process` references anywhere in `packages/core/src`), so there is no
`LoggerPort` to implement here. Its API (`createLogger(source, { filePath? })` → `{debug, info,
warn, error}`) always writes a human-readable line to stderr; it appends a JSON line to `filePath`
only when the caller supplies one — the package itself bakes in no default path, unlike
`tools/src/metrics.ts`'s `DEFAULT_USAGE_FILE`, which resolves via `process.cwd()` and is fragile
depending on where a process is launched from. Callers resolve their own path explicitly.

**MCP tool-call errors persist to `reports/mcp-errors.jsonl`,** written from the single central
`catch` block in `apps/mcp/src/index.ts` (all 11 tools flow through one wrapper, not a per-tool
one). The path is resolved relative to the module's own file location (`import.meta.url`), not
`process.cwd()`, so it's correct regardless of how the MCP server is launched. Each entry carries
the tool name, the error message, and the stack — **deliberately not the raw tool arguments**. MCP
tool inputs can carry data straight from the truth layer (comp figures, named contacts), and an
error log is exactly the kind of secondary surface the data-leak gate doesn't watch (it isn't a git
commit); logging the message/stack gives enough to debug without turning the log itself into a
second copy of whatever the caller was working with. A handful of other `isError: true` responses
in the same handler (an overlay-migration failure, two "adapter not configured" checks) return
early without throwing, so they don't pass through this catch block — they're left uncovered for
now; they're expected/known conditions rather than unexpected failures, and extending to them is a
small, separate follow-up if it turns out to matter.

**`ClaudeCliAdapter` and `OllamaAdapter` now mirror `LiteLlmAdapter`'s existing telemetry pattern
exactly** rather than inventing a second one: a trailing `onUsage: (record: UsageRecord) => void =
appendUsageRecord` constructor parameter (dependency-injected, defaulted, so every existing call
site in `apps/cli/src/index.ts`'s `loadAdapter()` picks it up with zero changes), `Date.now()`
timing around `complete()`, and a `buildUsageRecord`/`appendUsageRecord` call on the success path
only — matching `LiteLlmAdapter`, usage is not recorded when a call throws. Both packages gain
`@selfwright/tools` as a workspace dependency, the same seam `llm-litellm` already uses.

**`infra/mem0-service/main.py` gets `print(..., file=sys.stderr)` calls, not Python's `logging`
module.** The service already has two ad-hoc stderr warnings; this adds the same style around the
three route handlers that do real work (`add_memory`, `search_memory`, `list_memories`), each
wrapped in a `try/except` that prints the exception and re-raises — purely additive, no behavior
change, no new dependency. `logging` would be the more "proper" choice in isolation, but the brief
was explicit that plain stderr prints matching the existing style are sufficient here, and pulling
in a logging config for a single-file FastAPI service ahead of any actual need is exactly the kind
of premature abstraction the project avoids elsewhere.

**Known asymmetry, accepted:** unlike the MCP logger (which deliberately logs only tool name +
message + stack, never raw arguments), these `print(f"... {exc}")` calls don't filter the exception
string itself, and `add_memory`/`search_memory`/`get_all` do receive real memory content as input.
If mem0/pgvector/Ollama ever echoed part of that content back inside an exception message, it would
reach stderr. No such leak was found in review, this never reaches the HTTP caller (FastAPI's
default handler returns a generic 500 regardless), and the service is local/single-user — but it's
a real asymmetry with the MCP design, not a false one, and worth knowing about if this service's
error handling is ever revisited.

## Alternatives considered

- **Extend `packages/shared-config` instead of a new package.** Rejected — see above; different
  concern, and every existing consumer of `shared-config` would gain a logging dependency it didn't
  ask for.
- **Log full MCP tool arguments alongside the error.** Rejected on privacy grounds (see above) —
  the debugging value of seeing exact arguments is outweighed by the risk of the error log becoming
  an unwatched copy of truth-layer data.
- **A new fitness function enforcing "every LLM adapter records usage" / "every MCP error is
  logged."** Considered, not built. T3.0 is scoped small and this would be governance ahead of any
  real usage pattern to govern; revisit once the logger and telemetry have been observed in
  practice for a while.
- **Python's `logging` module for mem0-service.** Rejected for now — see above; matches existing
  file style instead of introducing new config surface for one service.

## Consequences

- `reports/mcp-errors.jsonl` joins `reports/usage.jsonl` as a plain, gitignored, `jq`-queryable
  JSONL file — no new infrastructure, consistent with "plain files as source of truth, no daemon."
  T3.4's reporting layer can read both when it's built.
- `packages/shared-logger` is now the natural home for any future cross-app logging need; existing
  ad-hoc `console.error`/`process.stdout.write` call sites (`tools/data-leak-gate.ts`,
  `fitness/src/runner.ts`, `apps/cli/src/index.ts`, etc.) are **not** retrofitted to use it as part
  of this change — that would be a much larger, unrelated refactor. They can adopt it incrementally
  if/when touched for other reasons.
- The ~2-3 inline early-return MCP error paths that bypass the catch block remain unlogged; known
  gap, not a silent one (documented above).
