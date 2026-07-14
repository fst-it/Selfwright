import { describe, expect, it } from "vitest";
import { inbox } from "../inbox.js";
import type { InboxData, ApplicationRecord, QueueEntry } from "../types.js";
import type { DriftEntry } from "../../truth/schemas/index.js";

// Fixed reference date for deterministic tests
const AS_OF = "2026-06-29T12:00:00.000Z";

function daysAgo(n: number): string {
  const d = new Date(AS_OF);
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

const DRIFT_FIXTURE: DriftEntry = {
  id: "DRIFT-TEST-001",
  org: "TestCo",
  claim: "Led platform architecture",
  deviates_from: {
    evidence_ids: ["EVD-TEST-001"],
    kind: "reframe",
  },
  tag: "hard",
  keywords: ["architecture"],
  confidence: {
    score: 3.0,
    band: "safe",
    factors: {
      verifiability_backstop: 0.3,
      distance_from_truth: 0.3,
      blast_radius: 0.3,
      external_checkability: 0.3,
      cross_app_consistency: 0.3,
      specificity_detectability: 0.3,
    },
    rubric_score: 3.0,
    ai_adjustment: 0,
    ai_reasoning: "test",
  },
  risks: [{ risk: "Overstated", severity: "low", mitigation: "Qualify with context" }],
  status: "active",
  applications: [],
};

const EMPTY_DATA: InboxData = { applications: [], queue: [], drifts: [] };

describe("inbox service", () => {
  it("empty data → all three tiers empty", () => {
    const report = inbox(EMPTY_DATA, AS_OF);
    expect(report.decideNow).toHaveLength(0);
    expect(report.reviewSoon).toHaveLength(0);
    expect(report.fyi).toHaveLength(0);
    expect(report.asOf).toBeDefined();
  });

  it("applied application, last_update 25 days ago → decideNow", () => {
    const app: ApplicationRecord = {
      id: "app-1",
      company: "Acme",
      role: "Architect",
      status: "applied",
      dates: { applied: daysAgo(25), last_update: daysAgo(25) },
    };
    const report = inbox({ ...EMPTY_DATA, applications: [app] }, AS_OF);
    expect(report.decideNow.some((i) => i.id === "app-1")).toBe(true);
  });

  it("applied application, last_update 15 days ago → reviewSoon", () => {
    const app: ApplicationRecord = {
      id: "app-2",
      company: "Acme",
      role: "Architect",
      status: "applied",
      dates: { applied: daysAgo(15), last_update: daysAgo(15) },
    };
    const report = inbox({ ...EMPTY_DATA, applications: [app] }, AS_OF);
    expect(report.reviewSoon.some((i) => i.id === "app-2")).toBe(true);
  });

  it("applied application, last_update 3 days ago → fyi", () => {
    const app: ApplicationRecord = {
      id: "app-3",
      company: "Acme",
      role: "Architect",
      status: "applied",
      dates: { applied: daysAgo(3), last_update: daysAgo(3) },
    };
    const report = inbox({ ...EMPTY_DATA, applications: [app] }, AS_OF);
    expect(report.fyi.some((i) => i.id === "app-3")).toBe(true);
  });

  it("queue entry with fit_score 4.0 → reviewSoon", () => {
    const entry: QueueEntry = {
      id: "q-1",
      company: "BigCo",
      derived_role: "Principal Architect",
      fit_score: 4.0,
    };
    const report = inbox({ ...EMPTY_DATA, queue: [entry] }, AS_OF);
    expect(report.reviewSoon.some((i) => i.id === "q-1")).toBe(true);
  });

  it("queue entry with fit_score 2.0 → fyi", () => {
    const entry: QueueEntry = {
      id: "q-2",
      company: "SmallCo",
      fit_score: 2.0,
    };
    const report = inbox({ ...EMPTY_DATA, queue: [entry] }, AS_OF);
    expect(report.fyi.some((i) => i.id === "q-2")).toBe(true);
  });

  it("active drift with empty applications → decideNow", () => {
    const report = inbox({ ...EMPTY_DATA, drifts: [DRIFT_FIXTURE] }, AS_OF);
    expect(report.decideNow.some((i) => i.id === "DRIFT-TEST-001")).toBe(true);
  });

  it("asOf parameter overrides date comparison", () => {
    const app: ApplicationRecord = {
      id: "app-time",
      company: "TimeCo",
      role: "Architect",
      status: "applied",
      dates: {
        applied: "2026-06-01T00:00:00.000Z",
        last_update: "2026-06-01T00:00:00.000Z",
      },
    };
    // As of June 5 (4 days later) → not stale
    const earlyReport = inbox({ ...EMPTY_DATA, applications: [app] }, "2026-06-05T00:00:00.000Z");
    expect(earlyReport.decideNow.some((i) => i.id === "app-time")).toBe(false);

    // As of July 1 (30 days later) → stale, decideNow
    const lateReport = inbox({ ...EMPTY_DATA, applications: [app] }, "2026-07-01T00:00:00.000Z");
    expect(lateReport.decideNow.some((i) => i.id === "app-time")).toBe(true);
  });

  it("interview status with stale update > 7 days → decideNow", () => {
    const app: ApplicationRecord = {
      id: "app-int",
      company: "Corp",
      role: "Lead",
      status: "interview",
      dates: { last_update: daysAgo(10) },
    };
    const report = inbox({ ...EMPTY_DATA, applications: [app] }, AS_OF);
    expect(report.decideNow.some((i) => i.id === "app-int")).toBe(true);
  });

  it("to_apply status → reviewSoon", () => {
    const app: ApplicationRecord = {
      id: "app-ta",
      company: "Corp",
      role: "Lead",
      status: "to_apply",
      dates: {},
    };
    const report = inbox({ ...EMPTY_DATA, applications: [app] }, AS_OF);
    expect(report.reviewSoon.some((i) => i.id === "app-ta")).toBe(true);
  });

  it("rejected within 30 days → fyi", () => {
    const app: ApplicationRecord = {
      id: "app-rej",
      company: "Corp",
      role: "Lead",
      status: "rejected",
      dates: { last_update: daysAgo(5) },
    };
    const report = inbox({ ...EMPTY_DATA, applications: [app] }, AS_OF);
    expect(report.fyi.some((i) => i.id === "app-rej")).toBe(true);
  });
});

describe("inbox service — drift attachment", () => {
  const APP_FIXTURE: ApplicationRecord = {
    id: "app-test-attached-001",
    company: "TargetCo",
    role: "Principal Engineer",
    status: "applied",
    dates: { applied: daysAgo(5), last_update: daysAgo(5) },
  };

  it("active drift whose applications list matches an application record → fyi not decideNow", () => {
    const attachedDrift: DriftEntry = {
      ...DRIFT_FIXTURE,
      id: "DRIFT-ATTACHED-001",
      applications: [APP_FIXTURE.id],
    };
    const report = inbox(
      { ...EMPTY_DATA, applications: [APP_FIXTURE], drifts: [attachedDrift] },
      AS_OF,
    );
    expect(report.fyi.some((i) => i.id === "DRIFT-ATTACHED-001")).toBe(true);
    expect(report.decideNow.some((i) => i.id === "DRIFT-ATTACHED-001")).toBe(false);
  });

  it("active drift whose applications id is not present in data.applications → decideNow", () => {
    const orphanDrift: DriftEntry = {
      ...DRIFT_FIXTURE,
      id: "DRIFT-ORPHAN-001",
      applications: ["app-does-not-exist-999"],
    };
    const report = inbox({ ...EMPTY_DATA, drifts: [orphanDrift] }, AS_OF);
    expect(report.decideNow.some((i) => i.id === "DRIFT-ORPHAN-001")).toBe(true);
    expect(report.fyi.some((i) => i.id === "DRIFT-ORPHAN-001")).toBe(false);
  });

  it("active drift with no applications field (simulated absent field) → decideNow", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { applications: _omit, ...noAppFields } = DRIFT_FIXTURE;
    const noFieldDrift = {
      ...noAppFields,
      id: "DRIFT-NOFIELD-001",
    } as unknown as DriftEntry;
    const report = inbox({ ...EMPTY_DATA, drifts: [noFieldDrift] }, AS_OF);
    expect(report.decideNow.some((i) => i.id === "DRIFT-NOFIELD-001")).toBe(true);
    expect(report.fyi.some((i) => i.id === "DRIFT-NOFIELD-001")).toBe(false);
  });

  it("retired drift → fyi regardless of applications", () => {
    const retiredDrift: DriftEntry = {
      ...DRIFT_FIXTURE,
      id: "DRIFT-RETIRED-001",
      status: "retired",
      applications: [],
    };
    const report = inbox({ ...EMPTY_DATA, drifts: [retiredDrift] }, AS_OF);
    expect(report.fyi.some((i) => i.id === "DRIFT-RETIRED-001")).toBe(true);
    expect(report.decideNow.some((i) => i.id === "DRIFT-RETIRED-001")).toBe(false);
  });
});

describe("inbox service — drift lifecycle (closed-application rule, 2026-07-11)", () => {
  const OPEN_APP: ApplicationRecord = {
    id: "app-open-001",
    company: "TargetCo",
    role: "Principal Engineer",
    status: "applied",
    dates: { applied: daysAgo(5), last_update: daysAgo(5) },
  };
  const REJECTED_APP: ApplicationRecord = {
    id: "app-rej-001",
    company: "TargetCo",
    role: "Principal Engineer",
    status: "rejected",
    dates: { last_update: daysAgo(2) },
  };
  const WITHDRAWN_APP: ApplicationRecord = {
    id: "app-wdn-001",
    company: "TargetCo",
    role: "Principal Engineer",
    status: "withdrawn",
    dates: { last_update: daysAgo(3) },
  };

  it("attached drift with at least one open application → fyi (unchanged behaviour)", () => {
    const drift: DriftEntry = { ...DRIFT_FIXTURE, id: "DRIFT-OPEN-001", applications: [OPEN_APP.id] };
    const report = inbox({ ...EMPTY_DATA, applications: [OPEN_APP], drifts: [drift] }, AS_OF);
    expect(report.fyi.some((i) => i.id === "DRIFT-OPEN-001")).toBe(true);
    expect(report.decideNow.some((i) => i.id === "DRIFT-OPEN-001")).toBe(false);
  });

  it("attached drift where all applications are rejected → decideNow with closed wording", () => {
    const drift: DriftEntry = { ...DRIFT_FIXTURE, id: "DRIFT-ALLCLOSED-001", applications: [REJECTED_APP.id] };
    const report = inbox({ ...EMPTY_DATA, applications: [REJECTED_APP], drifts: [drift] }, AS_OF);
    const item = report.decideNow.find((i) => i.id === "DRIFT-ALLCLOSED-001");
    expect(item).toBeDefined();
    expect(item?.detail).toContain("attached application(s) closed");
    expect(item?.detail).toContain("retire or re-target");
    expect(report.fyi.some((i) => i.id === "DRIFT-ALLCLOSED-001")).toBe(false);
  });

  it("attached drift where all applications are withdrawn → decideNow with closed wording", () => {
    const drift: DriftEntry = { ...DRIFT_FIXTURE, id: "DRIFT-WDN-001", applications: [WITHDRAWN_APP.id] };
    const report = inbox({ ...EMPTY_DATA, applications: [WITHDRAWN_APP], drifts: [drift] }, AS_OF);
    const item = report.decideNow.find((i) => i.id === "DRIFT-WDN-001");
    expect(item).toBeDefined();
    expect(item?.detail).toContain("attached application(s) closed");
    expect(report.fyi.some((i) => i.id === "DRIFT-WDN-001")).toBe(false);
  });

  it("attached drift with mix of open + closed applications → fyi (open one keeps it in play)", () => {
    const drift: DriftEntry = {
      ...DRIFT_FIXTURE,
      id: "DRIFT-MIX-001",
      applications: [OPEN_APP.id, REJECTED_APP.id],
    };
    const report = inbox(
      { ...EMPTY_DATA, applications: [OPEN_APP, REJECTED_APP], drifts: [drift] },
      AS_OF,
    );
    expect(report.fyi.some((i) => i.id === "DRIFT-MIX-001")).toBe(true);
    expect(report.decideNow.some((i) => i.id === "DRIFT-MIX-001")).toBe(false);
  });

  it("unattached active drift (no applications) → decideNow unchanged", () => {
    const drift: DriftEntry = { ...DRIFT_FIXTURE, id: "DRIFT-UNATTACHED-LC-001", applications: [] };
    const report = inbox({ ...EMPTY_DATA, drifts: [drift] }, AS_OF);
    expect(report.decideNow.some((i) => i.id === "DRIFT-UNATTACHED-LC-001")).toBe(true);
    expect(report.fyi.some((i) => i.id === "DRIFT-UNATTACHED-LC-001")).toBe(false);
  });
});

describe("inbox service — content tier", () => {
  it("content field absent → no content items", () => {
    const report = inbox(EMPTY_DATA, AS_OF);
    const contentItems = [...report.decideNow, ...report.reviewSoon, ...report.fyi].filter(
      (i) => i.kind === "content",
    );
    expect(contentItems).toHaveLength(0);
  });

  it("content present with no lastDigestAt → reviewSoon 'No content digest yet'", () => {
    const report = inbox({ ...EMPTY_DATA, content: {} }, AS_OF);
    expect(
      report.reviewSoon.some((i) => i.id === "content-digest" && i.title === "No content digest yet"),
    ).toBe(true);
  });

  it("content present with no lastDigestAt and candidateCount → reviewSoon mentioning candidateCount", () => {
    const report = inbox({ ...EMPTY_DATA, content: { candidateCount: 5 } }, AS_OF);
    const item = report.reviewSoon.find((i) => i.id === "content-digest");
    expect(item).toBeDefined();
    expect(item?.detail).toContain("5");
  });

  it("content present with stale lastDigestAt (>7 days) → reviewSoon stale", () => {
    const report = inbox({ ...EMPTY_DATA, content: { lastDigestAt: daysAgo(10) } }, AS_OF);
    const item = report.reviewSoon.find((i) => i.id === "content-digest");
    expect(item).toBeDefined();
    expect(item?.title).toMatch(/stale/);
  });

  it("content present with recent lastDigestAt (<=7 days) → fyi current", () => {
    const report = inbox({ ...EMPTY_DATA, content: { lastDigestAt: daysAgo(3) } }, AS_OF);
    const item = report.fyi.find((i) => i.id === "content-digest");
    expect(item).toBeDefined();
    expect(item?.title).toMatch(/current/);
  });

  // ADR 0017 FF-INPUT: the null-YAML-row class must reject with a typed error, never an
  // unhandled null-deref ("Cannot read properties of null/undefined").
  describe("malformed input (FF-INPUT)", () => {
    it("rejects a null data argument with a typed TypeError", () => {
      expect(() => inbox(null, AS_OF)).toThrow(TypeError);
    });

    it("rejects data with a non-array applications field", () => {
      expect(() =>
        inbox({ ...EMPTY_DATA, applications: "not-an-array" }, AS_OF),
      ).toThrow(TypeError);
    });

    it("rejects data with a non-array queue field", () => {
      expect(() =>
        inbox({ ...EMPTY_DATA, queue: null }, AS_OF),
      ).toThrow(TypeError);
    });

    it("rejects data with a non-array drifts field", () => {
      expect(() =>
        inbox({ ...EMPTY_DATA, drifts: undefined }, AS_OF),
      ).toThrow(TypeError);
    });

    it("skips a malformed (null) application row instead of crashing", () => {
      const good: ApplicationRecord = {
        id: "app-good",
        company: "Acme",
        role: "Architect",
        status: "applied",
        dates: { applied: daysAgo(3), last_update: daysAgo(3) },
      };
      const applications = [good, null as unknown as ApplicationRecord];
      expect(() => inbox({ ...EMPTY_DATA, applications }, AS_OF)).not.toThrow();
      const report = inbox({ ...EMPTY_DATA, applications }, AS_OF);
      expect(report.fyi.some((i) => i.id === "app-good")).toBe(true);
    });

    it("skips a malformed (null) queue entry instead of crashing", () => {
      const queue = [null as unknown as QueueEntry];
      expect(() => inbox({ ...EMPTY_DATA, queue }, AS_OF)).not.toThrow();
    });

    it("skips a malformed (null) drift entry instead of crashing", () => {
      const drifts = [null as unknown as DriftEntry];
      expect(() => inbox({ ...EMPTY_DATA, drifts }, AS_OF)).not.toThrow();
    });

    it("tolerates a malformed application row missing the dates object", () => {
      const applications = [{ id: "a1", company: "Acme", role: "Eng", status: "applied" } as ApplicationRecord];
      expect(() => inbox({ ...EMPTY_DATA, applications }, AS_OF)).not.toThrow();
    });

    it("skips a malformed (null) application row instead of crashing when debriefs are present (the debrief-nudge path)", () => {
      const interviewApp: ApplicationRecord = {
        id: "app-int-001",
        company: "TargetCo",
        role: "Principal Engineer",
        status: "interview",
        dates: { applied: daysAgo(20), last_update: daysAgo(4) },
      };
      const applications = [interviewApp, null as unknown as ApplicationRecord];
      expect(() =>
        inbox({ ...EMPTY_DATA, applications, debriefs: [] }, AS_OF),
      ).not.toThrow();
      const report = inbox({ ...EMPTY_DATA, applications, debriefs: [] }, AS_OF);
      expect(report.reviewSoon.some((i) => i.id === "app-int-001" && i.kind === "coaching")).toBe(true);
    });
  });
});

describe("inbox service — debrief signals", () => {
  const INTERVIEW_APP: ApplicationRecord = {
    id: "app-int-001",
    company: "TargetCo",
    role: "Principal Engineer",
    status: "interview",
    dates: { applied: daysAgo(20), last_update: daysAgo(4) },
  };

  it("interview app with EMPTY debriefs array → reviewSoon nudge (the common early state)", () => {
    const report = inbox(
      { ...EMPTY_DATA, applications: [INTERVIEW_APP], debriefs: [] },
      AS_OF,
    );
    const item = report.reviewSoon.find((i) => i.id === "app-int-001" && i.kind === "coaching");
    expect(item).toBeDefined();
    expect(item?.detail).toContain("no debrief logged");
  });

  it("interview app with debriefs undefined (producer didn't wire them) → no nudge", () => {
    const report = inbox({ ...EMPTY_DATA, applications: [INTERVIEW_APP] }, AS_OF);
    expect(report.reviewSoon.some((i) => i.id === "app-int-001" && i.kind === "coaching")).toBe(
      false,
    );
  });

  it("interview app with a debrief dated after last_update → no nudge", () => {
    const report = inbox(
      {
        ...EMPTY_DATA,
        applications: [INTERVIEW_APP],
        debriefs: [{ application_id: "app-int-001", date: daysAgo(2).slice(0, 10) }],
      },
      AS_OF,
    );
    expect(report.reviewSoon.some((i) => i.id === "app-int-001" && i.kind === "coaching")).toBe(
      false,
    );
  });
});

// ── queue aging (T5.5) ────────────────────────────────────────────────────────

describe("inbox service — queue aging", () => {
  function staleEntry(id: string, daysOld: number): QueueEntry {
    const d = new Date(AS_OF);
    d.setDate(d.getDate() - daysOld);
    return {
      id,
      company: "StaleCo",
      derived_role: "Stale Role",
      fit_score: 4.0,
      queuedAt: d.toISOString(),
    };
  }

  function freshEntry(id: string, daysOld: number): QueueEntry {
    const d = new Date(AS_OF);
    d.setDate(d.getDate() - daysOld);
    return {
      id,
      company: "FreshCo",
      derived_role: "Fresh Role",
      fit_score: 4.0,
      queuedAt: d.toISOString(),
    };
  }

  it("stale queue entry (>30 days) excluded from reviewSoon and fyi", () => {
    const stale = staleEntry("q-stale", 31);
    const report = inbox({ ...EMPTY_DATA, queue: [stale] }, AS_OF);
    const all = [...report.decideNow, ...report.reviewSoon, ...report.fyi];
    expect(all.some((i) => i.id === "q-stale")).toBe(false);
  });

  it("stale entry count surfaced as a one-line FYI item (never-silent)", () => {
    const stale = staleEntry("q-stale-2", 31);
    const report = inbox({ ...EMPTY_DATA, queue: [stale] }, AS_OF);
    const ageItem = report.fyi.find((i) => i.id === "queue-aged-out");
    expect(ageItem).toBeDefined();
    expect(ageItem?.title).toMatch(/aged.out/i);
    expect(ageItem?.detail).toContain("30 day");
  });

  it("fresh queue entry (<=30 days) appears in default view", () => {
    const fresh = freshEntry("q-fresh", 29);
    const report = inbox({ ...EMPTY_DATA, queue: [fresh] }, AS_OF);
    expect(report.reviewSoon.some((i) => i.id === "q-fresh")).toBe(true);
  });

  it("mix of stale and fresh: fresh appears, stale count in FYI", () => {
    const fresh = freshEntry("q-fresh-mix", 5);
    const stale = staleEntry("q-stale-mix", 35);
    const report = inbox({ ...EMPTY_DATA, queue: [fresh, stale] }, AS_OF);
    expect(report.reviewSoon.some((i) => i.id === "q-fresh-mix")).toBe(true);
    expect(report.fyi.some((i) => i.id === "q-stale-mix")).toBe(false);
    const ageItem = report.fyi.find((i) => i.id === "queue-aged-out");
    expect(ageItem).toBeDefined();
    expect(ageItem?.detail).toContain("1 queue entry has");
  });

  it("no stale entries → no aged-out FYI item", () => {
    const fresh = freshEntry("q-fresh-only", 10);
    const report = inbox({ ...EMPTY_DATA, queue: [fresh] }, AS_OF);
    expect(report.fyi.some((i) => i.id === "queue-aged-out")).toBe(false);
  });

  it("legacy entry (no queuedAt/lastSeenAt) is not stale — backward compat", () => {
    const legacy: QueueEntry = { id: "q-legacy", company: "OldCo", fit_score: 4.0 };
    const report = inbox({ ...EMPTY_DATA, queue: [legacy] }, AS_OF);
    expect(report.reviewSoon.some((i) => i.id === "q-legacy")).toBe(true);
    expect(report.fyi.some((i) => i.id === "queue-aged-out")).toBe(false);
  });

  it("custom agingWindowDays honored: 10-day window makes 11-day entry stale", () => {
    const entry = staleEntry("q-custom", 11); // 11 days old
    const report = inbox({ ...EMPTY_DATA, queue: [entry] }, AS_OF, { agingWindowDays: 10 });
    expect(report.fyi.some((i) => i.id === "queue-aged-out")).toBe(true);
    // Detail should mention the custom window
    const ageItem = report.fyi.find((i) => i.id === "queue-aged-out");
    expect(ageItem?.detail).toContain("10 day");
  });

  it("custom agingWindowDays 10: 9-day-old entry is still active", () => {
    const d = new Date(AS_OF);
    d.setDate(d.getDate() - 9);
    const entry: QueueEntry = {
      id: "q-custom-fresh",
      company: "FreshCo",
      fit_score: 4.0,
      queuedAt: d.toISOString(),
    };
    const report = inbox({ ...EMPTY_DATA, queue: [entry] }, AS_OF, { agingWindowDays: 10 });
    expect(report.reviewSoon.some((i) => i.id === "q-custom-fresh")).toBe(true);
    expect(report.fyi.some((i) => i.id === "queue-aged-out")).toBe(false);
  });

  it("lastSeenAt refresh prevents staleness: queuedAt 60d ago, lastSeenAt 1d ago → active", () => {
    const now = new Date(AS_OF);
    const d60 = new Date(now); d60.setDate(d60.getDate() - 60);
    const d1 = new Date(now); d1.setDate(d1.getDate() - 1);
    const entry: QueueEntry = {
      id: "q-refreshed",
      company: "ActiveCo",
      fit_score: 4.0,
      queuedAt: d60.toISOString(),
      lastSeenAt: d1.toISOString(),
    };
    const report = inbox({ ...EMPTY_DATA, queue: [entry] }, AS_OF);
    expect(report.reviewSoon.some((i) => i.id === "q-refreshed")).toBe(true);
    expect(report.fyi.some((i) => i.id === "queue-aged-out")).toBe(false);
  });
});
