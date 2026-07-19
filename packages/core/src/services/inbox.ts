import { findUndebriefedInterviews } from "../coaching/index.js";
import { isStaleEntry, DEFAULT_AGING_WINDOW_DAYS } from "../scanning/index.js";
import type {
  InboxData,
  InboxReport,
  InboxItem,
  ApplicationRecord,
} from "./types.js";

function daysSince(dateStr: string | undefined, asOf: Date): number {
  if (!dateStr) return 999;
  const d = Date.parse(dateStr);
  if (Number.isNaN(d)) return 999;
  return Math.floor((asOf.getTime() - d) / 86_400_000);
}

function appTitle(app: ApplicationRecord): string {
  return `${app.role} @ ${app.company}`;
}

// Parameter is `unknown`, not `InboxData`: real callers assemble this from YAML parsed off
// disk without a validated static type, so the declared shape can't be trusted at the
// boundary (the "null-YAML-row" class, ADR 0017 FF-INPUT). Validated here, then treated as
// InboxData for the rest of the function — the per-row guards below intentionally re-check
// individual array elements the type now claims can't be malformed, because the real data
// source (YAML) makes no such guarantee; see the inline eslint-disable comments.
export function inbox(
  rawData: unknown,
  asOf?: string,
  opts?: {
    agingWindowDays?: number;
    interviewStaleDays?: number;
    appliedReviewDays?: number;
    appliedDecideDays?: number;
    fitScoreCutoffReviewSoon?: number;
    debriefNudgeDays?: number;
    drillCadenceDays?: number;
  },
): InboxReport {
  if (rawData === null || typeof rawData !== "object") {
    throw new TypeError("inbox: data must be an object");
  }
  const shape = rawData as Record<string, unknown>;
  if (!Array.isArray(shape["applications"])) {
    throw new TypeError("inbox: data.applications must be an array");
  }
  if (!Array.isArray(shape["queue"])) {
    throw new TypeError("inbox: data.queue must be an array");
  }
  if (!Array.isArray(shape["drifts"])) {
    throw new TypeError("inbox: data.drifts must be an array");
  }
  const data = rawData as InboxData;

  const ref = asOf ? new Date(asOf) : new Date();
  const decideNow: InboxItem[] = [];
  const reviewSoon: InboxItem[] = [];
  const fyi: InboxItem[] = [];

  const interviewStale = opts?.interviewStaleDays ?? 7;
  const appliedReview = opts?.appliedReviewDays ?? 14;
  const appliedDecide = opts?.appliedDecideDays ?? 21;

  for (const app of data.applications) {
    // A malformed row (null/non-object) is skipped, not thrown on — isolates one bad
    // row instead of crashing the whole report (matches the sync-db/CLI convention).
    // The type says this can't happen; real YAML-sourced data makes no such promise.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defends against malformed YAML rows the static type can't rule out
    if (app === null || typeof app !== "object") continue;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- app.dates may be absent on a malformed row
    const lastUpdate = app.dates?.last_update;
    const age = daysSince(lastUpdate, ref);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- app.dates may be absent on a malformed row
    const appliedAge = daysSince(app.dates?.applied, ref);

    if (app.status === "interview" || app.status === "offer") {
      if (age > interviewStale) {
        decideNow.push({
          kind: "application",
          id: app.id,
          title: appTitle(app),
          detail: `Status: ${app.status} — no update for ${age} days (stale, action needed)`,
        });
      } else {
        reviewSoon.push({
          kind: "application",
          id: app.id,
          title: appTitle(app),
          detail: `Status: ${app.status} — last update ${age} day(s) ago`,
        });
      }
    } else if (app.status === "applied") {
      if (age > appliedDecide || appliedAge > appliedDecide) {
        decideNow.push({
          kind: "application",
          id: app.id,
          title: appTitle(app),
          detail: `Applied ${appliedAge} days ago — no response; follow up or close`,
        });
      } else if (age > appliedReview || appliedAge > appliedReview) {
        reviewSoon.push({
          kind: "application",
          id: app.id,
          title: appTitle(app),
          detail: `Applied — stale after ${Math.max(age, appliedAge)} days; worth checking`,
        });
      } else {
        fyi.push({
          kind: "application",
          id: app.id,
          title: appTitle(app),
          detail: `Applied ${appliedAge} days ago`,
        });
      }
    } else if (app.status === "to_apply" || app.status === "promoted") {
      reviewSoon.push({
        kind: "application",
        id: app.id,
        title: appTitle(app),
        detail: `Status: ${app.status} — pending application`,
      });
    } else if (app.status === "rejected" || app.status === "withdrawn") {
      const closedAge = daysSince(lastUpdate, ref);
      if (closedAge <= 30) {
        fyi.push({
          kind: "application",
          id: app.id,
          title: appTitle(app),
          detail: `Status: ${app.status} ${closedAge} day(s) ago`,
        });
      }
    }
  }

  const agingWindow = opts?.agingWindowDays ?? DEFAULT_AGING_WINDOW_DAYS;
  let staleQueueCount = 0;

  for (const entry of data.queue) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defends against malformed YAML rows the static type can't rule out
    if (entry === null || typeof entry !== "object") continue;

    // Stale entries leave the default views (T5.5). The count is surfaced in a
    // one-line FYI below — never silent (never-silent principle).
    if (isStaleEntry(entry, agingWindow, ref)) {
      staleQueueCount++;
      continue;
    }

    const fitScore = entry.fit_score ?? null;
    const fitCutoff = opts?.fitScoreCutoffReviewSoon ?? 3.5;
    if (fitScore !== null && fitScore >= fitCutoff) {
      reviewSoon.push({
        kind: "queue",
        id: entry.id,
        title: `${entry.derived_role ?? "Role"} @ ${entry.company}`,
        detail: `High-fit queue entry (score: ${fitScore.toFixed(1)}) — not yet promoted`,
      });
    } else {
      fyi.push({
        kind: "queue",
        id: entry.id,
        title: `${entry.derived_role ?? "Role"} @ ${entry.company}`,
        detail: fitScore !== null
          ? `Queue entry (score: ${fitScore.toFixed(1)})`
          : "Queue entry (no fit score)",
      });
    }
  }

  // Never-silent: if any queue entries aged out, surface the count in FYI so
  // the owner knows they exist rather than assuming the queue is empty.
  if (staleQueueCount > 0) {
    fyi.push({
      kind: "queue",
      id: "queue-aged-out",
      title: `${staleQueueCount} aged-out queue ${staleQueueCount === 1 ? "entry" : "entries"}`,
      detail: `${staleQueueCount} queue ${staleQueueCount === 1 ? "entry has" : "entries have"} not been seen in a scan for more than ${agingWindow} day${agingWindow === 1 ? "" : "s"} and are hidden from the default view`,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defends against malformed YAML rows (null entries) the static type can't rule out
  const applicationIdSet = new Set(data.applications.flatMap((a) => (a !== null && typeof a === "object" ? [a.id] : [])));

  // Status map for the closed-application check: an attachment only counts as
  // "in play" if at least one attached application is not closed (rejected/withdrawn).
  const applicationStatusMap = new Map<string, string>();
  for (const a of data.applications) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defends against malformed YAML rows the static type can't rule out
    if (a !== null && typeof a === "object") {
      applicationStatusMap.set(a.id, a.status);
    }
  }

  for (const drift of data.drifts) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defends against malformed YAML rows the static type can't rule out
    if (drift === null || typeof drift !== "object") continue;
    if (drift.status === "active") {
      // Attached: at least one entry in drift.applications matches a record in data.applications.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- drift.applications may be absent on old/synthetic data the static type can't rule out
      const attachedIds = (drift.applications ?? []).filter((id) => applicationIdSet.has(id));
      if (attachedIds.length > 0) {
        // Attachment only counts as "in play" when at least one attached application is not
        // closed (status !== "rejected" && status !== "withdrawn"). If all attached
        // applications are closed, resurface the drift for triage (owner-decided rule 2026-07-11).
        const hasOpenApplication = attachedIds.some((id) => {
          const s = applicationStatusMap.get(id);
          return s !== "rejected" && s !== "withdrawn";
        });
        if (hasOpenApplication) {
          fyi.push({
            kind: "drift",
            id: drift.id,
            title: `Active drift: ${drift.id}`,
            detail: `Claim: "${drift.claim}" (${drift.org}) — active drift in play for ${attachedIds.join(", ")}`,
          });
        } else {
          // All attached applications closed → resurface for triage
          decideNow.push({
            kind: "drift",
            id: drift.id,
            title: `Active drift: ${drift.id}`,
            detail: `Claim: "${drift.claim}" (${drift.org}) — attached application(s) closed — retire or re-target this drift`,
          });
        }
      } else {
        // Unattached active drift (no application context) → decideNow
        decideNow.push({
          kind: "drift",
          id: drift.id,
          title: `Active drift: ${drift.id}`,
          detail: `Claim: "${drift.claim}" (${drift.org}) — unattached active drift`,
        });
      }
    } else {
      fyi.push({
        kind: "drift",
        id: drift.id,
        title: `Drift: ${drift.id}`,
        detail: `Status: ${drift.status} — ${drift.claim} (${drift.org})`,
      });
    }
  }

  // Debrief signals: interview applications with no debrief → reviewSoon.
  // Runs whenever the producer supplied a debriefs array — INCLUDING an empty
  // one: zero debriefs with interview-stage applications is the common early
  // state and exactly when this nudge matters (cf. the T3.2 empty-gaps bug
  // class). Only `undefined` (producer didn't wire debriefs) skips the check.
  if (Array.isArray(data.debriefs)) {
    // Same malformed-row filter as every other loop over data.applications above:
    // findUndebriefedInterviews has no null-guard of its own (it reads app.status
    // directly), so an unfiltered null/non-object row here would crash the whole
    // report instead of being isolated.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defends against malformed YAML rows the static type can't rule out
    const validApplications = data.applications.filter((a) => a !== null && typeof a === "object");
    const debriefNudge = opts?.debriefNudgeDays ?? 0;
    const undebriefed = findUndebriefedInterviews(validApplications, data.debriefs);
    for (const app of undebriefed) {
      // Suppress the nudge when the interview is older than debriefNudgeDays
      // (0 = always nudge — backward-compatible default).
      if (debriefNudge > 0) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- app.dates may be absent on malformed rows the static type can't rule out
        const interviewAge = daysSince(app.dates?.last_update, ref);
        if (interviewAge > debriefNudge) continue;
      }
      reviewSoon.push({
        kind: "coaching",
        id: app.id,
        title: appTitle(app),
        detail: "Interview stage but no debrief logged — capture it while fresh",
      });
    }
  }

  // Coaching signals: uncovered gaps → reviewSoon; next drill suggestion → fyi
  const coachingData = data.coaching;
  if (coachingData !== undefined && Array.isArray(coachingData.candidateGaps)) {
    for (const gap of coachingData.candidateGaps) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defends against malformed YAML rows the static type can't rule out
      if (gap === null || typeof gap !== "object") continue;
      if (gap.coverage === "uncovered") {
        const gapRef = gap.suggestedGapId ?? gap.topic;
        reviewSoon.push({
          kind: "coaching",
          id: gapRef,
          title: `Uncovered topic: ${gap.topic}`,
          detail:
            `No evidence found for "${gap.topic}" — consider adding a gap entry` +
            (gap.suggestedGapId ? ` (${gap.suggestedGapId})` : ""),
        });
      }
    }
    const nextDrill = coachingData.nextDrill;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defends against a malformed coaching payload the static type can't rule out
    if (nextDrill !== undefined && nextDrill !== null && Array.isArray(nextDrill.evidenceBundle)) {
      // Suppress the drill FYI when a drill was done within drillCadenceDays
      // (0 = no cadence suppression — backward-compatible default).
      const drillCadence = opts?.drillCadenceDays ?? 0;
      const lastDrillAt = coachingData.lastDrillAt;
      const drillTooRecent =
        drillCadence > 0 &&
        lastDrillAt !== undefined &&
        daysSince(lastDrillAt, ref) < drillCadence;
      if (!drillTooRecent) {
        fyi.push({
          kind: "coaching",
          id: nextDrill.topicId,
          title: `Next drill: ${nextDrill.topicId}`,
          detail: `Suggested ${nextDrill.kind} drill — ${nextDrill.evidenceBundle.length} evidence entries available`,
        });
      }
    }
  }

  // Content signals: digest freshness (5th loop)
  const contentData = data.content;
  if (contentData !== undefined) {
    if (contentData.lastDigestAt === undefined) {
      reviewSoon.push({
        kind: "content",
        id: "content-digest",
        title: "No content digest yet",
        detail: contentData.candidateCount !== undefined
          ? `No digest yet — ${contentData.candidateCount} candidate topic(s) available`
          : "No digest yet — run selfwright topics to generate",
      });
    } else {
      const age = daysSince(contentData.lastDigestAt, ref);
      if (age > 7) {
        reviewSoon.push({
          kind: "content",
          id: "content-digest",
          title: `Weekly content digest stale (${age} days)`,
          detail: `Last digest was ${age} days ago — run selfwright topics to refresh`,
        });
      } else {
        fyi.push({
          kind: "content",
          id: "content-digest",
          title: `Content digest current (${age} days old)`,
          detail: `Last digest was ${age} days ago`,
        });
      }
    }
  }

  return {
    decideNow,
    reviewSoon,
    fyi,
    asOf: ref.toISOString(),
  };
}
