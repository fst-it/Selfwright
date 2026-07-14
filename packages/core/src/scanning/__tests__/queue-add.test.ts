import { describe, it, expect } from "vitest";
import { buildManualEntry } from "../queue-add.js";
import type { ManualAddInput } from "../queue-add.js";
import type { SeenEntry } from "../types.js";
import type { QueueEntry } from "../types.js";

const NOW = "2026-07-12T10:00:00.000Z";

function input(overrides: Partial<ManualAddInput> = {}): ManualAddInput {
  return {
    url: "https://www.linkedin.com/jobs/view/123456789",
    company: "Acme Corp",
    role: "Enterprise Architect",
    now: NOW,
    ...overrides,
  };
}

function seen(url: string): SeenEntry {
  return { url, firstSeen: NOW, source: "manual", status: "live" };
}

function queueEntry(company: string, role: string, id = "SCAN-abc"): QueueEntry {
  return { id, company, derived_role: role };
}

describe("buildManualEntry", () => {
  it("builds a MAN- prefixed entry on a clean slate", () => {
    const result = buildManualEntry(input(), [], [], []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.id).toMatch(/^MAN-/);
    expect(result.entry.company).toBe("Acme Corp");
    expect(result.entry.derived_role).toBe("Enterprise Architect");
    expect(result.entry.source).toBe("manual");
    expect(result.seenEntry.url).toBe(input().url);
    expect(result.seenEntry.source).toBe("manual");
    expect(result.seenEntry.status).toBe("live");
  });

  it("derives a stable id from the URL (deterministic hash)", () => {
    const a = buildManualEntry(input(), [], [], []);
    const b = buildManualEntry(input(), [], [], []);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.entry.id).toBe(b.entry.id);
  });

  it("derives different ids for different URLs", () => {
    const a = buildManualEntry(input(), [], [], []);
    const b = buildManualEntry(
      input({ url: "https://www.linkedin.com/jobs/view/999" }),
      [],
      [],
      [],
    );
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.entry.id).not.toBe(b.entry.id);
  });

  it("includes fit_score when provided", () => {
    const result = buildManualEntry(input({ fitScore: 3.5 }), [], [], []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.fit_score).toBe(3.5);
  });

  it("omits fit_score when not provided", () => {
    const result = buildManualEntry(input(), [], [], []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("fit_score" in result.entry).toBe(false);
  });

  it("refuses with url-seen when URL is already in the seen ledger", () => {
    const result = buildManualEntry(
      input(),
      [seen("https://www.linkedin.com/jobs/view/123456789")],
      [],
      [],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("url-seen");
  });

  it("refuses with queue-duplicate on exact company+role match in existing queue", () => {
    const result = buildManualEntry(
      input(),
      [],
      [queueEntry("Acme Corp", "Enterprise Architect", "SCAN-existing")],
      [],
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "queue-duplicate") return;
    expect(result.existingId).toBe("SCAN-existing");
    expect(result.existingCompany).toBe("Acme Corp");
  });

  it("refuses with queue-duplicate when role is a fuzzy match (seniority stripping)", () => {
    // "Senior Enterprise Architect" fuzzy-matches "Enterprise Architect"
    const result = buildManualEntry(
      input({ role: "Senior Enterprise Architect" }),
      [],
      [queueEntry("Acme Corp", "Enterprise Architect", "SCAN-existing")],
      [],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("queue-duplicate");
  });

  it("allows when company differs even if role is the same", () => {
    const result = buildManualEntry(
      input({ company: "Beta Corp" }),
      [],
      [queueEntry("Acme Corp", "Enterprise Architect")],
      [],
    );
    expect(result.ok).toBe(true);
  });

  it("is case-insensitive on company match", () => {
    const result = buildManualEntry(
      input({ company: "ACME CORP" }),
      [],
      [queueEntry("acme corp", "Enterprise Architect", "SCAN-existing")],
      [],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("queue-duplicate");
  });

  it("refuses with application-duplicate when already applied to same company+role", () => {
    const result = buildManualEntry(
      input(),
      [],
      [],
      [{ id: "APP-001", company: "Acme Corp", role: "Enterprise Architect" }],
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "application-duplicate") return;
    expect(result.existingId).toBe("APP-001");
  });

  it("checks url-seen before queue-duplicate (precedence)", () => {
    const result = buildManualEntry(
      input(),
      [seen("https://www.linkedin.com/jobs/view/123456789")],
      [queueEntry("Acme Corp", "Enterprise Architect")],
      [],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("url-seen");
  });

  it("checks queue-duplicate before application-duplicate (precedence)", () => {
    const result = buildManualEntry(
      input(),
      [],
      [queueEntry("Acme Corp", "Enterprise Architect", "SCAN-q")],
      [{ id: "APP-001", company: "Acme Corp", role: "Enterprise Architect" }],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("queue-duplicate");
  });
});
