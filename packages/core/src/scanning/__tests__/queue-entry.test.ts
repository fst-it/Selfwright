import { describe, expect, it } from "vitest";
import { toQueueEntry } from "../queue-entry.js";
import type { ScanResult } from "../types.js";

function scanResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    posting: {
      url: "https://boards-api.greenhouse.io/v1/boards/acme/jobs/123",
      title: "Enterprise Architect",
      company: "Acme",
      location: "Amsterdam, NL",
      source: "greenhouse",
      fetchedAt: "2026-07-03T00:00:00.000Z",
    },
    liveness: { status: "live", reason: "visible apply control detected" },
    archetype: "enterprise-architect",
    fitScore: 3.2,
    grade: "C",
    ...overrides,
  };
}

describe("toQueueEntry", () => {
  it("maps a scan result to the existing QueueEntry shape", () => {
    const entry = toQueueEntry(scanResult());
    expect(entry.company).toBe("Acme");
    expect(entry.derived_role).toBe("Enterprise Architect");
    expect(entry.fit_score).toBe(3.2);
    expect(typeof entry.id).toBe("string");
    expect(entry.id.length).toBeGreaterThan(0);
  });

  it("derives a stable id from the same URL every time", () => {
    const a = toQueueEntry(scanResult());
    const b = toQueueEntry(scanResult());
    expect(a.id).toBe(b.id);
  });

  it("derives different ids for different URLs", () => {
    const a = toQueueEntry(scanResult());
    const b = toQueueEntry(
      scanResult({
        posting: {
          url: "https://boards-api.greenhouse.io/v1/boards/beta/jobs/456",
          title: "Director of Architecture",
          company: "Beta",
          location: "London, UK",
          source: "greenhouse",
          fetchedAt: "2026-07-03T00:00:00.000Z",
        },
      }),
    );
    expect(a.id).not.toBe(b.id);
  });

  it("maps null archetype and null fit score through unchanged", () => {
    const entry = toQueueEntry(scanResult({ archetype: null, fitScore: 0 }));
    expect(entry.fit_score).toBe(0);
  });
});
