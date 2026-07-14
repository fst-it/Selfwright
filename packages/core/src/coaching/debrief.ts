// ── Coaching: interview debrief schema and derived functions ───────────────────
//
// PRIVACY NOTE: Interviewer/person NAMES must NEVER appear in debriefs.yml.
// The data repo's PII hook blocks names outside contacts/ and truth/.
// Reference people via contacts entries instead of writing names here.
//
// File path: <SELFWRIGHT_DATA_DIR>/coaching/debriefs.yml
// Root key: debriefs:
import { z } from "zod";
import type { EvidenceEntry, Ontology } from "../truth/index.js";

// ── Schema ────────────────────────────────────────────────────────────────────

export const DebriefSchema = z.object({
  /** Matches an id in applications.yml */
  application_id: z.string().min(1),
  /** Interview date in YYYY-MM-DD format */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  /** Round label, e.g. "HR screen", "hiring manager", "panel" */
  round: z.string().optional(),
  /** Questions/topics that were asked. Do NOT include interviewer names. */
  asked: z.array(z.string()).optional(),
  /** Topics that went badly — these feed the gap/drill machinery as suggestions. */
  wobbled: z.array(z.string()).optional(),
  /** Topics that went well */
  went_well: z.array(z.string()).optional(),
  /**
   * Free-form notes.
   * IMPORTANT: do NOT include interviewer/person names here.
   * Reference people via contacts entries instead.
   */
  notes: z.string().optional(),
});

export type Debrief = z.infer<typeof DebriefSchema>;

export const DebriefsFileSchema = z.object({
  debriefs: z.array(DebriefSchema),
});

export type DebriefsFile = z.infer<typeof DebriefsFileSchema>;

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * A ranked gap-hint topic derived from one or more debrief records.
 * These are SUGGESTIONS only — no auto-write to gaps.yml (ADR 0013 scope cut).
 */
export interface GapHint {
  topic: string;
  /** Sorted, deduplicated application ids from which this topic was derived. */
  sourceApplicationIds: string[];
  /** Number of times this topic appeared across debriefs (not deduplicated by app). */
  count: number;
}

/**
 * Minimal application shape required by findUndebriefedInterviews.
 * Structurally compatible with ApplicationRecord (services/types).
 */
export interface ApplicationSummary {
  id: string;
  status: string;
  dates?: { last_update?: string };
}

// ── Functions ─────────────────────────────────────────────────────────────────

/**
 * Derive ranked gap-hint topics from debrief records.
 *
 * Sources (per debrief):
 *  - wobbled[] entries (primary: explicitly failed)
 *  - asked[] entries NOT present in went_well[] (unanswered/weak)
 *
 * Topics are grouped case-insensitively; the first-seen raw form is used as
 * the display string. Registry and ontology parameters are accepted for
 * interface parity with the coaching context's one-primitive rule (ADR 0013);
 * future callers may use them to cross-reference evidence coverage — do NOT
 * add a new tokenizer here.
 *
 * Returns hints sorted by count descending, then topic ascending.
 * These are SUGGESTIONS only — no auto-write to gaps.yml.
 */
export function deriveGapHintsFromDebriefs(
  debriefs: Debrief[],
  // _registry and _ontology are reserved for a future iteration that will use
  // the shared tokenizer from truth/trace.ts (ADR 0013 one-primitive rule).
  // They are intentionally unused now — deliberate scope cut per ADR 0013.
  registry: EvidenceEntry[],
  ontology?: Ontology,
): GapHint[] {
  // Consume reserved params to satisfy the linter; no logic depends on them.
  void registry;
  void ontology;
  const counts = new Map<string, number>();
  const display = new Map<string, string>();          // key → first-seen raw form
  const appIdSets = new Map<string, Set<string>>();   // key → unique app ids

  function add(rawTopic: string, appId: string): void {
    const key = rawTopic.toLowerCase().trim();
    if (!key) return;
    if (!display.has(key)) display.set(key, rawTopic.trim());
    counts.set(key, (counts.get(key) ?? 0) + 1);
    let ids = appIdSets.get(key);
    if (ids === undefined) {
      ids = new Set<string>();
      appIdSets.set(key, ids);
    }
    ids.add(appId);
  }

  for (const debrief of debriefs) {
    const appId = debrief.application_id;
    const wellSet = new Set(
      (debrief.went_well ?? []).map((t) => t.toLowerCase().trim()),
    );

    for (const topic of debrief.wobbled ?? []) {
      add(topic, appId);
    }
    for (const topic of debrief.asked ?? []) {
      // Unanswered = asked but NOT in went_well (case-insensitive)
      if (!wellSet.has(topic.toLowerCase().trim())) {
        add(topic, appId);
      }
    }
  }

  const results: GapHint[] = [];
  for (const [key, count] of counts.entries()) {
    const topic = display.get(key) ?? key;
    const ids = appIdSets.get(key) ?? new Set<string>();
    results.push({
      topic,
      sourceApplicationIds: Array.from(ids).sort(),
      count,
    });
  }

  return results.sort(
    (a, b) => b.count - a.count || a.topic.localeCompare(b.topic),
  );
}

/**
 * Return applications with status "interview" that have no debrief dated
 * on or after their dates.last_update.
 *
 * Debriefed = at least one Debrief with matching application_id AND
 * date >= dates.last_update (lexicographic ISO-date comparison).
 * When dates.last_update is absent, any matching debrief counts.
 */
export function findUndebriefedInterviews<T extends ApplicationSummary>(
  applications: T[],
  debriefs: Debrief[],
): T[] {
  return applications.filter((app) => {
    if (app.status !== "interview") return false;
    const matching = debriefs.filter((d) => d.application_id === app.id);
    if (matching.length === 0) return true; // no debrief at all → undebriefed
    const lastUpdate = app.dates?.last_update;
    if (!lastUpdate) return false; // has debriefs, no baseline date → consider debriefed
    // Undebriefed if NO matching debrief is dated on/after last_update
    return !matching.some((d) => d.date >= lastUpdate);
  });
}
