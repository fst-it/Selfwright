import { describe, expect, it } from "vitest";
import { promoteQueueEntry } from "../queue-promote.js";
import type { QueueEntry } from "../../scanning/index.js";

function entry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    id: "SCAN-abc123",
    company: "Acme Corp",
    derived_role: "Staff Engineer",
    fit_score: 4.2,
    ...overrides,
  };
}

describe("promoteQueueEntry", () => {
  it("maps company/role/fit_score straight over and sets status to evaluating", () => {
    const result = promoteQueueEntry(entry(), "2026-07-13");
    expect(result.id).toBe("SCAN-abc123");
    expect(result.company).toBe("Acme Corp");
    expect(result.role).toBe("Staff Engineer");
    expect(result.status).toBe("evaluating");
    expect(result.fit_score).toBe(4.2);
  });

  it("sets dates.promoted and dates.last_update to today", () => {
    const result = promoteQueueEntry(entry(), "2026-07-13");
    expect(result.dates.promoted).toBe("2026-07-13");
    expect(result.dates.last_update).toBe("2026-07-13");
  });

  it("derives dates.discovered from queuedAt (truncated to a date)", () => {
    const result = promoteQueueEntry(
      entry({ queuedAt: "2026-06-01T10:00:00.000Z" }),
      "2026-07-13",
    );
    expect(result.dates.discovered).toBe("2026-06-01");
  });

  it("falls back to today for dates.discovered on a legacy entry with no queuedAt", () => {
    // entry() intentionally omits queuedAt entirely (not undefined —
    // exactOptionalPropertyTypes forbids that) to model a legacy entry.
    const result = promoteQueueEntry(entry(), "2026-07-13");
    expect(result.dates.discovered).toBe("2026-07-13");
  });

  it("falls back to 'Unknown role' when derived_role is absent", () => {
    const minimal: QueueEntry = { id: "Q-1", company: "Acme Corp" };
    const result = promoteQueueEntry(minimal, "2026-07-13");
    expect(result.role).toBe("Unknown role");
  });

  it("defaults fit_score to null when absent", () => {
    const minimal: QueueEntry = { id: "Q-1", company: "Acme Corp" };
    const result = promoteQueueEntry(minimal, "2026-07-13");
    expect(result.fit_score).toBeNull();
  });

  it("does not set channel, ats_score, or notes", () => {
    const result = promoteQueueEntry(entry(), "2026-07-13");
    expect(result.channel).toBeUndefined();
    expect(result.ats_score).toBeUndefined();
    expect(result.notes).toBeUndefined();
  });
});
