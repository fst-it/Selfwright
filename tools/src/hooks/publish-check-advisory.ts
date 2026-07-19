// Advisory pre-push hook: LLM rubric review of outgoing diff for contextual PII,
// semantic leaks, and ungrounded claims (Phase 5 T5.2, ADR 0022).
//
// LAYER POSITION: this is an ADVISORY layer that sits ABOVE the deterministic gates
// (data-leak gate, named-entity scan, machine-identity scan). It catches issues those
// gates structurally cannot — contextual identifiability, semantic leaks, and ungrounded
// claims — but its verdict is advisory, not a hard block.
//
// OPT-IN: enabled only when SELFWRIGHT_PUBLISH_CHECK_HOOK=1.
// Exits 0 silently when unset — the deterministic gates (always-on) remain the hard wall.
//
// FAIL-OPEN by design (ADR 0022 §3): if the `claude` CLI is unavailable, times out, or
// errors for any reason, the hook prints a warning and exits 0. Rationale: this is an
// advisory layer; bricking a push because a CLI tool is momentarily unavailable would
// undermine the always-on deterministic gates by making users reach for --no-verify.
// The hard wall is never this hook.
//
// ACK-TO-PASS: if the review reports findings, the push is blocked (exit 1) until the
// user re-pushes with SELFWRIGHT_PUBLISH_ACK=1 to explicitly acknowledge them.
//
// OPEN-CORE BOUNDARY: findings are printed to the terminal only — never written to any
// file in this repo or its history. The diff content goes to the `claude` subprocess via
// a pipe and is never persisted locally.
//
// KNOWN LIMITATION — prompt injection: diff content fed to the model can include text
// that coerces the model to emit `PUBLISH-CHECK: CLEAN`. This is an acceptable residual
// risk for an advisory fail-open layer whose hard wall is the deterministic gates (which
// are regex/token-based and structurally immune to content-level injection). The verdict
// is NOT tamper-proof against adversarial diff content; the deterministic gates remain
// the only hard guarantee. See also .claude/skills/publish-check/SKILL.md §Known limitations
// and ADR 0022 §Known limitations.
//
// Rubric is canonical in .claude/skills/publish-check/SKILL.md; the embedded constant
// below mirrors it for the headless `claude --print` invocation.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parsePrePushRefs } from "./named-entity-scan.js";

// ── Verdict parsing (pure) ────────────────────────────────────────────────────
export interface PublishCheckVerdict {
  readonly clean: boolean;
  readonly findingCount: number;
}

// Parses the LAST non-empty line of Claude's output for the strict verdict contract.
// Returns null if no valid verdict line is found (treated as inconclusive → fail-open).
// The contract: exactly one of:
//   PUBLISH-CHECK: CLEAN
//   PUBLISH-CHECK: N FINDINGS   (N is a POSITIVE integer — zero is not valid)
// Zero is excluded by [1-9]\d* so that a model emitting "0 FINDINGS" is treated as an
// unparseable verdict (→ fail-open) rather than silently clean or a blocking non-clean.
export function parsePublishCheckVerdict(output: string): PublishCheckVerdict | null {
  const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const last = lines[lines.length - 1] ?? "";
  const cleanMatch = /^PUBLISH-CHECK:\s+CLEAN$/i.exec(last);
  if (cleanMatch !== null) return { clean: true, findingCount: 0 };
  const findingsMatch = /^PUBLISH-CHECK:\s+([1-9]\d*)\s+FINDINGS?$/i.exec(last);
  if (findingsMatch !== null) {
    const count = parseInt(findingsMatch[1] ?? "1", 10);
    return { clean: false, findingCount: count };
  }
  return null;
}

// ── Opt-in and acknowledgement gates (pure — read env only) ──────────────────

// Returns true only when SELFWRIGHT_PUBLISH_CHECK_HOOK is exactly "1".
export function isOptIn(): boolean {
  return process.env["SELFWRIGHT_PUBLISH_CHECK_HOOK"] === "1";
}

// Returns true when SELFWRIGHT_PUBLISH_ACK is exactly "1" (one-shot per invocation;
// set per push command, not persistently in the environment).
export function isAcknowledged(): boolean {
  return process.env["SELFWRIGHT_PUBLISH_ACK"] === "1";
}

// ── Claude spawn-result processing (pure — testable without the real CLI) ────

// Minimal interface matching the fields spawnSync returns that we care about.
// Exported so unit tests can inject synthetic shapes (including timeout/signal)
// without invoking the real `claude` binary.
export interface SpawnResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number | null;
  readonly signal: string | null;
  readonly error?: Error | undefined;
}

export type ClaudeSpawnOutcome =
  | { readonly kind: "success"; readonly output: string }
  | { readonly kind: "spawn-error"; readonly message: string }
  | { readonly kind: "timeout"; readonly signal: string }
  | { readonly kind: "exit-error"; readonly status: number; readonly stderr: string };

// Maps a spawnSync result to a typed outcome. Pure: exported for unit tests.
// Ordering: error > signal (timeout) > non-zero status > success, because when both
// error and signal are set (some platforms may do this on a forced kill), the error
// message is the more actionable of the two.
export function parseClaudeSpawnOutcome(result: SpawnResult): ClaudeSpawnOutcome {
  if (result.error !== undefined) {
    const message =
      result.error instanceof Error ? result.error.message : String(result.error);
    return { kind: "spawn-error", message };
  }
  if (result.signal !== null) {
    // Process killed by a signal — most commonly SIGTERM fired by spawnSync's `timeout`.
    return { kind: "timeout", signal: result.signal };
  }
  if (result.status !== 0) {
    return { kind: "exit-error", status: result.status ?? -1, stderr: result.stderr };
  }
  return { kind: "success", output: result.stdout };
}

// ── Rubric (mirrors .claude/skills/publish-check/SKILL.md; canonical source there) ──
const PUBLISH_CHECK_RUBRIC = `
You are running an advisory publication-readiness review on an outgoing git diff.
Apply the following three-category rubric and report your findings.

## Category 1 — Contextual PII
A person or company identifiable from combined context even without a name in any single line.
Look for: job title + team + date combinations that point to a real person; role+relationship
references ("my recruiter contact at <company>"); partial email addresses; internal
organizational details (team name, reporting structure, project codename) that combined with a
company name would identify a confidential contact.

Synthetic example of a FINDING:
  "// the talent acquisition lead at Blorptech who reached out Tuesday"
  → FINDING: contextual-PII severity:high file:example.md — company + role combination
    uniquely identifies an individual.

## Category 2 — Semantic Leak
The diff describes a confidential situation, negotiation, interview detail, or private data
structure inappropriately for a public framework repo.
Look for: salary/comp figures tied to a real hiring process; interview questions revealing
internal architecture; YAML field names or schema shapes describing the private truth layer's
internal structure (vs. its public loader API); drift rationale exposing confidential company
signals; post-interview notes revealing what was asked.

Synthetic example of a FINDING:
  "// offer below floor — declined 2026-06-30"
  → FINDING: semantic-leak severity:high file:example.ts — compensation negotiation
    detail in a framework file.

## Category 3 — Ungrounded Claim
A specific professional fact or personal capability in the diff that has no EVD-* anchor and
is presented as the author's own real achievement.
Look for: specific metrics without EVD-* reference ("cut latency from 400ms to 80ms"); job
titles not in any evident truth layer entry; technology claims that sound like they come from
private interview knowledge. Ignore illustrative hypothetical examples.

Synthetic example of a FINDING:
  "// proof: 87% runtime reduction"  (in a framework comment, no EVD-* reference)
  → FINDING: ungrounded-claim severity:medium file:example.ts — specific metric asserted
    as personal achievement without EVD-* anchor.

## Output format (strict)
For each finding:
  FINDING: [contextual-PII|semantic-leak|ungrounded-claim] severity:[low|medium|high] file:<path> line:<N> — <description>

After all findings (or after "No findings." if none), output EXACTLY ONE of these as the
final line, with nothing after it:
  PUBLISH-CHECK: CLEAN
  PUBLISH-CHECK: N FINDINGS
`.trim();

const MAX_DIFF_BYTES = 100_000;

// Maximum time (ms) to wait for `claude --print` before giving up. Chosen to be long
// enough for a realistic model response over an ordinary diff, while preventing git push
// from hanging indefinitely on a stalled CLI (network stall, unexpected interactive
// prompt, stuck process). On timeout spawnSync sets result.signal = "SIGTERM"; the hook
// treats this as a fail-open branch (warn + exit 0) — see file header rationale.
const CLAUDE_TIMEOUT_MS = 120_000;

// ── IO helpers (not unit-tested — exercised via E2E) ─────────────────────────
/* v8 ignore start */

const ZERO_SHA = "0000000000000000000000000000000000000000";
const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

function readStdin(): string {
  try {
    return readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}

// Fallback ref-determination when stdin parse yields nothing (same rationale as
// named-entity-scan.ts): stdin forwarding through git → lefthook → pnpm → node is
// not reliably forwarded on all platforms. @{push} and @{u} reflect the pre-push
// remote-tracking state without needing stdin.
function getUpstreamBase(): string | null {
  for (const ref of ["@{push}", "@{u}"]) {
    const probe = spawnSync("git", ["rev-parse", ref], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (probe.status === 0) return probe.stdout.trim();
  }
  return null;
}

// Runs a single `git diff <base>..<local>` range and returns the truncated diff text.
function runDiff(base: string, local: string): string {
  const result = spawnSync(
    "git",
    [
      "diff", "--unified=3",
      `${base}..${local}`,
      "--", ":!data/", ":!*.pdf", ":!*.docx",
    ],
    { encoding: "utf-8", maxBuffer: MAX_DIFF_BYTES * 2 },
  );
  if (result.status !== 0) return "";
  const diff = result.stdout;
  if (diff.length > MAX_DIFF_BYTES) {
    return diff.slice(0, MAX_DIFF_BYTES) + "\n\n[...diff truncated at 100 KB for review...]";
  }
  return diff;
}

// Collects the unified diff of the commits being pushed.
// Unions diffs from ALL pushed refs — mirrors getPushChangedFiles in named-entity-scan.ts,
// ensuring multi-ref pushes (e.g., pushing two branches simultaneously) are fully covered.
// Falls back to the upstream ref when stdin yielded no parseable refs.
function collectPushDiff(refs: Array<{ localSha: string; remoteSha: string }>): string {
  if (refs.length === 0) {
    // No stdin refs — use upstream ref fallback (same rationale as named-entity-scan.ts).
    const upstreamBase = getUpstreamBase() ?? EMPTY_TREE_SHA;
    return runDiff(upstreamBase, "HEAD");
  }

  // Union diffs from all pushed refs (mirrors getPushChangedFiles in named-entity-scan.ts).
  const parts: string[] = [];
  for (const ref of refs) {
    const base =
      ref.remoteSha === "" || ref.remoteSha === ZERO_SHA ? EMPTY_TREE_SHA : ref.remoteSha;
    const part = runDiff(base, ref.localSha);
    if (part.length > 0) parts.push(part);
  }
  return parts.join("\n");
}

// Invokes `claude --print` with the rubric + diff on stdin. Returns the raw output
// string, or null if the CLI is unavailable, times out, or errors (fail-open in all cases).
function invokeClaude(prompt: string): string | null {
  const raw = spawnSync("claude", ["--print"], {
    input: prompt,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 5 * 1024 * 1024,
    timeout: CLAUDE_TIMEOUT_MS,
  });

  // Narrow the raw result to our SpawnResult interface for the pure outcome function.
  const result: SpawnResult = {
    stdout: raw.stdout,
    stderr: raw.stderr,
    status: raw.status,
    signal: raw.signal,
    error: raw.error,
  };

  const outcome = parseClaudeSpawnOutcome(result);
  switch (outcome.kind) {
    case "success":
      return outcome.output;
    case "spawn-error":
      process.stderr.write(
        `[publish-check] WARNING: could not invoke 'claude --print' (${outcome.message}).\n` +
          "  The advisory review was skipped. Deterministic gates remain active.\n" +
          "  Install and authenticate the Claude Code CLI to enable this hook.\n",
      );
      return null;
    case "timeout":
      process.stderr.write(
        `[publish-check] WARNING: 'claude --print' timed out after ` +
          `${String(CLAUDE_TIMEOUT_MS / 1000)}s (signal: ${outcome.signal}).\n` +
          "  The advisory review was skipped. Deterministic gates remain active.\n",
      );
      return null;
    case "exit-error": {
      const errOut = outcome.stderr.trim();
      process.stderr.write(
        `[publish-check] WARNING: 'claude --print' exited with code ${String(outcome.status)}.\n` +
          (errOut.length > 0 ? `  stderr: ${errOut}\n` : "") +
          "  The advisory review was skipped. Deterministic gates remain active.\n",
      );
      return null;
    }
  }
}

function main(): void {
  if (!isOptIn()) {
    // Silently exit when the opt-in env var is not set.
    process.exit(0);
  }

  // parsePrePushRefs already filters out the zero-SHA and empty localSha entries.
  const refs = parsePrePushRefs(readStdin());

  const diff = collectPushDiff(refs);
  if (diff.trim().length === 0) {
    process.stdout.write("[publish-check] No outgoing diff to review — skipping advisory.\n");
    process.exit(0);
  }

  const prompt =
    PUBLISH_CHECK_RUBRIC +
    "\n\n---\n\nDIFF TO REVIEW:\n\n```diff\n" +
    diff +
    "\n```\n";

  process.stderr.write("[publish-check] Running advisory LLM review...\n");

  const output = invokeClaude(prompt);
  if (output === null) {
    // Fail-open: the deterministic gates already ran; this advisory layer could not run.
    process.exit(0);
  }

  const verdict = parsePublishCheckVerdict(output);

  if (verdict === null) {
    // No parseable verdict — inconclusive. Fail-open: print the raw output for context,
    // then exit 0 so the deterministic gates remain the hard wall.
    process.stderr.write(
      "[publish-check] WARNING: advisory review returned no parseable verdict.\n" +
        "  Review the output below and check manually before merging.\n" +
        "  (Raw output follows)\n\n" +
        output +
        "\n",
    );
    process.exit(0);
  }

  if (verdict.clean) {
    process.stdout.write("[publish-check] Advisory review: CLEAN — no findings.\n");
    process.exit(0);
  }

  // Findings detected.
  process.stderr.write(output + "\n");
  process.stderr.write(
    `\n[publish-check] Advisory review: ${String(verdict.findingCount)} finding(s) above.\n`,
  );

  if (isAcknowledged()) {
    process.stderr.write(
      "[publish-check] SELFWRIGHT_PUBLISH_ACK=1 set — acknowledged. Push will proceed.\n" +
        "  Address the findings before merging to main.\n",
    );
    process.exit(0);
  }

  process.stderr.write(
    "[publish-check] Push blocked until findings are acknowledged.\n" +
      "  Review the findings above, then re-push with:\n\n" +
      "    SELFWRIGHT_PUBLISH_ACK=1 git push\n\n" +
      "  This acknowledgement is one-shot (per push command only).\n" +
      "  Address the findings before merging to main.\n",
  );
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
/* v8 ignore stop */
