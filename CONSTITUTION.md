# CONSTITUTION.md — Selfwright Governing Principles

> These are the non-negotiable rules of the platform. Each one has an enforcement mechanism;
> none can be bypassed by configuration, a PR, or an agent instruction. If a proposed change
> conflicts with a principle here, the change is wrong — the principle stands.

These principles are restated here in full; every one is reinforced by at least one executable
fitness function in `docs/fitness-functions.md`.

---

## 1. Truth floor

**The rule.** Every substantive claim in a generated artifact — a number, a title, a system name,
a competency statement — must trace back to a verifiable entry in the evidence registry
(`truth/evidence/registry.yml`). An artifact that cannot pass this check is rejected before it
reaches the user.

**Why it exists.** The platform exists to produce defensible output. A claim that cannot be
grounded in evidence is a fabrication, and fabrications compound: they appear in multiple
applications, they are hard to retract, and they create consistency problems with repeat audiences
such as a company that interviews you more than once. The truth floor is the one control that
makes all generated output trustworthy at scale.

**How it is enforced.**
- `FF-TRUTH-1` (truth-trace): every substantive sentence in a generated CV summary shares ≥ 2
  content words with at least one EVD-* entry.
- `FF-TRUTH-5` (R19 guard): the `guardSummary()` function verifies this at the artifact level.
- `FF-GEN-1` (generated-artifact-trace): the cover and research validators run the same check.
- `--check` on every generation command: the artifact is validated before the user can use it.

Bypassing the check produces no artifact. The architecture offers no path to output without
validation.

---

## 2. Data-leak boundary

**The rule.** Personal data — the evidence registry, applications, compensation floors, named
contacts, drift files, and anything from the owner's private data repository — never enters the
framework repository in any form. This includes git history. The framework is safe to publish;
the data is never published.

**Why it exists.** The framework is open-core: the code is designed to be public. The data is
the owner's professional life, including named hiring managers, referrers, and confidential
third parties. A leak is irreversible. The boundary is what makes open-sourcing safe.

**How it is enforced.**
- `data/` is gitignored. `FF-DATA-LEAK-1` verifies this at pre-commit, pre-push, and in CI.
- gitleaks scans for secrets on every commit.
- A named-entity scanner (`tools/src/hooks/named-entity-scan.ts`) derives the confidential-name
  blocklist live from the private data directory at hook time. It fails closed if the data
  directory is absent.
- A machine-identity scanner (`tools/src/hooks/machine-identity.ts`) blocks the owner's machine
  username, hostname, personal email, and any local absolute path from appearing in the framework.
- `FF-CRED` verifies that credential-bearing file paths are both gitignored and absent from
  `git ls-files` — a `git add -f` cannot slip past.
- The `--no-verify` flag is prohibited by standing rule. It bypasses the local hook but not CI.

ADR 0017 documents the full design and the residuals: a determined owner who runs `--no-verify`
and pushes a unique non-dictionary confidential name can still commit a leak, because cloud CI
cannot know the private names. That residual is documented, not papered over.

---

## 3. Honesty walls and drifts

**The rule.** Drifts are the only sanctioned deviation from what the evidence strictly supports.
A drift is a specific, confidence-banded claim with a documented rationale and an honesty note.
It is scored (low / medium / high-risk), ledgered in `drifts/companies/<slug>.yml`, and applied
per-application via an explicit `drift_applications` entry in the tailoring overlay. Retired
drifts are never deleted. Any output containing keywords from a retired drift produces a truth
warning. Fabricating claims outside the drift system is a truth-floor violation.

**Why it exists.** Some roles legitimately reward a bolder framing of real experience. The drift
system provides a governed path to controlled emphasis, with clear documentation of what was
stretched and why, so the claim can be defended. Without this structure, "embellishment" is
just fabrication by another name.

**How it is enforced.**
- `FF-TRUTH-3` (honesty-boundary): `scanHonestyBoundary()` checks generated text for keywords
  from retired drifts or retired evidence entries.
- `FF-TAILOR-2` (tailor-drift-apply): five assertions over drift application — high-risk band
  is gated by `allow_high_risk: true`, unknown drift IDs produce a `VALIDATION_ERROR`, retired
  drifts are silently skipped without contaminating keyword output.
- `FF-TAILOR-3` (tailor-honesty-output): a retired-drift keyword appearing in a tailored CV
  summary populates `_tailor_meta.truth_warnings`, surfaced to the user before they proceed.

ADR 0005 governs the full drift-application semantics.

---

## 4. Human-in-the-loop; the human submits

**The rule.** Automation is the expected operating mode for every step up to the final application
action: discovery, scoring, tailoring, generation, company research, interview prep, and form
pre-fill can all run with as much automation as adds value. The one hard line: no code path in
this repository autonomously reaches the final submit control on any career website or ATS. The
human reviews and submits.

**Why it exists.** Autonomous final submission — without an explicit human choice at that moment
— carries risks that pre-validation cannot eliminate: wrong timing, a role revision posted since
generation ran, a referral channel the human intended to route through instead. Automation of
every step before that decision adds value without that accountability exposure. The constraint is
narrow by design: enforcing it only at the final submit action preserves the full benefit of
automation everywhere else. (Owner ruling: 2026-07-13. See ADR 0025.)

**How it is enforced.**
- No write action in `apps/web` calls an external ATS submit endpoint or triggers any
  final-submit action on a career website.
- `FF-LLM-1` (llm-egress): the fitness check fails if any file in `apps/` instantiates a
  concrete LLM adapter without an explicit `--adapter` opt-in marker. No default composition path
  wires an LLM adapter without human opt-in.
- The `--check` step is a separate, explicit command the user runs before using an artifact.
  It does not run automatically on file save or on generation.
- Pre-submit automation — prefill, generation, research, triage — is explicitly in scope and
  encouraged. The enforced boundary is the final submit action, not a moment earlier.

---

## 5. Fitness functions are law

**The rule.** The 33 fitness functions in `docs/fitness-functions.md` run via `pnpm fitness` and
must all pass (or skip gracefully, for the 5 Tier-2 checks that require private data) before any
PR merges. No check may be skipped, weakened without a corresponding ADR, or bypassed by a test
fixture that does not test the real constraint. Every new architectural decision that changes a
property checked by a fitness function requires updating that function or adding a new one.

**Why it exists.** Architecture is not protected by words in a document. It is protected by code
that fails when the words are violated. Fitness functions are executable architectural assertions —
they catch regressions in the hexagonal boundary, the truth floor, the data-leak gate, and the
web security posture automatically, on every change, without relying on human review to notice.

**How it is enforced.**
- CI runs `pnpm fitness` on every PR. A failing check blocks the merge.
- `FF-LAZY-1` rejects any merged code containing TODO, FIXME, skipped tests, or `NotImplemented`
  stubs — preventing partial implementations from bypassing coverage.
- `FF-HALLUC-1` verifies that every relative TypeScript import resolves to a real file.
- Adding a new fitness check requires: a file in `fitness/src/checks/`, registration in
  `fitness/src/runner.ts`, a row in `docs/fitness-functions.md`, and an ADR entry if it enforces
  a new architectural decision.

The Turbo cache does not substitute for a clean run. `turbo run fitness --force` bypasses the
cache for verification.

---

## 6. Local-first / no telemetry

**The rule.** No personal data leaves the owner's machine except: commits to the owner's private
GitHub repository, and text sent to the Claude interface the owner already has open. No API key
is stored in the framework. Zero telemetry, analytics, crash reporting, or usage tracking is ever
sent to the maintainer or any analytics vendor. ntfy push notifications carry application IDs and
queue counts only, never job titles or claim content. The system works without any network
access except for job-board scanning and explicitly configured optional services.

**Why it exists.** The private data directory contains the owner's compensation floors, named
contacts including referrers and hiring managers, and application history including company names.
This is information that — if it left the machine — could reach parties with an adversarial
interest. Local-first is not a feature; it is a data-sovereignty requirement.

**How it is enforced.**
- `FF-EGRESS` (egress-guard): every outbound `fetch`, `undici`, or browser navigation call in
  adapters and apps must route through a named URL-validation guard. The guard enforces an
  allowlist of developer-configured endpoints (Ollama, LiteLLM proxy, mem0) and rejects arbitrary
  external URLs.
- `FF-LLM-1` ensures no LLM adapter is wired by default.
- `FF-DATA-LEAK-1` and the named-entity scanner ensure no personal data enters the framework repo.
- The web dashboard binds `127.0.0.1` only, not a wildcard interface. Tailscale Serve (WireGuard,
  tailnet-only) is the only sanctioned remote-access path.
- Metabase (AGPL) is arm's-length: it runs as a Docker image but is never imported by framework
  code, preserving the commercial-option flexibility (ADR 0021).

---

## 7. Conventional process

**The rule.** One task per branch, one branch per PR, one PR per review cycle. Conventional
commits throughout. Significant architectural decisions are recorded as ADRs in `docs/adr/`
before the code is written. No merge below the full gate: `pnpm lint`, `pnpm typecheck`,
`pnpm test`, `pnpm fitness` all green. No TODO, stub, placeholder, or skipped test in merged code.

**Why it exists.** The platform is built and maintained by one person using multiple AI-assisted
development sessions. Without a rigid process, sessions diverge, decisions get re-derived
expensively, and the codebase accumulates unfinished work that looks finished from the outside.
The conventional-commit lint, ADR discipline, and fitness suite are what make a solo AI-assisted
build auditable and trustworthy.

**How it is enforced.**
- Conventional-commit lint (`tools/src/hooks/commit-msg-lint.ts`) runs as a `commit-msg` hook
  and rejects any message that does not match the pattern. Both lefthook and a real `.git/hooks`
  twin enforce this, so it cannot be bypassed by switching tools.
- `FF-LAZY-1` rejects stubs and skipped tests in merged code.
- `FF-HALLUC-1` rejects dangling imports from AI-generated code that references non-existent
  modules.
- Branch protection requires CI green before merge. A local green does not substitute.
- `AGENTS.md` is the cross-tool brief, read by Claude Code, Cursor, and OpenCode. It records the
  process rules in one place so every session starts with the same context.
