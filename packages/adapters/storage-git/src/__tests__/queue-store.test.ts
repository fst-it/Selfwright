import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { readQueueRaw, writeQueueRaw, removeQueueEntry, QUEUE_REL } from "../queue-store.js";

const SYNTHETIC = {
  queue: [
    { id: "Q-001", company: "Gamma Inc", derived_role: "Senior Engineer", fit_score: 3.9 },
    { id: "Q-002", company: "Delta LLC", derived_role: "Staff Engineer", fit_score: 4.1 },
  ],
};

describe("removeQueueEntry", () => {
  it("removes the matching entry and returns it", () => {
    const raw = stringifyYaml(SYNTHETIC);
    const result = removeQueueEntry(raw, "Q-001");
    if (!result.ok) throw new Error("expected ok");
    expect(result.entry.id).toBe("Q-001");
    expect(result.entry.company).toBe("Gamma Inc");

    const parsed = parseYaml(result.raw) as { queue: Array<{ id: string }> };
    expect(parsed.queue).toHaveLength(1);
    expect(parsed.queue[0]?.id).toBe("Q-002");
  });

  it("returns NOT_FOUND for an unknown id", () => {
    const raw = stringifyYaml(SYNTHETIC);
    const result = removeQueueEntry(raw, "NO-SUCH-ID");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("NOT_FOUND");
  });

  it("returns NOT_FOUND when raw is null (queue.yml absent)", () => {
    const result = removeQueueEntry(null, "Q-001");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("NOT_FOUND");
  });

  it("returns PARSE_ERROR for unparseable YAML", () => {
    const result = removeQueueEntry("::: not yaml [", "Q-001");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("PARSE_ERROR");
  });

  it("returns PARSE_ERROR when the YAML root has no queue array", () => {
    const result = removeQueueEntry("just: a-map\n", "Q-001");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("PARSE_ERROR");
  });

  it("removing the last entry leaves an empty queue array (not undefined)", () => {
    const raw = stringifyYaml({ queue: [{ id: "Q-001", company: "Solo Co" }] });
    const result = removeQueueEntry(raw, "Q-001");
    if (!result.ok) throw new Error("expected ok");
    const parsed = parseYaml(result.raw) as { queue: unknown[] };
    expect(parsed.queue).toEqual([]);
  });
});

describe("readQueueRaw / writeQueueRaw", () => {
  it("round-trips through the data dir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sw-queue-store-"));
    mkdirSync(join(dir, "pipeline"), { recursive: true });
    try {
      expect(await readQueueRaw(dir)).toBeNull();
      const raw = stringifyYaml(SYNTHETIC);
      await writeQueueRaw(dir, raw);
      expect(await readQueueRaw(dir)).toBe(raw);
      expect(QUEUE_REL).toContain("queue.yml");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
