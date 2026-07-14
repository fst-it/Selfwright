import { describe, it, expect } from "vitest";
import {
  EvidenceEntrySchema,
  EvidenceRegistrySchema,
  EvidenceTagSchema,
  tagLevels,
} from "../evidence.js";

const BASE_ENTRY = {
  id: "EVD-TEST-001",
  org: "Acme Corp",
  claim: "Built a scalable data platform.",
  tag: "hard" as const,
  keywords: ["data platform", "architecture"],
};

describe("EvidenceTagSchema", () => {
  it("accepts scalar hard/soft/claim", () => {
    expect(EvidenceTagSchema.parse("hard")).toBe("hard");
    expect(EvidenceTagSchema.parse("soft")).toBe("soft");
    expect(EvidenceTagSchema.parse("claim")).toBe("claim");
  });

  it("rejects unknown scalar", () => {
    expect(() => EvidenceTagSchema.parse("medium")).toThrow();
  });

  it("accepts single-facet map", () => {
    const result = EvidenceTagSchema.parse({ value: "hard" });
    expect(result).toEqual({ value: "hard" });
  });

  it("accepts multi-facet map", () => {
    const result = EvidenceTagSchema.parse({ direct: "hard", functional: "soft" });
    expect(result).toEqual({ direct: "hard", functional: "soft" });
  });

  it("accepts real-world facets from the registry", () => {
    expect(EvidenceTagSchema.parse({ build: "soft", metrics: "soft" })).toBeTruthy();
    expect(EvidenceTagSchema.parse({ value: "hard", lead: "soft" })).toBeTruthy();
  });

  it("rejects empty facet map", () => {
    expect(() => EvidenceTagSchema.parse({})).toThrow();
  });

  it("rejects map with invalid level value", () => {
    expect(() => EvidenceTagSchema.parse({ build: "medium" })).toThrow();
  });
});

describe("tagLevels()", () => {
  it("wraps a scalar in an array", () => {
    expect(tagLevels("hard")).toEqual(["hard"]);
    expect(tagLevels("soft")).toEqual(["soft"]);
  });

  it("returns deduplicated values from a facet map", () => {
    expect(tagLevels({ build: "soft", metrics: "soft" })).toEqual(["soft"]);
    expect(tagLevels({ direct: "hard", functional: "soft" }).sort()).toEqual(
      ["hard", "soft"],
    );
  });
});

describe("EvidenceEntrySchema", () => {
  it("parses a minimal valid entry", () => {
    const result = EvidenceEntrySchema.parse(BASE_ENTRY);
    expect(result.id).toBe("EVD-TEST-001");
    expect(result.keywords).toEqual(["data platform", "architecture"]);
    expect(result.detail).toBeUndefined();
  });

  it("applies default [] for keywords when absent", () => {
    const result = EvidenceEntrySchema.parse({ ...BASE_ENTRY, keywords: undefined });
    expect(result.keywords).toEqual([]);
  });

  it("accepts all optional fields", () => {
    const entry = {
      ...BASE_ENTRY,
      detail: "Detailed description here.",
      metric: "40% cost reduction",
      defense: "I can verify this with slides.",
      honesty: "The number was rounded.",
      retired: ["Replaced by EVD-TEST-002"],
      tech_stack: "Spark, Databricks",
      data_model_and_lifecycle: "Event sourcing model.",
      roadmap: "Migrated to lakehouse.",
      usage_note: "Use only for data roles.",
    };
    const result = EvidenceEntrySchema.parse(entry);
    expect(result.metric).toBe("40% cost reduction");
    expect(result.retired).toEqual(["Replaced by EVD-TEST-002"]);
  });

  it("accepts facet-map tag", () => {
    const result = EvidenceEntrySchema.parse({
      ...BASE_ENTRY,
      tag: { value: "hard", lead: "soft" },
    });
    expect(result.tag).toEqual({ value: "hard", lead: "soft" });
  });

  it("rejects invalid EVD-* id", () => {
    expect(() =>
      EvidenceEntrySchema.parse({ ...BASE_ENTRY, id: "EVD_BAD_001" }),
    ).toThrow();
    expect(() =>
      EvidenceEntrySchema.parse({ ...BASE_ENTRY, id: "bad-id" }),
    ).toThrow();
  });

  it("rejects unknown fields (strict mode)", () => {
    expect(() =>
      EvidenceEntrySchema.parse({ ...BASE_ENTRY, unknown_field: "oops" }),
    ).toThrow();
  });

  it("rejects empty org", () => {
    expect(() => EvidenceEntrySchema.parse({ ...BASE_ENTRY, org: "" })).toThrow();
  });

  it("rejects missing claim", () => {
    expect(() =>
      EvidenceEntrySchema.parse({ id: BASE_ENTRY.id, org: BASE_ENTRY.org, tag: BASE_ENTRY.tag, keywords: BASE_ENTRY.keywords }),
    ).toThrow();
  });
});

describe("EvidenceRegistrySchema", () => {
  it("parses an array of entries", () => {
    const result = EvidenceRegistrySchema.parse([BASE_ENTRY]);
    expect(result).toHaveLength(1);
  });

  it("accepts an empty array", () => {
    expect(EvidenceRegistrySchema.parse([])).toEqual([]);
  });
});
