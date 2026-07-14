import { describe, it, expect } from "vitest";
import { isValidApplicationEntry, isValidFitnessRecord, isEmbedConnectionError } from "./sync-db-helpers.js";

describe("isEmbedConnectionError", () => {
  it("returns true for Node native fetch connection failure (TypeError: fetch failed)", () => {
    expect(isEmbedConnectionError(new TypeError("fetch failed"))).toBe(true);
  });

  it("returns true for ECONNREFUSED in the message", () => {
    expect(isEmbedConnectionError(new Error("connect ECONNREFUSED 127.0.0.1:11434"))).toBe(true);
  });

  it("returns true for ECONNRESET in the message", () => {
    expect(isEmbedConnectionError(new Error("read ECONNRESET"))).toBe(true);
  });

  it("returns true for ETIMEDOUT in the message", () => {
    expect(isEmbedConnectionError(new Error("connect ETIMEDOUT"))).toBe(true);
  });

  it("returns true when the Error cause contains ECONNREFUSED (Node fetch wraps it)", () => {
    // The outer message must NOT trigger any early-return so we actually reach the cause check
    const cause = new Error("connect ECONNREFUSED 127.0.0.1:11434");
    const err = Object.assign(new Error("embed request failed"), { cause });
    expect(isEmbedConnectionError(err)).toBe(true);
  });

  it("returns false for an Ollama HTTP error (service up but returning error status)", () => {
    expect(
      isEmbedConnectionError(new Error("Ollama embeddings request failed: 503 Service Unavailable")),
    ).toBe(false);
  });

  it("returns false for a non-Error thrown value", () => {
    expect(isEmbedConnectionError("some string error")).toBe(false);
    expect(isEmbedConnectionError(null)).toBe(false);
    expect(isEmbedConnectionError(42)).toBe(false);
  });
});

describe("vector sync degrades gracefully when embed is unavailable", () => {
  // Type alias keeps the function signatures consistent with how sync-db.ts uses embed
  type EmbedFn = (text: string) => Promise<number[]>;

  it("skips vector sync and continues when embed throws a connection error", async () => {
    // Mirrors the try/catch pattern in sync-db.ts main(): if the embed call throws a
    // connection error, the vector section is skipped but execution continues to the
    // reporting tables (applications, fitness_runs).
    const synced: string[] = [];
    const warnings: string[] = [];

    // No `async` — returns a rejected Promise directly to avoid require-await lint error
    const embedDown: EmbedFn = () => Promise.reject(new TypeError("fetch failed"));

    try {
      await embedDown("test input");
      synced.push("evidence-vector");
    } catch (err) {
      if (isEmbedConnectionError(err)) {
        warnings.push("embed-unavailable");
      } else {
        throw err;
      }
    }

    // Reporting tables always run after the vector try/catch block
    synced.push("applications");
    synced.push("fitness_runs");

    expect(warnings).toContain("embed-unavailable");
    expect(synced).not.toContain("evidence-vector");
    expect(synced).toContain("applications");
    expect(synced).toContain("fitness_runs");
  });

  it("happy path: vector sync completes when embed is available", async () => {
    const synced: string[] = [];

    const embedOk: EmbedFn = () => Promise.resolve([0.1, 0.2, 0.3]);

    try {
      const vector = await embedOk("test input");
      expect(vector).toHaveLength(3);
      synced.push("evidence-vector");
    } catch (err) {
      if (!isEmbedConnectionError(err)) throw err;
    }

    synced.push("applications");

    expect(synced).toContain("evidence-vector");
    expect(synced).toContain("applications");
  });

  it("re-throws non-connection errors from the vector sync (e.g. auth/logic errors)", async () => {
    const embedBadAuth: EmbedFn = () =>
      Promise.reject(new Error("Ollama embeddings request failed: 401 Unauthorized"));

    await expect(async () => {
      try {
        await embedBadAuth("test");
      } catch (err) {
        if (isEmbedConnectionError(err)) {
          // would log and skip, but this error is NOT a connection error
        } else {
          throw err;
        }
      }
    }).rejects.toThrow("401 Unauthorized");
  });
});

describe("isValidApplicationEntry", () => {
  it("returns false for null — the blank YAML list item case", () => {
    expect(isValidApplicationEntry(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isValidApplicationEntry(undefined)).toBe(false);
  });

  it("returns false for a string", () => {
    expect(isValidApplicationEntry("foo")).toBe(false);
  });

  it("returns false for a number", () => {
    expect(isValidApplicationEntry(0)).toBe(false);
  });

  it("returns true for a plain object", () => {
    expect(isValidApplicationEntry({ id: "APP-001" })).toBe(true);
  });

  it("returns true for an empty object", () => {
    expect(isValidApplicationEntry({})).toBe(true);
  });
});

describe("isValidFitnessRecord", () => {
  it("returns false for null", () => {
    expect(isValidFitnessRecord(null)).toBe(false);
  });

  it("returns false for a primitive", () => {
    expect(isValidFitnessRecord(42)).toBe(false);
  });

  it("returns false when results key is missing — e.g. {runAt:'...'} truncated write", () => {
    expect(isValidFitnessRecord({ runAt: "2026-01-01T00:00:00.000Z" })).toBe(false);
  });

  it("returns false when results is not an array", () => {
    expect(
      isValidFitnessRecord({ runAt: "2026-01-01T00:00:00.000Z", results: "bad" }),
    ).toBe(false);
  });

  it("returns true when results is an empty array", () => {
    expect(isValidFitnessRecord({ runAt: "2026-01-01T00:00:00.000Z", results: [] })).toBe(true);
  });

  it("returns true when results contains entries", () => {
    expect(
      isValidFitnessRecord({
        runAt: "2026-01-01T00:00:00.000Z",
        results: [{ name: "f1", passed: true, skipped: false }],
      }),
    ).toBe(true);
  });
});
