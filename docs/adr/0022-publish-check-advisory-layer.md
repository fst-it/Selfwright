# 0022 — LLM publication-review advisory layer: publish-check skill and pre-push hook

- Status: Accepted (2026-07-12)
- Phase 5 T5.2. Adds an advisory layer above the deterministic gates; does not modify or weaken any
  existing gate (ADR 0017, anchor §7.4).

## Context

The deterministic gates (data-leak regex, named-entity scan, machine-identity scan) are the
platform's hard wall against private data leaving the machine. They are structurally sound for
the classes they cover. But by design they cannot catch:

1. **Contextual PII** — a person or company identifiable from combined context (role + company +
   date), even when no name appears in any single line.
2. **Semantic leaks** — describing a confidential situation (salary negotiation detail, interview
   question revealing internal architecture, private data-structure shape) in a way a regex cannot
   distinguish from legitimate framework prose.
3. **Ungrounded claims** — a specific metric or title asserted as the author's own professional
   fact in non-artifact files (comments, docs, config) where the deterministic truth-trace
   validator does not run.

Phase 5 adds publication-readiness requirements (OSS open-core decision, ADR 0021). Before any
push to the public repo the author needs a quick, mandatory second pass that a human eye (or an
LLM) can apply but a regex cannot.

The feasible surface for this review is the `claude` CLI (ADR 0006 §3: `ClaudeCliAdapter`,
subscription-backed, automatable via subprocess, no API key required). The same `claude --print`
pattern used by the existing `--adapter cli` headless escape hatch applies here.

## Decision

### 1. `/publish-check` skill — mandatory process rule

A Claude Code skill (`.claude/skills/publish-check/SKILL.md`) that instructs the in-session
model to collect the outgoing diff and apply a three-category rubric:
- **contextual-PII** — identifiability from combined context
- **semantic-leak** — confidential situation or private structure in framework files
- **ungrounded-claim** — specific personal-achievement fact without EVD-* anchor

The skill includes the complete rubric with synthetic examples, the verdict-line contract, and
a `FINDING:` line format. Running `/publish-check` before opening or updating any PR is a
**mandatory process rule** documented in MANUAL §3.8. This is a process enforcement, not a
technical gate — the deterministic gates remain the hard technical wall.

### 2. Verdict-line contract

Claude's output MUST end with exactly one of:
```
PUBLISH-CHECK: CLEAN
PUBLISH-CHECK: N FINDINGS
```
This strict contract makes the hook's verdict parsing deterministic (no NLP needed to interpret
the result). A response that lacks a valid verdict line is treated as inconclusive → fail-open.

### 3. Optional pre-push advisory hook

A script (`tools/src/hooks/publish-check-advisory.ts`, compiled like other hooks) wired into
`lefthook.yml` after `named-entity-scan` in the `pre-push` stage.

**OPT-IN:** The script exits 0 silently unless `SELFWRIGHT_PUBLISH_CHECK_HOOK=1`. Rationale:
not every contributor is on a Claude Code subscription; forcing the hook on would break pushes
for anyone not authenticated. Opt-in means the hook self-describes in its disabled state: no
output, no confusion.

**FAIL-OPEN:** If the `claude` CLI is unavailable or errors for any reason, the hook prints a
warning and exits 0. Rationale (absolute): the deterministic gates (always-on, no CLI dependency)
are the hard wall. An advisory hook that bricks pushes on transient failures would cause users
to reach for `--no-verify`, which would disable the deterministic gates too. The only correct
behavior for an advisory layer is to fail open. The fail-open choice is documented in the source
comment and here, not hidden.

**ACK-TO-PASS:** When the review reports findings (`PUBLISH-CHECK: N FINDINGS`), the hook exits 1
and prints the findings plus instructions. Re-push with `SELFWRIGHT_PUBLISH_ACK=1` to
acknowledge. The ack is one-shot by design (it is set per push command invocation, not
persistently). The intent: the author explicitly sees the findings and chooses to proceed, rather
than the hook silently exiting 0 on findings.

**Open-core boundary (absolute):** findings are printed to the local terminal only — never
written to any file in this repo or its history. The diff is passed to the `claude` subprocess
via a stdio pipe and is never persisted locally.

**Hook ordering in lefthook.yml:** `named-entity-scan` THEN `publish-check-advisory`. The
deterministic gate always runs first and is always authoritative; the advisory hook runs after and
its result is never a substitute for the deterministic verdict.

## Known limitations

**Prompt injection.** The diff content fed to the model can include text that coerces the model
into emitting `PUBLISH-CHECK: CLEAN` regardless of what the diff actually contains. This is a
verified-exploitable weakness at the parser level. It is an **acceptable residual risk** for an
advisory fail-open layer — the deterministic gates (data-leak regex, named-entity scan,
machine-identity scan) are regex/token-based and structurally immune to content-level injection;
they remain the only hard guarantee. The advisory verdict is not tamper-proof. The risk is
stated here and in the hook source comment (`KNOWN LIMITATION`) because the repo's truth-floor
culture requires it stated, not silent.

Mitigation in scope: none. Hardening the advisory verdict against injection would require an
out-of-band verification channel — costs and failure modes that are not worth adding for a
layer whose hard wall is elsewhere. The deterministic gates continue to run unconditionally on
every push regardless of what the advisory layer reports.

## What is NOT changed

- `BASE_PII_PATTERNS` (regex gate), `data/`-path emptiness check, gitleaks stay exactly as they
  are — neither the skill nor the hook touches them.
- The named-entity scan, machine-identity scan, and their fail-closed posture are unchanged.
- No new API key, no new network dependency (uses the existing authenticated `claude` CLI session).
- No new fitness function: this is an advisory mechanism, not a structural invariant suitable for
  deterministic CI enforcement.

## Consequences

- A mandatory pre-PR process step closes the contextual-PII / semantic-leak / ungrounded-claim
  gap that the deterministic gates structurally cannot cover.
- Subscribers get automated advisory enforcement via the opt-in pre-push hook with a one-command
  ack path.
- Non-subscribers see no change in push behavior (hook self-disables silently; deterministic gates
  unchanged).
- Two new env vars documented: `SELFWRIGHT_PUBLISH_CHECK_HOOK=1` (opt-in hook) and
  `SELFWRIGHT_PUBLISH_ACK=1` (one-shot ack).

## Alternatives considered

- **Make the hook mandatory (always-on, not opt-in).** Rejected: non-subscribers have no
  `claude` CLI, and making the hook hard-block would either require maintaining a separate auth
  path or force `--no-verify` use (which would also bypass the deterministic gates). Opt-in with
  a documented mandatory-process-rule for the skill is the right split.
- **Separate CI job that calls the Claude API.** Rejected: no API key by design (ADR 0006); CI
  has no private data anyway, so contextual-PII and semantic-leak checks in CI are structurally
  incomplete.
- **A deterministic (regex) ungrounded-claim scanner.** Rejected: the claims are context-dependent
  (the same number can be a format example or a first-person metric assertion); only an LLM can
  distinguish. The truth-trace validator already handles this for generated artifacts; this layer
  covers non-artifact files (docs, comments, config).
