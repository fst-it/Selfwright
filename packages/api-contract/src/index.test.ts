import { describe, it, expect } from "vitest";
import {
  hasControlChars,
  ApiErrorEnvelopeSchema,
  MetaResponseSchema,
  ApplicationRecordSchema,
  ApplicationsListResponseSchema,
  StatusUpdateRequestSchema,
  StatusUpdateResponseSchema,
  QueueEntrySchema,
  QueueResponseSchema,
  PromoteQueueEntryRequestSchema,
  PromoteQueueEntryResponseSchema,
  DismissQueueEntryResponseSchema,
  InboxItemSchema,
  InboxResponseSchema,
  DrillSelectionSchema,
  CoachingResponseSchema,
  DebriefCreateRequestSchema,
  DebriefCreateResponseSchema,
  ContentResponseSchema,
  ReportingResponseSchema,
  OverviewResponseSchema,
  SettingsContractSchema,
  SettingsUpdateResponseSchema,
} from "./index.js";

describe("hasControlChars", () => {
  it("returns false for a clean string", () => {
    expect(hasControlChars("hello world")).toBe(false);
  });
  it("returns true for a string containing a control char (BEL)", () => {
    expect(hasControlChars(`bad${String.fromCharCode(7)}note`)).toBe(true);
  });
  it("returns true for DEL (0x7F)", () => {
    expect(hasControlChars(`bad${String.fromCharCode(0x7f)}note`)).toBe(true);
  });
});

describe("ApiErrorEnvelopeSchema", () => {
  it("accepts a valid error envelope", () => {
    const result = ApiErrorEnvelopeSchema.safeParse({
      error: { code: "VALIDATION_ERROR", message: "bad input" },
    });
    expect(result.success).toBe(true);
  });
  it("rejects an unknown error code", () => {
    const result = ApiErrorEnvelopeSchema.safeParse({
      error: { code: "TOTALLY_MADE_UP", message: "x" },
    });
    expect(result.success).toBe(false);
  });
});

describe("MetaResponseSchema", () => {
  it("accepts a valid meta response with a csrf token", () => {
    const result = MetaResponseSchema.safeParse({
      contractVersion: "1.0.0",
      platformVersion: "0.6.0",
      status: "ok",
      csrfToken: "abc123",
    });
    expect(result.success).toBe(true);
  });
  it("accepts null csrfToken (unauthenticated)", () => {
    const result = MetaResponseSchema.safeParse({
      contractVersion: "1.0.0",
      platformVersion: "0.6.0",
      status: "ok",
      csrfToken: null,
    });
    expect(result.success).toBe(true);
  });
  it("rejects a non-'ok' status", () => {
    const result = MetaResponseSchema.safeParse({
      contractVersion: "1.0.0",
      platformVersion: "0.6.0",
      status: "degraded",
      csrfToken: null,
    });
    expect(result.success).toBe(false);
  });
});

const SYNTHETIC_APPLICATION = {
  id: "APP-001",
  company: "Acme Corp",
  role: "Principal Engineer",
  status: "applied",
  dates: { applied: "2026-06-01", last_update: "2026-06-01" },
  fit_score: 4.2,
  notes: "synthetic fixture",
};

describe("ApplicationRecordSchema / ApplicationsListResponseSchema", () => {
  it("accepts a valid application record", () => {
    expect(ApplicationRecordSchema.safeParse(SYNTHETIC_APPLICATION).success).toBe(true);
  });
  it("rejects a record missing required fields", () => {
    expect(ApplicationRecordSchema.safeParse({ id: "APP-001" }).success).toBe(false);
  });
  it("accepts a list response with a null contentHash", () => {
    const result = ApplicationsListResponseSchema.safeParse({
      applications: [SYNTHETIC_APPLICATION],
      contentHash: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("StatusUpdateRequestSchema / StatusUpdateResponseSchema", () => {
  it("accepts a valid status update", () => {
    const result = StatusUpdateRequestSchema.safeParse({
      status: "interview",
      note: "moved to onsite",
      contentHash: "deadbeef",
    });
    expect(result.success).toBe(true);
  });
  it("rejects a status outside the fixed vocabulary", () => {
    const result = StatusUpdateRequestSchema.safeParse({
      status: "bogus_status",
      contentHash: "deadbeef",
    });
    expect(result.success).toBe(false);
  });
  it("rejects a note over 500 chars", () => {
    const result = StatusUpdateRequestSchema.safeParse({
      status: "interview",
      note: "x".repeat(501),
      contentHash: "deadbeef",
    });
    expect(result.success).toBe(false);
  });
  it("rejects a note containing a control character", () => {
    const result = StatusUpdateRequestSchema.safeParse({
      status: "interview",
      note: `bad${String.fromCharCode(7)}note`,
      contentHash: "deadbeef",
    });
    expect(result.success).toBe(false);
  });
  it("accepts a valid status update response", () => {
    const result = StatusUpdateResponseSchema.safeParse({ application: SYNTHETIC_APPLICATION });
    expect(result.success).toBe(true);
  });
});

describe("QueueEntrySchema / QueueResponseSchema", () => {
  it("accepts a minimal queue entry", () => {
    expect(QueueEntrySchema.safeParse({ id: "Q-1", company: "Acme" }).success).toBe(true);
  });
  it("accepts a full queue response", () => {
    const result = QueueResponseSchema.safeParse({
      active: [{ id: "Q-1", company: "Acme", fit_score: 4.1 }],
      staleCount: 2,
      agingWindowDays: 30,
      contentHash: "abc123",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a null contentHash (queue.yml absent)", () => {
    const result = QueueResponseSchema.safeParse({
      active: [],
      staleCount: 0,
      agingWindowDays: 30,
      contentHash: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("PromoteQueueEntryRequestSchema (optimistic-lock guard)", () => {
  it("accepts a non-empty contentHash", () => {
    expect(PromoteQueueEntryRequestSchema.safeParse({ contentHash: "abc123" }).success).toBe(true);
  });

  it("rejects an empty contentHash", () => {
    expect(PromoteQueueEntryRequestSchema.safeParse({ contentHash: "" }).success).toBe(false);
  });

  it("rejects a missing contentHash", () => {
    expect(PromoteQueueEntryRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("PromoteQueueEntryResponseSchema / DismissQueueEntryResponseSchema (ADR 0024)", () => {
  it("accepts a valid promote response (reuses ApplicationRecordSchema)", () => {
    const result = PromoteQueueEntryResponseSchema.safeParse({
      application: {
        id: "Q-1",
        company: "Acme",
        role: "Engineer",
        status: "evaluating",
        dates: { discovered: "2026-07-01", promoted: "2026-07-13", last_update: "2026-07-13" },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a promote response with a malformed application", () => {
    const result = PromoteQueueEntryResponseSchema.safeParse({ application: { id: "Q-1" } });
    expect(result.success).toBe(false);
  });

  it("accepts a valid dismiss response", () => {
    const result = DismissQueueEntryResponseSchema.safeParse({
      dismissed: { id: "Q-1", company: "Acme", fit_score: 3.9 },
    });
    expect(result.success).toBe(true);
  });
});

describe("InboxItemSchema / InboxResponseSchema", () => {
  it("accepts a valid inbox item for each kind", () => {
    for (const kind of ["application", "queue", "drift", "coaching", "content"] as const) {
      const result = InboxItemSchema.safeParse({ kind, id: "X-1", title: "t", detail: "d" });
      expect(result.success).toBe(true);
    }
  });

  it("rejects an inbox item with an unknown kind", () => {
    const result = InboxItemSchema.safeParse({ kind: "bogus", id: "X-1", title: "t", detail: "d" });
    expect(result.success).toBe(false);
  });

  it("accepts a full three-tier inbox response", () => {
    const result = InboxResponseSchema.safeParse({
      asOf: "2026-07-13T00:00:00.000Z",
      decideNow: [{ kind: "application", id: "A-1", title: "t", detail: "d" }],
      reviewSoon: [],
      fyi: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("DrillSelectionSchema / CoachingResponseSchema", () => {
  it("accepts a drill selection without a gap (kind !== 'gap')", () => {
    const result = DrillSelectionSchema.safeParse({
      topicId: "system-design",
      kind: "strength",
      evidenceBundle: [{ id: "EVD-1", score: 0.9, tag: "hard", why: "matched keywords" }],
    });
    expect(result.success).toBe(true);
  });
  it("accepts a coaching response with a null nextDrill", () => {
    const result = CoachingResponseSchema.safeParse({
      debriefs: [],
      hasArchetype: false,
      nextDrill: null,
      drillFiles: [],
      prepPacks: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("DebriefCreateRequestSchema / DebriefCreateResponseSchema", () => {
  const base = { application_id: "APP-002", date: "2026-06-15" };

  it("accepts a minimal valid debrief", () => {
    expect(DebriefCreateRequestSchema.safeParse(base).success).toBe(true);
  });
  it("accepts a full debrief with list fields", () => {
    const result = DebriefCreateRequestSchema.safeParse({
      ...base,
      round: "hiring manager",
      asked: ["system design", "leadership"],
      wobbled: ["system design"],
      went_well: ["leadership"],
      notes: "went okay",
    });
    expect(result.success).toBe(true);
  });
  it("rejects a malformed date", () => {
    expect(DebriefCreateRequestSchema.safeParse({ ...base, date: "06/15/2026" }).success).toBe(false);
  });
  it("rejects more than 20 asked items", () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `topic ${String(i)}`);
    expect(DebriefCreateRequestSchema.safeParse({ ...base, asked: tooMany }).success).toBe(false);
  });
  it("rejects a list item containing a control character", () => {
    const result = DebriefCreateRequestSchema.safeParse({
      ...base,
      wobbled: [`bad${String.fromCharCode(7)}topic`],
    });
    expect(result.success).toBe(false);
  });
  it("rejects notes containing a control character", () => {
    const result = DebriefCreateRequestSchema.safeParse({
      ...base,
      notes: `bad${String.fromCharCode(7)}note`,
    });
    expect(result.success).toBe(false);
  });
  it("accepts a valid debrief create response", () => {
    const result = DebriefCreateResponseSchema.safeParse({ debrief: base });
    expect(result.success).toBe(true);
  });
});

describe("ContentResponseSchema", () => {
  it("accepts a response with no digests", () => {
    expect(ContentResponseSchema.safeParse({ digests: [], latestDigest: null }).success).toBe(true);
  });
  it("accepts a response with a latest digest", () => {
    const result = ContentResponseSchema.safeParse({
      digests: ["2026-07-01-week.md"],
      latestDigest: { file: "2026-07-01-week.md", content: "# Week digest" },
    });
    expect(result.success).toBe(true);
  });
});

describe("ReportingResponseSchema / OverviewResponseSchema", () => {
  it("accepts a valid reporting response", () => {
    const result = ReportingResponseSchema.safeParse({
      northStar: { submitted: 5, interviews: 2, ratePerTen: 4 },
      channelOutcomes: [{ channel: "referral", submitted: 3, interviews: 1, rate: 0.33 }],
      byStatus: { applied: 3, interview: 2 },
      fitnessHistory: [{ runAt: "2026-07-01T00:00:00.000Z", passed: 27, failed: 0, skipped: 5 }],
    });
    expect(result.success).toBe(true);
  });
  it("accepts a valid overview response", () => {
    const result = OverviewResponseSchema.safeParse({
      northStar: { submitted: 5, interviews: 2, ratePerTen: 4 },
      fitnessHistory: [],
      inbox: { decideNow: 1, reviewSoon: 2, fyi: 3 },
      digestCount: 4,
    });
    expect(result.success).toBe(true);
  });
});

describe("SettingsContractSchema / SettingsUpdateResponseSchema", () => {
  it("accepts an empty settings document", () => {
    expect(SettingsContractSchema.safeParse({}).success).toBe(true);
  });
  it("accepts a valid queue.aging_window_days", () => {
    expect(SettingsContractSchema.safeParse({ queue: { aging_window_days: 14 } }).success).toBe(true);
  });
  it("rejects a non-positive aging_window_days", () => {
    expect(SettingsContractSchema.safeParse({ queue: { aging_window_days: 0 } }).success).toBe(false);
  });
  it("accepts a valid settings update response", () => {
    const result = SettingsUpdateResponseSchema.safeParse({ settings: { queue: { aging_window_days: 30 } } });
    expect(result.success).toBe(true);
  });
});
