import type { CandidateGap, GapHint } from "../coaching/index.js";

/**
 * Build a human-readable gap coverage report from a list of CandidateGap rows.
 * Grouped by tier: uncovered first (most actionable), then partial, then covered.
 * When debrief-derived hints are provided, a fourth section is appended.
 * JSON output (if wanted) is the CLI layer's job — this function is plain text only.
 */
export function buildGapScanReport(candidates: CandidateGap[], hints?: GapHint[]): string {
  const uncovered = candidates.filter((c) => c.coverage === "uncovered");
  const partial = candidates.filter((c) => c.coverage === "partial");
  const covered = candidates.filter((c) => c.coverage === "covered");

  const lines: string[] = ["# Skill Gap Coverage Report", ""];

  lines.push(`## Uncovered (${uncovered.length})`);
  if (uncovered.length === 0) {
    lines.push("(none)");
  } else {
    for (const c of uncovered) {
      const gapRef = c.existingGapId
        ? `existing: ${c.existingGapId}`
        : c.suggestedGapId
          ? `suggested id: ${c.suggestedGapId}`
          : "";
      lines.push(`- ${c.topic}${gapRef ? ` (${gapRef})` : ""}`);
    }
  }
  lines.push("");

  lines.push(`## Partial coverage (${partial.length})`);
  if (partial.length === 0) {
    lines.push("(none)");
  } else {
    for (const c of partial) {
      const evdStr =
        c.evidenceIds.length > 0 ? ` [${c.evidenceIds.join(", ")}]` : "";
      const gapRef = c.existingGapId
        ? ` (existing: ${c.existingGapId})`
        : c.suggestedGapId
          ? ` (suggested: ${c.suggestedGapId})`
          : "";
      lines.push(`- ${c.topic}${evdStr}${gapRef}`);
    }
  }
  lines.push("");

  lines.push(`## Covered (${covered.length})`);
  if (covered.length === 0) {
    lines.push("(none)");
  } else {
    for (const c of covered) {
      const evdStr =
        c.evidenceIds.length > 0 ? ` [${c.evidenceIds.join(", ")}]` : "";
      lines.push(`- ${c.topic}${evdStr}`);
    }
  }

  // Debrief-derived hints: topics that wobbled or went unanswered in real interviews.
  // These are SUGGESTIONS only — no auto-write to gaps.yml (ADR 0013 scope cut).
  if (hints !== undefined && hints.length > 0) {
    lines.push("");
    lines.push(`## Debrief-derived hints (${hints.length})`);
    lines.push("Topics that wobbled or were unanswered in real interviews — review-only, not auto-written to gaps.yml.");
    for (const h of hints) {
      const appRef = h.sourceApplicationIds.length > 0
        ? ` [${h.sourceApplicationIds.join(", ")}]`
        : "";
      lines.push(`- ${h.topic} (count: ${h.count})${appRef}`);
    }
  }

  return lines.join("\n");
}
