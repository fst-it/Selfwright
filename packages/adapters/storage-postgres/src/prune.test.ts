import { describe, it, expect, vi } from "vitest";
import { pruneEvidence, pruneArchetypes } from "./prune.js";
import type { Sql } from "./types.js";

describe("pruneEvidence", () => {
  it("deletes rows not in currentIds and returns the deleted count", async () => {
    const mockResult = Object.assign([], { count: 2 });
    const mockArray = vi.fn((arr: unknown[]) => arr);
    const mockSql = Object.assign(vi.fn().mockResolvedValue(mockResult), {
      array: mockArray,
    }) as unknown as Sql;

    const count = await pruneEvidence(mockSql, ["id-1", "id-2", "id-3"]);

    expect(count).toBe(2);
    expect(mockSql).toHaveBeenCalledOnce();
    expect(mockArray).toHaveBeenCalledWith(["id-1", "id-2", "id-3"]);
  });

  it("passes an empty array when currentIds is empty (deletes all rows)", async () => {
    const mockResult = Object.assign([], { count: 5 });
    const mockArray = vi.fn((arr: unknown[]) => arr);
    const mockSql = Object.assign(vi.fn().mockResolvedValue(mockResult), {
      array: mockArray,
    }) as unknown as Sql;

    const count = await pruneEvidence(mockSql, []);

    expect(count).toBe(5);
    expect(mockArray).toHaveBeenCalledWith([]);
  });
});

describe("pruneArchetypes", () => {
  it("deletes rows not in currentIds and returns the deleted count", async () => {
    const mockResult = Object.assign([], { count: 1 });
    const mockArray = vi.fn((arr: unknown[]) => arr);
    const mockSql = Object.assign(vi.fn().mockResolvedValue(mockResult), {
      array: mockArray,
    }) as unknown as Sql;

    const count = await pruneArchetypes(mockSql, ["arch-1"]);

    expect(count).toBe(1);
    expect(mockArray).toHaveBeenCalledWith(["arch-1"]);
  });
});
