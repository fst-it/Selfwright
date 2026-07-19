import { traceClaims, splitSentences, scanHonestyBoundary } from "../truth/index.js";
import { scanAiTells } from "./ai-tells.js";
import type { EvidenceEntry, Identity, DriftEntry, Gap } from "../truth/index.js";
import type { PrepPackKind } from "../coaching/index.js";

export interface GenerationGuardResult {
  ok: boolean;
  violations: string[];
}

export interface CoverArtifactContext {
  registry: EvidenceEntry[];
  identity: Identity;
  drifts: DriftEntry[];
}

const COVER_MIN_WORDS = 350;
const COVER_MAX_WORDS = 400;
const BANNED_OPENING = /^i\s+am\s+writing\s+to\b/i;

/**
 * Validate a co-piloted (or headlessly generated) cover-letter artifact:
 * every claim traces to evidence, no retired/honesty-boundary phrases, and
 * the format rules from buildCoverSystemPrompt (350-400 words, no
 * "I am writing to..." opening) actually held.
 */
export function validateCoverArtifact(text: string, ctx: CoverArtifactContext): GenerationGuardResult {
  const violations: string[] = [];

  const trace = traceClaims(text, ctx.registry);
  if (!trace.ok) {
    violations.push(`Untraceable claim(s): ${trace.untraceable.join("; ")}`);
  }

  const honesty = scanHonestyBoundary(text, ctx.drifts, ctx.registry);
  for (const v of honesty.violations) {
    violations.push(`retired ${v.source}: "${v.phrase}"`);
  }

  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < COVER_MIN_WORDS || wordCount > COVER_MAX_WORDS) {
    violations.push(`Word count ${wordCount} outside the 350-400 range`);
  }

  if (BANNED_OPENING.test(text.trim())) {
    violations.push('Opening must not start with "I am writing to..."');
  }

  for (const v of scanAiTells(text)) {
    violations.push(v);
  }

  return { ok: violations.length === 0, violations };
}

export interface ResearchArtifactContext {
  registry: EvidenceEntry[];
  identity: Identity;
}

// Any of these markers indicate a sentence asserts something about the
// candidate: first-person (a cover letter), second-person (a coach/topics
// digest addressing the candidate directly), or third-person (a research/
// prep-pack/drill artifact describing the candidate as "the candidate",
// "the applicant", or "they"). Every validator that scopes truth-trace to
// candidate-referencing sentences shares this ONE set — a narrower,
// validator-specific allowlist (e.g. first-person-only for research/
// prep-pack, first+second-person for drill/topics) is exactly what let a
// third-person self-claim slip past some validators and not others (Phase 3
// adversarial review, finding F1).
const CANDIDATE_REFERENCE_RE =
  /\b(i|i've|i'm|my|me|you|your|you've|you're|they|their|them|he|she|his|her|candidate|applicant)\b/i;

/**
 * A research document is mostly sentences about the target company (revenue,
 * org structure, tech stack) — those have no reason to overlap with the
 * candidate's evidence registry and must not be treated as untraceable
 * claims. Only sentences that actually assert something about the candidate
 * (CANDIDATE_REFERENCE_RE, or the candidate's name) are claims truth-trace
 * should hold to the registry.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build one word-boundary matcher per name token (first, last, ...) plus the
 * full name as a phrase — not just the first token — so a sentence naming
 * the candidate by surname alone ("Smith rebuilt...") or by full name is
 * still recognized as candidate-referencing, not just given-name mentions.
 */
function nameMatchers(name: string): RegExp[] {
  const trimmed = name.trim();
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const patterns = new Set<string>();
  if (trimmed) patterns.add(trimmed);
  for (const t of tokens) patterns.add(t);
  return [...patterns].map((p) => new RegExp(`\\b${escapeRegExp(p)}\\b`, "i"));
}

function extractCandidateSentences(
  text: string,
  identity: Identity,
  referenceRe: RegExp = CANDIDATE_REFERENCE_RE,
): string {
  const matchers = nameMatchers(identity.name);
  return splitSentences(text)
    .filter((s) => {
      // A question ("## Likely questions" / "## Question" body text — "What
      // did you own on the platform?") asserts nothing about the candidate;
      // it's the prompt a claim responds to, not the claim itself. Widening
      // CANDIDATE_REFERENCE_RE to include "you" (needed to close the F1
      // second-person bypass) would otherwise pull every interview question
      // that happens to say "you" into truth-trace and reject it for having
      // no evidence overlap — a real false-positive, not a closed bypass.
      if (s.endsWith("?")) return false;
      return referenceRe.test(s) || matchers.some((m) => m.test(s));
    })
    .join(" ");
}

/**
 * Validate a company-research artifact: truth-trace (scoped to
 * candidate-referencing sentences only — see extractCandidateSentences) +
 * honesty, over the full text (no word-count format rule — research
 * documents aren't length-constrained the way a cover letter is). Honesty is
 * checked against the evidence registry's retired phrases only — research
 * artifacts aren't drift-eligible claims about the candidate, so there is no
 * drifts list to scan.
 */
export function validateResearchArtifact(text: string, ctx: ResearchArtifactContext): GenerationGuardResult {
  const violations: string[] = [];

  const candidateText = extractCandidateSentences(text, ctx.identity);
  const trace = traceClaims(candidateText, ctx.registry);
  if (!trace.ok) {
    violations.push(`Untraceable claim(s): ${trace.untraceable.join("; ")}`);
  }

  const honesty = scanHonestyBoundary(text, [], ctx.registry);
  for (const v of honesty.violations) {
    violations.push(`retired ${v.source}: "${v.phrase}"`);
  }

  for (const v of scanAiTells(text)) {
    violations.push(v);
  }

  return { ok: violations.length === 0, violations };
}

// ── Coaching generation-guard additions ──────────────────────────────────────

/**
 * Extract all EVD-* and GAP-* ids from text and return one violation string per
 * id that is not present in the respective registry/gaps set.
 */
function assertIdsExist(text: string, registry: EvidenceEntry[], gaps: Gap[]): string[] {
  // Each hyphen-separated segment must contain at least one alphanumeric char,
  // so a trailing bare hyphen (e.g. "EVD-001-style" → "EVD-001-") is never
  // swept into the match — that would compare a mangled id against the known
  // id set and spuriously report a real id as unknown. Segments stay
  // uppercase-only ([A-Z0-9]) deliberately: a real id followed by a lowercase
  // descriptive suffix ("EVD-SYN-COVER-001-verified") must resolve to the
  // real id, not a mangled "...-verified" token — the lowercase suffix simply
  // isn't part of the match, exactly as before.
  const evdMatches = text.match(/\bEVD-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/g) ?? [];
  const gapMatches = text.match(/\bGAP-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/g) ?? [];
  const allIds = [...new Set([...evdMatches, ...gapMatches])];
  const knownEvd = new Set(registry.map((e) => e.id));
  const knownGap = new Set(gaps.map((g) => g.id));
  const errors: string[] = [];
  for (const id of allIds) {
    if (id.startsWith("EVD-") && !knownEvd.has(id)) {
      errors.push(`unknown id: ${id}`);
    } else if (id.startsWith("GAP-") && !knownGap.has(id)) {
      errors.push(`unknown id: ${id}`);
    }
  }

  // Separately: a lowercase/mixed-case "evd-"/"gap-" PREFIX evades the
  // uppercase-only scan above entirely (Phase 3 adversarial review, minor
  // finding) — "evd-fake-999" was previously invisible, neither confirmed
  // real nor reported. Flag it here without touching the segment-matching
  // behavior above.
  //
  // A ≥2-hyphen (3+ segment) match is always flagged when wrong-cased — real
  // ids in this codebase are multi-segment ("EVD-ACME-LEADERSHIP",
  // "GAP-SYN-001") and English prose essentially never chains 3+ hyphenated
  // segments, so this shape alone is a safe signal.
  //
  // A single-hyphen match ("evd-acme", "gap-year") is also a schema-legal
  // id shape (EVD_ID_PATTERN/GAP_ID_PATTERN allow a single segment) but is
  // ambiguous with ordinary English compounds that happen to start with the
  // same prefix word ("gap-year", "gap-analysis"). Flag it only when the
  // segment after the hyphen structurally looks like an id token — contains
  // a digit or an uppercase letter (e.g. "evd-042", "gap-SYN") — rather than
  // a plain lowercase dictionary word (R4, Phase 3 truth-floor hardening).
  const caseMismatchMatches =
    text.match(/\b(?:evd|gap)-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\b/gi) ?? [];
  for (const m of caseMismatchMatches) {
    if (/^(?:EVD|GAP)-/.test(m)) continue; // correctly-cased — not a mismatch
    const hyphenCount = (m.match(/-/g) ?? []).length;
    if (hyphenCount >= 2) {
      errors.push(`malformed id (wrong case): ${m}`);
      continue;
    }
    const segmentAfterPrefix = m.slice(m.indexOf("-") + 1);
    if (/[A-Z0-9]/.test(segmentAfterPrefix)) {
      errors.push(`malformed id (wrong case): ${m}`);
    }
  }

  return errors;
}

export interface PrepPackArtifactContext {
  registry: EvidenceEntry[];
  identity: Identity;
  drifts: DriftEntry[];
  gaps: Gap[];
  kind: PrepPackKind;
}

// Global flag required for matchAll — every occurrence of the heading must
// be found and id-checked, not just the first (see F4 below).
const GAPS_REHEARSE_RE_G = /^#{1,2}\s*gaps to rehearse/gim;

export function validatePrepPackArtifact(
  text: string,
  ctx: PrepPackArtifactContext,
): GenerationGuardResult {
  const violations: string[] = [];

  // 1. Honesty boundary (full text)
  const honesty = scanHonestyBoundary(text, ctx.drifts, ctx.registry);
  for (const v of honesty.violations) {
    violations.push(`retired ${v.source}: "${v.phrase}"`);
  }

  // 2. Truth-trace scoped to candidate-referencing sentences
  const candidateText = extractCandidateSentences(text, ctx.identity);
  const trace = traceClaims(candidateText, ctx.registry);
  if (!trace.ok) {
    violations.push(`Untraceable claim(s): ${trace.untraceable.join("; ")}`);
  }

  // 3. Must cite at least one EVD-* id anywhere
  if (!/\bEVD-[A-Z0-9-]+\b/.test(text)) {
    violations.push("No evidence cited anywhere in the prep-pack");
  }

  // 4. "Gaps to rehearse" section check — every occurrence, not just the
  // first. A duplicate heading's body was previously never id-checked at
  // all: text.search() (and a single non-global GAPS_REHEARSE_RE) only ever
  // finds the FIRST match, so a second "## Gaps to rehearse" section with
  // zero ids and fabricated content sailed through unexamined (Phase 3
  // adversarial review, finding F4).
  const gapsHeadingMatches = [...text.matchAll(GAPS_REHEARSE_RE_G)];
  if (ctx.kind === "interview" && gapsHeadingMatches.length === 0) {
    violations.push('Missing required "Gaps to rehearse" section for interview prep-pack');
  }
  for (const headingMatch of gapsHeadingMatches) {
    const afterHeading = text.slice(headingMatch.index);
    const nextHeadingMatch = afterHeading.match(/\n#{1,2}\s/);
    const sectionBody =
      nextHeadingMatch !== null && nextHeadingMatch.index !== undefined
        ? afterHeading.slice(0, nextHeadingMatch.index)
        : afterHeading;
    const hasGapId = /\bGAP-[A-Z0-9-]+\b/.test(sectionBody);
    const hasEvdId = /\bEVD-[A-Z0-9-]+\b/.test(sectionBody);
    if (!hasGapId || !hasEvdId) {
      const missing: string[] = [];
      if (!hasGapId) missing.push("GAP-*");
      if (!hasEvdId) missing.push("EVD-*");
      violations.push(`"Gaps to rehearse" section missing: ${missing.join(", ")}`);
    }
  }

  // 5. Id integrity
  for (const v of assertIdsExist(text, ctx.registry, ctx.gaps)) {
    violations.push(v);
  }

  // 6. AI-tell detection (full text)
  for (const v of scanAiTells(text)) {
    violations.push(v);
  }

  return { ok: violations.length === 0, violations };
}

export interface DrillArtifactContext {
  registry: EvidenceEntry[];
  identity: Identity;
  drifts: DriftEntry[];
  gaps: Gap[];
}

const DRILL_REQUIRED_HEADINGS = ["## Question", "## My answer", "## Coach critique"] as const;

// Line-anchored: a decoy occurrence of this heading text quoted/pasted inside
// "## My answer" (almost always mid-line, not the first thing on its own
// line) must not match here and hijack the coach-authored slice boundary.
const COACH_CRITIQUE_HEADING_RE = /^##\s*Coach critique/m;

export function validateDrillArtifact(
  text: string,
  ctx: DrillArtifactContext,
): GenerationGuardResult {
  const violations: string[] = [];

  // 1. Required structure headings
  for (const heading of DRILL_REQUIRED_HEADINGS) {
    if (!text.includes(heading)) {
      violations.push(`Missing required heading: ${heading}`);
    }
  }

  // 2. Honesty/trace/grounding scoped to the coach-authored slice only. The
  // section boundary is found via a line-anchored heading match (see above),
  // never a plain substring search over the full text.
  const coachHeadingMatch = text.match(COACH_CRITIQUE_HEADING_RE);
  if (coachHeadingMatch !== null && coachHeadingMatch.index !== undefined) {
    const coachText = text.slice(coachHeadingMatch.index);

    // Required Grounding: line — must appear within the Coach critique
    // section itself. A decoy "Grounding:" line elsewhere in the document
    // (e.g. pasted inside "## My answer") must not satisfy this: checking
    // presence over the full text while extracting ids from coachText only
    // let a coach section with zero grounding pass trivially (no ids found
    // in an empty grounding slice means the id-integrity check is vacuous).
    const groundingMatch = coachText.match(/^Grounding:\s*(.+)/m);
    if (groundingMatch === null) {
      violations.push("Missing required 'Grounding:' line in the Coach critique section");
    }

    const honesty = scanHonestyBoundary(coachText, ctx.drifts, ctx.registry);
    for (const v of honesty.violations) {
      violations.push(`retired ${v.source}: "${v.phrase}"`);
    }

    // Truth-trace scoped to candidate-referencing sentences within the coach
    // slice, using the shared CANDIDATE_REFERENCE_RE default (first/second/
    // third-person — see the constant's definition above).
    const candidateCoachText = extractCandidateSentences(coachText, ctx.identity);
    const trace = traceClaims(candidateCoachText, ctx.registry);
    if (!trace.ok) {
      violations.push(`Untraceable claim(s): ${trace.untraceable.join("; ")}`);
    }

    // 3. Id integrity on the Grounding: line only (not the whole text)
    const groundingContent =
      groundingMatch !== null ? (groundingMatch[1] ?? "") : "";
    for (const v of assertIdsExist(groundingContent, ctx.registry, ctx.gaps)) {
      violations.push(v);
    }
  }

  // AI-tell detection (full text)
  for (const v of scanAiTells(text)) {
    violations.push(v);
  }

  return { ok: violations.length === 0, violations };
}

export interface GapArtifactContext {
  registry: EvidenceEntry[];
  drifts: DriftEntry[];
}

/**
 * Validate a set of gap ledger rows: evidence id existence, honesty boundary on
 * honest_gap+frame, and traceClaims on frame against the gap's own evidence.
 * Returns a single combined result with gap.id-prefixed violation strings.
 */
export function validateGapArtifact(
  gaps: Gap[],
  ctx: GapArtifactContext,
): GenerationGuardResult {
  const violations: string[] = [];

  for (const gap of gaps) {
    // Evidence id existence
    for (const evId of gap.evidence_ids) {
      if (!ctx.registry.some((e) => e.id === evId)) {
        violations.push(`${gap.id}: unknown evidence id ${evId}`);
      }
    }

    // Honesty boundary on honest_gap + frame
    const honestyText = gap.honest_gap + " " + gap.frame;
    const honesty = scanHonestyBoundary(honestyText, ctx.drifts, ctx.registry);
    for (const v of honesty.violations) {
      violations.push(`${gap.id}: retired ${v.source}: "${v.phrase}"`);
    }

    // Truth-trace: frame AND honest_gap must both be grounded in the gap's
    // own evidence_ids. honest_gap was previously never traced at all — a
    // co-pilot-authored gap row could carry a fabricated honest_gap and only
    // the frame text was ever checked (Phase 3 adversarial review, minor
    // finding).
    const entries = ctx.registry.filter((e) => gap.evidence_ids.includes(e.id));
    const trace = traceClaims(gap.frame, entries);
    if (!trace.ok) {
      violations.push(
        `${gap.id}: frame not grounded in its evidence_ids: ${trace.untraceable.join("; ")}`,
      );
    }
    const honestGapTrace = traceClaims(gap.honest_gap, entries);
    if (!honestGapTrace.ok) {
      violations.push(
        `${gap.id}: honest_gap not grounded in its evidence_ids: ${honestGapTrace.untraceable.join("; ")}`,
      );
    }

    // AI-tell detection on honest_gap + frame
    for (const v of scanAiTells(honestyText)) {
      violations.push(`${gap.id}: ${v}`);
    }
  }

  return { ok: violations.length === 0, violations };
}

// ── Content topics generation-guard (T3.3) ───────────────────────────────

export interface TopicsArtifactContext {
  registry: EvidenceEntry[];
  identity: Identity;
  drifts: DriftEntry[];
  gaps: Gap[];
}

// Line-anchored heading matchers — a decoy heading quoted inside a list item
// or body prose (almost always not at the start of a line) must not match.
const TOPICS_WRITE_HEADING_RE = /^##\s*Topics to write/im;
const TOPICS_READ_HEADING_RE = /^##\s*Topics to read/im;

// Topic item format: a markdown list item starting with '- ' (at line start),
// plus any immediately-following indented continuation lines (e.g. the
// SKILL.md-documented indented "Sources: https://..." line) — up to the next
// '- ' item, heading, or blank line. The system prompt specifies this exact
// format so the two stay in lockstep. Matching only the continuation lines
// that belong to an item (not swallowing a following item) keeps the count
// of '- '-prefixed items exact — continuation lines never add extra matches.
const TOPIC_ITEM_RE = /^- .+(?:\n[ \t]+.+)*/gm;

// Topic-label prefix: the text before the first ':' or '—' on a '- ' list
// item line. A topic item is built from an evidence-derived label (e.g.
// "Treasury settlement:"), so its tokens trivially overlap the evidence
// entry that backs it; stripping the label before candidate-sentence
// extraction forces a fabricated remainder to trace independently instead of
// riding free on the label's overlap (see stripTopicLabelPrefixes below).
const TOPIC_LABEL_LINE_RE = /^-\s+(.*)$/;

/**
 * Strip the topic-label prefix from each '- ' list-item line before running
 * candidate-sentence extraction. Non-list-item lines (headings, prose, the
 * Grounding: line) are left untouched. Lines with no ':' or '—' separator
 * are left untouched too (nothing to strip).
 */
function stripTopicLabelPrefixes(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const m = line.match(TOPIC_LABEL_LINE_RE);
      if (m === null) return line;
      const rest = m[1] ?? "";
      // Only look for a separator before any URL in the item — a URL's
      // "https://" colon must never be mistaken for a label separator.
      const urlIdx = rest.search(/https?:\/\//i);
      const searchIn = urlIdx === -1 ? rest : rest.slice(0, urlIdx);
      const colonIdx = searchIn.indexOf(":");
      const dashIdx = searchIn.indexOf("—");
      const sepIdxs = [colonIdx, dashIdx].filter((i) => i !== -1);
      if (sepIdxs.length === 0) return line;
      const sepIdx = Math.min(...sepIdxs);
      return rest.slice(sepIdx + 1);
    })
    .join("\n");
}

/**
 * Extract the body of a section starting at headingRe until the next ## heading
 * (or end of text). Returns null if the heading is not found.
 */
function extractSectionBody(text: string, headingRe: RegExp): string | null {
  const headingMatch = text.match(headingRe);
  if (headingMatch === null || headingMatch.index === undefined) return null;
  const afterHeading = text.slice(headingMatch.index);
  const nextHeadingMatch = afterHeading.match(/\n#{1,2}\s/);
  if (nextHeadingMatch !== null && nextHeadingMatch.index !== undefined) {
    return afterHeading.slice(0, nextHeadingMatch.index);
  }
  return afterHeading;
}

/**
 * Validate a co-piloted content-topics artifact.
 *
 * Checks (in order):
 * 1. Both ## Topics to write and ## Topics to read headings present (line-anchored).
 * 2. Combined topic item count (markdown list items starting with "- ") is 3–5.
 * 3. Every topic item contains at least one https URL.
 * 4. Id integrity — every EVD- and GAP- id cited must exist in ctx.
 * 5. The ## Topics to write section cites at least one EVD- id overall.
 * 6. A Grounding: line is present in the text from ## Topics to read onwards
 *    (anchored to prevent a decoy Grounding: in the write section from satisfying it).
 * 7. Honesty boundary over the full text.
 * 8. Truth-trace scoped to candidate-referencing sentences, using the shared
 *    CANDIDATE_REFERENCE_RE set (first/second/third-person; candidate name
 *    still matches too) and with each topic item's label prefix stripped
 *    first so a fabricated remainder can't ride free on the label's
 *    evidence-overlapping tokens.
 */
export function validateTopicsArtifact(
  text: string,
  ctx: TopicsArtifactContext,
): GenerationGuardResult {
  const violations: string[] = [];

  // 1. Required headings (line-anchored)
  const writeHeadingPresent = TOPICS_WRITE_HEADING_RE.test(text);
  const readHeadingPresent = TOPICS_READ_HEADING_RE.test(text);
  if (!writeHeadingPresent) {
    violations.push("Missing required heading: ## Topics to write");
  }
  if (!readHeadingPresent) {
    violations.push("Missing required heading: ## Topics to read");
  }

  // 2–3. Topic item count and URL presence
  const writeSectionBody = writeHeadingPresent
    ? extractSectionBody(text, TOPICS_WRITE_HEADING_RE)
    : null;
  const readSectionBody = readHeadingPresent
    ? extractSectionBody(text, TOPICS_READ_HEADING_RE)
    : null;

  const writeItems = writeSectionBody !== null
    ? (writeSectionBody.match(TOPIC_ITEM_RE) ?? [])
    : [];
  const readItems = readSectionBody !== null
    ? (readSectionBody.match(TOPIC_ITEM_RE) ?? [])
    : [];
  const allItems = [...writeItems, ...readItems];
  const totalTopics = allItems.length;

  if (totalTopics < 3 || totalTopics > 5) {
    violations.push(
      `Combined topic count is ${totalTopics}; must be between 3 and 5`,
    );
  }

  for (const item of allItems) {
    if (!/https?:\/\//.test(item)) {
      violations.push(`Topic item missing a source URL: "${item.slice(0, 80)}"`);
    }
  }

  // 4. Id integrity
  for (const v of assertIdsExist(text, ctx.registry, ctx.gaps)) {
    violations.push(v);
  }

  // 5. Write section must cite at least one EVD-* id overall
  if (writeSectionBody !== null && !/\bEVD-[A-Z0-9-]+\b/.test(writeSectionBody)) {
    violations.push("## Topics to write section must cite at least one EVD-* id");
  }

  // 6. Grounding: line must appear in the slice from ## Topics to read onwards
  // (line-anchored — a decoy Grounding: inside the write section does not count).
  const readSectionSlice = (() => {
    if (!readHeadingPresent) return null;
    const m = text.match(TOPICS_READ_HEADING_RE);
    return m !== null && m.index !== undefined ? text.slice(m.index) : null;
  })();
  if (readSectionSlice !== null) {
    if (!/^Grounding:\s*.+/m.test(readSectionSlice)) {
      violations.push(
        "Missing required 'Grounding:' line after the '## Topics to read' section",
      );
    }
  } else if (readHeadingPresent) {
    violations.push(
      "Missing required 'Grounding:' line after the '## Topics to read' section",
    );
  }

  // 7. Honesty boundary (full text)
  const honesty = scanHonestyBoundary(text, ctx.drifts, ctx.registry);
  for (const v of honesty.violations) {
    violations.push(`retired ${v.source}: "${v.phrase}"`);
  }

  // 8. Truth-trace scoped to candidate-referencing sentences, using the
  //    shared CANDIDATE_REFERENCE_RE default (first/second/third-person —
  //    a topics digest naturally addresses the owner in second person too,
  //    a write topic's angle or a read topic's framing). Topic-label
  //    prefixes are stripped first so a fabricated remainder can't ride free
  //    on the label's evidence-overlapping tokens (T3.3 finding 2).
  const candidateSourceText = stripTopicLabelPrefixes(text);
  const candidateText = extractCandidateSentences(candidateSourceText, ctx.identity);
  const trace = traceClaims(candidateText, ctx.registry);
  if (!trace.ok) {
    violations.push(`Untraceable claim(s): ${trace.untraceable.join("; ")}`);
  }

  // 9. AI-tell detection (full text)
  for (const v of scanAiTells(text)) {
    violations.push(v);
  }

  return { ok: violations.length === 0, violations };
}
