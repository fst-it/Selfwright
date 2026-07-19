/**
 * Unit tests for notify payload builders.
 * Verifies that payloads contain ONLY ids/counts — no claim text, no company
 * names, no role titles. Mirrors the discipline enforced by shared-notify's
 * notifyCoaching tests (IDs-only push rule, ADR §8 / T3.2 convention).
 */
import { describe, it, expect } from "vitest";
import { buildScanNotifyPayload, buildInboxNotifyPayload } from "../notify-helpers.js";
import type { QueueEntry, InboxReport } from "@selfwright/core";

// ── buildScanNotifyPayload ────────────────────────────────────────────────────

describe("buildScanNotifyPayload", () => {
  it("returns null when there are no new entries", () => {
    expect(buildScanNotifyPayload([])).toBeNull();
  });

  it("includes the count and entry ID in the message", () => {
    const entries: QueueEntry[] = [
      { id: "SCAN-abc123", company: "Acme Corp", derived_role: "SWE", fit_score: 4.0 },
    ];
    const result = buildScanNotifyPayload(entries);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.message).toContain("1 new queue entries");
    expect(result.message).toContain("SCAN-abc123");
  });

  it("sets title to 'Scan complete'", () => {
    const entries: QueueEntry[] = [{ id: "SCAN-xyz", company: "Co" }];
    const result = buildScanNotifyPayload(entries);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.title).toBe("Scan complete");
  });

  it("includes all IDs when there are multiple entries", () => {
    const entries: QueueEntry[] = [
      { id: "SCAN-aaa", company: "Company A", derived_role: "Staff Eng", fit_score: 4.5 },
      { id: "SCAN-bbb", company: "Company B", derived_role: "Lead Eng", fit_score: 3.5 },
    ];
    const result = buildScanNotifyPayload(entries);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.message).toContain("2 new queue entries");
    expect(result.message).toContain("SCAN-aaa");
    expect(result.message).toContain("SCAN-bbb");
  });

  it("contains no company names in the message — IDs only", () => {
    const entries: QueueEntry[] = [
      { id: "SCAN-aaa", company: "SecretCo Ltd", derived_role: "Principal SWE", fit_score: 4.0 },
      { id: "SCAN-bbb", company: "OtherCorp AB", derived_role: "Staff Engineer", fit_score: 3.8 },
    ];
    const result = buildScanNotifyPayload(entries);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.message).not.toContain("SecretCo");
    expect(result.message).not.toContain("OtherCorp");
    expect(result.message).not.toContain("Principal SWE");
    expect(result.message).not.toContain("Staff Engineer");
  });
});

// ── buildInboxNotifyPayload ───────────────────────────────────────────────────

const emptyReport: InboxReport = {
  decideNow: [],
  reviewSoon: [],
  fyi: [],
  asOf: "2026-01-01T00:00:00.000Z",
};

describe("buildInboxNotifyPayload", () => {
  it("returns null when there are no decide-now or review-soon items", () => {
    expect(buildInboxNotifyPayload(emptyReport)).toBeNull();
  });

  it("returns null when only fyi items exist (not actionable enough to push)", () => {
    const report: InboxReport = {
      ...emptyReport,
      fyi: [{ kind: "queue", id: "SCAN-001", title: "Role @ Co", detail: "low fit" }],
    };
    expect(buildInboxNotifyPayload(report)).toBeNull();
  });

  it("includes tier counts and item IDs in the message", () => {
    const report: InboxReport = {
      decideNow: [{ kind: "drift", id: "DRIFT-001", title: "Active drift", detail: "..." }],
      reviewSoon: [{ kind: "application", id: "2026-01-acme-swe", title: "SWE @ Acme", detail: "..." }],
      fyi: [],
      asOf: "2026-01-01T00:00:00.000Z",
    };
    const result = buildInboxNotifyPayload(report);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.message).toContain("1 decide-now");
    expect(result.message).toContain("1 review-soon");
    expect(result.message).toContain("DRIFT-001");
    expect(result.message).toContain("2026-01-acme-swe");
  });

  it("sets title to 'Selfwright inbox'", () => {
    const report: InboxReport = {
      ...emptyReport,
      decideNow: [{ kind: "drift", id: "DRIFT-001", title: "...", detail: "..." }],
    };
    const result = buildInboxNotifyPayload(report);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.title).toBe("Selfwright inbox");
  });

  it("contains no claim text or company names in the message — IDs only", () => {
    const report: InboxReport = {
      decideNow: [
        {
          kind: "drift",
          id: "DRIFT-002",
          title: "Active drift: DRIFT-002",
          detail: 'Claim: "senior data architect" (TargetCo) — unattached active drift',
        },
      ],
      reviewSoon: [],
      fyi: [],
      asOf: "2026-01-01T00:00:00.000Z",
    };
    const result = buildInboxNotifyPayload(report);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.message).not.toContain("Claim:");
    expect(result.message).not.toContain("TargetCo");
    expect(result.message).not.toContain("senior data architect");
    expect(result.message).not.toContain("unattached");
    expect(result.message).toContain("DRIFT-002");
  });

  it("caps IDs at 10 even when there are more items", () => {
    const manyItems = Array.from({ length: 15 }, (_, i) => ({
      kind: "application" as const,
      id: `2026-01-company${String(i)}-swe`,
      title: "SWE",
      detail: "applied",
    }));
    const report: InboxReport = { ...emptyReport, decideNow: manyItems };
    const result = buildInboxNotifyPayload(report);
    expect(result).not.toBeNull();
    if (result === null) return;
    // Split the ID list portion (after " — ") and count entries
    const parts = result.message.split(" — ");
    const idSection = parts[1] ?? "";
    const idCount = idSection.split(", ").filter(Boolean).length;
    expect(idCount).toBeLessThanOrEqual(10);
  });

  it("deduplicates IDs that appear in both decide-now and review-soon", () => {
    const report: InboxReport = {
      decideNow: [{ kind: "drift", id: "DRIFT-001", title: "...", detail: "..." }],
      reviewSoon: [{ kind: "drift", id: "DRIFT-001", title: "...", detail: "..." }],
      fyi: [],
      asOf: "2026-01-01T00:00:00.000Z",
    };
    const result = buildInboxNotifyPayload(report);
    expect(result).not.toBeNull();
    if (result === null) return;
    // DRIFT-001 should appear exactly once in the message
    const occurrences = result.message.split("DRIFT-001").length - 1;
    expect(occurrences).toBe(1);
  });

  it("omits the ID list section when all item IDs are empty strings", () => {
    const report: InboxReport = {
      decideNow: [{ kind: "drift", id: "", title: "...", detail: "..." }],
      reviewSoon: [],
      fyi: [],
      asOf: "2026-01-01T00:00:00.000Z",
    };
    const result = buildInboxNotifyPayload(report);
    // decideCount is 1 so a payload is built; but empty id is filtered out
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.message).toContain("1 decide-now");
    // No " — " separator because there are no non-empty IDs
    expect(result.message).not.toContain(" — ");
  });
});
