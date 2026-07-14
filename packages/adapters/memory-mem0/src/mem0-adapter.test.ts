import { describe, it, expect, vi, beforeEach } from "vitest";
import { Mem0Adapter } from "./mem0-adapter.js";

describe("Mem0Adapter", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  describe("add", () => {
    it("posts content and metadata to {baseUrl}/memories", async () => {
      const entry = {
        id: "mem-1",
        content: "Prefers batched PRs over one-per-task",
        metadata: { kind: "feedback" },
        createdAt: "2026-07-07T00:00:00.000Z",
      };
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(entry) });

      const adapter = new Mem0Adapter("http://localhost:8050");
      const result = await adapter.add("Prefers batched PRs over one-per-task", { kind: "feedback" });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:8050/memories");
      const body = JSON.parse(options.body as string) as Record<string, unknown>;
      expect(body["content"]).toBe("Prefers batched PRs over one-per-task");
      expect(body["metadata"]).toEqual({ kind: "feedback" });
      expect(result).toEqual(entry);
    });

    it("throws a descriptive error on non-OK HTTP response", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503, statusText: "Service Unavailable" });

      const adapter = new Mem0Adapter("http://localhost:8050");
      await expect(adapter.add("some content")).rejects.toThrow("503");
    });
  });

  describe("search", () => {
    it("posts query and top_k to {baseUrl}/search and returns results", async () => {
      const results = [
        {
          entry: {
            id: "mem-1",
            content: "Prefers batched PRs",
            createdAt: "2026-07-07T00:00:00.000Z",
          },
          score: 0.92,
        },
      ];
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ results }) });

      const adapter = new Mem0Adapter("http://localhost:8050");
      const result = await adapter.search("PR granularity", 5);

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:8050/search");
      const body = JSON.parse(options.body as string) as Record<string, unknown>;
      expect(body["query"]).toBe("PR granularity");
      expect(body["top_k"]).toBe(5);
      expect(result).toEqual(results);
    });
  });

  describe("list", () => {
    it("posts an optional filter to {baseUrl}/memories/list and returns entries", async () => {
      const entries = [
        { id: "mem-1", content: "Prefers batched PRs", createdAt: "2026-07-07T00:00:00.000Z" },
      ];
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ results: entries }) });

      const adapter = new Mem0Adapter("http://localhost:8050");
      const result = await adapter.list({ kind: "feedback" });

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:8050/memories/list");
      const body = JSON.parse(options.body as string) as Record<string, unknown>;
      expect(body["filter"]).toEqual({ kind: "feedback" });
      expect(result).toEqual(entries);
    });
  });

  describe("auth header", () => {
    it("sends Authorization: Bearer header on every request when a token is provided", async () => {
      const entry = {
        id: "mem-1",
        content: "test",
        createdAt: "2026-07-08T00:00:00.000Z",
      };
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(entry) });

      const adapter = new Mem0Adapter("http://localhost:8050", "secret-token");
      await adapter.add("test");
      await adapter.search("query");
      await adapter.list();

      for (const call of mockFetch.mock.calls) {
        const [, options] = call as [string, RequestInit];
        const headers = options.headers as Record<string, string>;
        expect(headers["Authorization"]).toBe("Bearer secret-token");
      }
    });

    it("does not send Authorization header when no token is provided", async () => {
      const entry = {
        id: "mem-1",
        content: "test",
        createdAt: "2026-07-08T00:00:00.000Z",
      };
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(entry) });

      const adapter = new Mem0Adapter("http://localhost:8050");
      await adapter.add("test");

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Record<string, string>;
      expect(headers["Authorization"]).toBeUndefined();
    });
  });
});
