---
name: publish-check
description: Advisory LLM review of an outgoing diff for contextual PII, semantic leaks, and ungrounded claims — the layer above the deterministic gates. Mandatory before opening or updating any PR. Use when the user wants to check a branch diff for publication-readiness or asks to "run publish-check".
argument-hint: "[<ref-range> | --staged]"
---

# publish-check

Advisory LLM rubric review over outgoing changes. Runs above and independently of the
deterministic gates (data-leak gate, named-entity scan, machine-identity scan). It catches issues
those gates structurally cannot: contextual identifiability from combined context, semantic leaks
of confidential situations, and ungrounded claims that violate the truth floor.

**This layer is advisory.** Deterministic gates are the hard wall — they run unconditionally and
their verdicts are absolute. This skill adds a second, higher-level pass that can flag what a
regex cannot see. A finding here does not auto-block; it requires human judgment. See §6 of
MANUAL.md and ADR 0022.

**Running this skill is mandatory before opening or updating any PR** (process rule, ADR 0022).
An optional pre-push hook (`publish-check-advisory` in lefthook) automates this for subscribers;
see MANUAL §3.8.

---

## How to run it

Determine the ref range:
- If the user passed a ref range (e.g., `main..HEAD`, `HEAD~3..HEAD`), use it.
- If `--staged` was passed, diff the staging area: `git diff --cached`.
- Default: `git diff origin/main...HEAD` (everything on the current branch not yet on main).

Collect the diff:

```
git diff <range> -- ':!data/' ':!*.pdf' ':!*.docx'
```

Exclude `data/` (private data) and generated binary artifacts. If the diff is empty, report
"No outgoing changes to review" and stop (no verdict line needed for empty diffs).

Apply the rubric below, section by section. Report all findings before the verdict line.

---

## Rubric

### Category 1 — Contextual PII

**Definition:** A person or company that is identifiable from combined context even though no name
appears in any single changed line. A regex cannot catch this because identifiability is
contextual, not syntactic.

**What to look for:**

- A job title + team + date combination that points to a specific real person, even if the name
  is omitted. Example: "the VP of Engineering who interviewed me on 2026-07-01" — no name, but
  combined with visible company context this uniquely identifies someone.
- A recruiter or hiring manager referenced by role and relationship (e.g., "my contact on the
  talent acquisition side at Blorptech") when the company is itself identifiable.
- A contact email address (even partial — `j.doe@...` or a domain that directly identifies the
  person) appearing in any framework file.
- An internal organizational detail (team name, reporting structure, project codename) that is
  not publicly known and that combined with the company name would identify a confidential
  internal contact.

**Synthetic examples:**

| Diff content | Verdict |
|---|---|
| `// notified by the Blorptech talent team lead` (with `company: "Blorptech"` visible nearby) | FINDING: contextual-PII — company + role enough to identify individual |
| `# Research notes for Zorblatt Inc — spoke to their Head of Platform` | FINDING: contextual-PII — company + title combination |
| `archetype: data-platform` (standalone, no company context) | Clean — no individual identifiable |

**Severity:** medium–high. Identifiability of a real person from public context = high.

---

### Category 2 — Semantic Leak

**Definition:** The diff describes a confidential situation, negotiation, interview detail, or
private data structure in a way that would be inappropriate in a public framework repo, even
without naming any individual.

**What to look for:**

- **Negotiation details:** salary or comp figures tied to a specific process ("the offer was
  below my target of X"); timeline pressure ("they need an answer by Friday"); any specific
  hiring-stage detail that a third party would not know.
- **Interview content:** questions asked in a real interview ("they asked about sharding strategy
  on a 500TB dataset"), specific technical scenarios posed, or hints about a company's internal
  architecture revealed in an interview context.
- **Private data structures:** YAML field names, schema shapes, or file paths that describe the
  private truth-layer data (`truth/identity.yml`, `applications/`, `contacts/`). The framework
  can reference these by their public interface (the loader APIs); it must not describe the
  internal shape of real private data.
- **Confidence-scored drift rationale:** a diff exposing the reasoning behind a specific drift
  entry ("I'm claiming X because the interviewer implied they use Y internally") in a framework
  file.
- **Debrief-sourced signals:** post-interview notes describing what questions were asked, what
  topics you wobbled on, or a hiring manager's verbal feedback, if those details would reveal
  confidential information about the process.

**Synthetic examples:**

| Diff content | Verdict |
|---|---|
| `# offer below comp floor — declined 2026-07-01` in a framework comment | FINDING: semantic-leak — compensation negotiation detail |
| `// asked about multi-region failover at Blorptech infra interview` | FINDING: semantic-leak — interview question revealing internal architecture |
| `// drift rationale: recruiter implied they are migrating to K8s` | FINDING: semantic-leak — confidential company internal detail in framework file |
| `loadApplications(dataDir)` (using the public loader API) | Clean — public interface only |
| `// TODO: add debrief-hints to gap output` | Clean — process comment, no content leak |

**Severity:** low–high. Compensation details or interview architecture reveals = high. A generic
comment about the interview process with no identifiable detail = low.

---

### Category 3 — Ungrounded Claim

**Definition:** A statement in the diff that asserts a professional fact or personal capability
that cannot be traced to the evidence registry (`truth/evidence/registry.yml`). This is the
LLM-tier complement to the deterministic truth-trace validator — it catches high-confidence,
high-specificity claims (metrics, titles, system names) that appear in non-artifact framework
content (comments, documentation, skill files, configuration) where the deterministic validator
does not run.

**What to look for:**

- Specific metrics in comments or docs that are presented as the author's own achievements
  but have no EVD-* anchor: "cut P99 latency from 400ms to 80ms", "team of 35 engineers".
- Job titles claimed in framework files that are not in the truth layer's roles timeline.
- A technology or architecture claim tied to a specific company that sounds like it comes from
  private interview knowledge rather than public information.
- Comparative claims: "best-in-class", "industry-leading" applied to one's own work without
  a supporting evidence entry.

**Note:** Comments that are clearly illustrative, synthetic, or hypothetical (e.g., "e.g.,
3,000 records" as a format example) are NOT findings. The question is whether the diff presents
the claim as a real, first-person professional fact.

**Synthetic examples:**

| Diff content | Verdict |
|---|---|
| `# EVD-0042 proves the 12× throughput improvement` | Clean — explicitly EVD-anchored |
| `// proof: reduced pipeline runtime by 87%` in a framework comment, no EVD reference | FINDING: ungrounded-claim — specific metric without EVD-* anchor |
| `// e.g., "processed 10,000 items per batch"` in a format example | Clean — illustrative, not first-person claim |

**Severity:** medium. A metric without EVD anchor that appears in published framework docs = high.
An unanchored claim buried in a code comment that is unlikely to be read as first-person = low.

---

## Output format

For each finding, output a line in this exact format:

```
FINDING: [contextual-PII|semantic-leak|ungrounded-claim] severity:[low|medium|high] file:<path> line:<N-or-range> — <one-sentence description>
```

If the diff hunk does not include a clear line number, omit `line:` and use `file:<path>` alone.

Group findings by file. After all findings (or after stating "No findings." if none), output
**exactly one verdict line** as the final line of the entire response:

```
PUBLISH-CHECK: CLEAN
```

or

```
PUBLISH-CHECK: N FINDINGS
```

where N is the total count of FINDING lines above. Do not add any text after the verdict line.

---

## Decision threshold

- **CLEAN:** zero findings across all three categories. Verdict: `PUBLISH-CHECK: CLEAN`.
- **FINDINGS:** one or more findings. Verdict: `PUBLISH-CHECK: N FINDINGS`.

Do not suppress borderline findings — if something is ambiguous, include it as a low-severity
finding. The human reviewer decides whether to address or acknowledge it. The advisory layer
errs on the side of flagging.

---

## Known limitations

**Prompt injection.** This review is not tamper-proof against adversarial diff content. A diff
can contain text that coerces the model into emitting `PUBLISH-CHECK: CLEAN` regardless of what
the diff actually contains. This is an acceptable residual risk for an advisory layer whose hard
wall is the deterministic gates (data-leak gate, named-entity scan, machine-identity scan):
those gates are regex/token-based and structurally immune to content-level injection — they run
unconditionally on every commit and push and are the only hard guarantee. The advisory verdict
should be treated as a best-effort signal, not a tamper-proof certificate. See ADR 0022
§Known limitations.

In practice, the owner authors the diff. An attacker who controls diff content has already
bypassed physical access controls entirely outside the scope of this system.

---

## What this skill does NOT check

- Regex-detectable PII (phone, email pattern, salary pattern, `data/` paths) — the data-leak
  gate handles this deterministically at commit time.
- Named entity matches (confidential company/person names derived from the private data layer)
  — the named-entity scan handles this at commit and push time.
- Machine-identity patterns (username, hostname, local paths) — the machine-identity scan
  handles this at commit and push time.
- Grammar, style, or prose quality of the diff content.
- Whether the code change is correct or well-architected.
