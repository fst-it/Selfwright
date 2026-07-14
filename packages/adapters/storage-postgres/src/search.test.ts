import { describe, it, expect, vi } from "vitest";
import { searchByEmbedding } from "./search.js";
import type { SearchTable } from "./search.js";
import type { Sql } from "./types.js";

describe("searchByEmbedding", () => {
  it("throws for a table not in the allowlist, without touching the connection", async () => {
    const mockSql = vi.fn() as unknown as Sql;
    await expect(
      searchByEmbedding(mockSql, "not_a_real_table" as SearchTable, [0.1], 5),
    ).rejects.toThrow('unknown table "not_a_real_table"');
    expect(mockSql).not.toHaveBeenCalled();
  });
});
