// ── Coaching: debrief schema + derived functions ──────────────────────────────
import { describe, it, expect } from "vitest";
import {
  DebriefSchema,
  DebriefsFileSchema,
  deriveGapHintsFromDebriefs,
  findUndebriefedInterviews,
} from "../debrief.js";
import type { Debrief } from "../debrief.js";
import type { EvidenceEntry } from "../../truth/schemas/index.js";

// Minimal registry fixture (shared relevance primitive — empty is valid)
const EMPTY_REGISTRY: EvidenceEntry[] = [];

// ── Schema ────────────────────────────────────────────────────────────────────

describe("DebriefSchema", () => {
  it("parses a minimal valid debrief", () => {
    const result = DebriefSchema.parse({ application_id: "APP-SYNTH-01", date: "2026-07-10" });
    expect(result.application_id).toBe("APP-SYNTH-01");
    expect(result.date).toBe("2026-07-10");
    expect(result.wobbled).toBeUndefined();
    expect(result.asked).toBeUndefined();
  });

  it("rejects an invalid date format", () => {
    expect(() => DebriefSchema.parse({ application_id: "APP-01", date: "2026/07/10" })).toThrow();
    expect(() => DebriefSchema.parse({ application_id: "APP-01", date: "10-07-2026" })).toThrow();
  });

  it("rejects a missing application_id", () => {
    expect(() => DebriefSchema.parse({ date: "2026-07-10" })).toThrow();
  });

  it("parses all optional fields", () => {
    const debrief = DebriefSchema.parse({
      application_id: "APP-SYNTH-01",
      date: "2026-07-10",
      round: "HR screen",
      asked: ["system design", "kafka"],
      wobbled: ["kafka"],
      went_well: ["system design"],
      notes: "Good rapport.",
    });
    expect(debrief.round).toBe("HR screen");
    expect(debrief.wobbled).toEqual(["kafka"]);
    expect(debrief.went_well).toEqual(["system design"]);
    expect(debrief.notes).toBe("Good rapport.");
  });
});

describe("DebriefsFileSchema", () => {
  it("parses a file with one entry", () => {
    const result = DebriefsFileSchema.parse({
      debriefs: [{ application_id: "APP-SYNTH-01", date: "2026-07-10" }],
    });
    expect(result.debriefs).toHaveLength(1);
  });

  it("parses an empty debriefs list", () => {
    const result = DebriefsFileSchema.parse({ debriefs: [] });
    expect(result.debriefs).toHaveLength(0);
  });
});

// ── deriveGapHintsFromDebriefs ────────────────────────────────────────────────

describe("deriveGapHintsFromDebriefs", () => {
  const debriefs: Debrief[] = [
    {
      application_id: "APP-SYNTH-01",
      date: "2026-07-10",
      wobbled: ["kafka", "event-driven architecture"],
      asked: ["system design", "kafka"],
      went_well: ["system design"],
    },
    {
      application_id: "APP-SYNTH-02",
      date: "2026-07-11",
      wobbled: ["kafka", "avro schemas"],
    },
  ];

  it("returns empty array for empty debriefs", () => {
    expect(deriveGapHintsFromDebriefs([], EMPTY_REGISTRY)).toHaveLength(0);
  });

  it("counts kafka: 2 wobbled + 1 unanswered asked = 3", () => {
    const hints = deriveGapHintsFromDebriefs(debriefs, EMPTY_REGISTRY);
    const kafka = hints.find((h) => h.topic.toLowerCase() === "kafka");
    expect(kafka).toBeDefined();
    if (kafka === undefined) return;
    expect(kafka.count).toBe(3);
    expect(kafka.sourceApplicationIds).toContain("APP-SYNTH-01");
    expect(kafka.sourceApplicationIds).toContain("APP-SYNTH-02");
  });

  it("excludes topics that went well (system design was in went_well)", () => {
    const hints = deriveGapHintsFromDebriefs(debriefs, EMPTY_REGISTRY);
    const found = hints.find((h) => h.topic.toLowerCase() === "system design");
    expect(found).toBeUndefined();
  });

  it("includes uncovered asked topics not in went_well", () => {
    // kafka was asked AND wobbled — already counted above; this checks the
    // unanswered-asked path without overlap.
    const d: Debrief[] = [
      {
        application_id: "APP-SYNTH-03",
        date: "2026-07-01",
        asked: ["data mesh", "domain events"],
        went_well: ["domain events"],
      },
    ];
    const hints = deriveGapHintsFromDebriefs(d, EMPTY_REGISTRY);
    const mesh = hints.find((h) => h.topic === "data mesh");
    expect(mesh).toBeDefined();
    if (mesh === undefined) return;
    expect(mesh.count).toBe(1);
    const domainEvents = hints.find((h) => h.topic === "domain events");
    expect(domainEvents).toBeUndefined();
  });

  it("sorts by count descending, then topic ascending", () => {
    const hints = deriveGapHintsFromDebriefs(debriefs, EMPTY_REGISTRY);
    // kafka(3) > avro schemas(1) == event-driven architecture(1)
    const first = hints[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(first.topic.toLowerCase()).toBe("kafka");
    for (let i = 0; i < hints.length - 1; i++) {
      const curr = hints[i];
      const next = hints[i + 1];
      if (curr === undefined || next === undefined) continue;
      expect(curr.count).toBeGreaterThanOrEqual(next.count);
    }
  });

  it("groups topics case-insensitively", () => {
    const d: Debrief[] = [
      { application_id: "APP-A", date: "2026-01-01", wobbled: ["Kafka"] },
      { application_id: "APP-B", date: "2026-01-02", wobbled: ["kafka"] },
    ];
    const hints = deriveGapHintsFromDebriefs(d, EMPTY_REGISTRY);
    expect(hints).toHaveLength(1);
    const first = hints[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(first.count).toBe(2);
    expect(first.sourceApplicationIds).toContain("APP-A");
    expect(first.sourceApplicationIds).toContain("APP-B");
  });

  it("sourceApplicationIds are sorted and deduplicated per topic", () => {
    const d: Debrief[] = [
      {
        application_id: "APP-Z",
        date: "2026-01-01",
        wobbled: ["kafka"],
        asked: ["kafka"],
        went_well: [],
      },
    ];
    // kafka contributed twice from the same application
    const hints = deriveGapHintsFromDebriefs(d, EMPTY_REGISTRY);
    const kafka = hints.find((h) => h.topic.toLowerCase() === "kafka");
    expect(kafka).toBeDefined();
    if (kafka === undefined) return;
    expect(kafka.sourceApplicationIds).toEqual(["APP-Z"]); // deduplicated
    expect(kafka.count).toBe(2); // count is NOT deduplicated (2 contributions)
  });
});

// ── findUndebriefedInterviews ─────────────────────────────────────────────────

describe("findUndebriefedInterviews", () => {
  const applications = [
    { id: "APP-SYNTH-01", status: "interview", dates: { last_update: "2026-07-01" } },
    { id: "APP-SYNTH-02", status: "interview", dates: { last_update: "2026-07-05" } },
    { id: "APP-SYNTH-03", status: "applied", dates: { last_update: "2026-07-01" } },
    { id: "APP-SYNTH-04", status: "interview", dates: { last_update: "2026-07-01" } },
  ];

  it("returns all interview apps when no debriefs exist", () => {
    const undebriefed = findUndebriefedInterviews(applications, []);
    const ids = undebriefed.map((a) => a.id);
    expect(ids).toContain("APP-SYNTH-01");
    expect(ids).toContain("APP-SYNTH-02");
    expect(ids).toContain("APP-SYNTH-04");
  });

  it("excludes non-interview applications", () => {
    const undebriefed = findUndebriefedInterviews(applications, []);
    expect(undebriefed.map((a) => a.id)).not.toContain("APP-SYNTH-03");
  });

  it("excludes apps with a debrief on the same date as last_update", () => {
    const debriefs: Debrief[] = [
      { application_id: "APP-SYNTH-01", date: "2026-07-01" },
    ];
    const undebriefed = findUndebriefedInterviews(applications, debriefs);
    expect(undebriefed.map((a) => a.id)).not.toContain("APP-SYNTH-01");
  });

  it("excludes apps with a debrief after last_update", () => {
    const debriefs: Debrief[] = [
      { application_id: "APP-SYNTH-01", date: "2026-07-03" }, // after 2026-07-01
    ];
    const undebriefed = findUndebriefedInterviews(applications, debriefs);
    expect(undebriefed.map((a) => a.id)).not.toContain("APP-SYNTH-01");
  });

  it("includes apps with a debrief strictly before last_update", () => {
    const debriefs: Debrief[] = [
      { application_id: "APP-SYNTH-02", date: "2026-07-04" }, // before 2026-07-05
    ];
    const undebriefed = findUndebriefedInterviews(applications, debriefs);
    expect(undebriefed.map((a) => a.id)).toContain("APP-SYNTH-02");
  });

  it("handles app with no dates.last_update: any debrief counts", () => {
    const appsNoDate = [
      { id: "APP-SYNTH-05", status: "interview" },
    ];
    // No debrief → undebriefed
    expect(findUndebriefedInterviews(appsNoDate, [])).toHaveLength(1);
    // Has debrief → debriefed (any debrief counts when no baseline date)
    const debriefs: Debrief[] = [
      { application_id: "APP-SYNTH-05", date: "2026-07-01" },
    ];
    expect(findUndebriefedInterviews(appsNoDate, debriefs)).toHaveLength(0);
  });
});
