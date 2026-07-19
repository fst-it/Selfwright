import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHttpScanContext } from "../http-context.js";

function mockFetchResponse(body: unknown, opts: { ok?: boolean; status?: number; url?: string; text?: string } = {}) {
  const ok = opts.ok ?? true;
  const status = opts.status ?? 200;
  return {
    ok,
    status,
    url: opts.url ?? "https://example.test/resolved",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(opts.text ?? JSON.stringify(body)),
  };
}

describe("createHttpScanContext", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fetchJson returns parsed JSON on a 2xx response, defaulting to GET + redirect:error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const ctx = createHttpScanContext();
    const result = await ctx.fetchJson("https://example.test/api");
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/api", { redirect: "error", method: "GET" });
  });

  it("fetchJson sends a POST body with content-type and accept headers when body is set", async () => {
    // Reproduces Bug 2: some Workday CXS tenants return 422 when Accept:
    // application/json is absent — adding it alongside Content-Type fixes the shape.
    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse({ jobs: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const ctx = createHttpScanContext();
    await ctx.fetchJson("https://example.test/api", { method: "POST", body: JSON.stringify({ offset: 0 }) });
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/api", {
      redirect: "error",
      method: "POST",
      body: JSON.stringify({ offset: 0 }),
      headers: { "content-type": "application/json", "accept": "application/json" },
    });
  });

  it("fetchJson throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse({}, { ok: false, status: 404 })));
    const ctx = createHttpScanContext();
    await expect(ctx.fetchJson("https://example.test/api")).rejects.toThrow(/responded 404/);
  });

  it("fetchText returns text on a 2xx response and throws on non-ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse(null, { text: "hello" })));
    const ctx = createHttpScanContext();
    expect(await ctx.fetchText("https://example.test/page")).toBe("hello");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse({}, { ok: false, status: 500 })));
    await expect(createHttpScanContext().fetchText("https://example.test/page")).rejects.toThrow(/responded 500/);
  });

  it("fetchRaw never throws on a non-2xx status, returning status/text/finalUrl instead", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockFetchResponse({}, { ok: false, status: 403, text: "Access Denied", url: "https://example.test/final" })),
    );
    const ctx = createHttpScanContext();
    const result = await ctx.fetchRaw("https://example.test/page");
    expect(result).toEqual({ status: 403, text: "Access Denied", finalUrl: "https://example.test/final" });
  });

  it("fetchJson retries on 429 and succeeds on the next attempt", async () => {
    const rate429 = mockFetchResponse({}, { ok: false, status: 429 });
    const success = mockFetchResponse({ data: "ok" });
    const fetchMock = vi.fn().mockResolvedValueOnce(rate429).mockResolvedValueOnce(success);
    vi.stubGlobal("fetch", fetchMock);
    const ctx = createHttpScanContext();
    const promise = ctx.fetchJson("https://example.test/api");
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ data: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fetchJson gives up after max retries on persistent 429 and throws", async () => {
    const rate429 = mockFetchResponse({}, { ok: false, status: 429 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(rate429));
    const ctx = createHttpScanContext();
    const promise = ctx.fetchJson("https://example.test/api");
    // Attach rejection handler before advancing timers to avoid unhandled-rejection warning.
    const assertion = expect(promise).rejects.toThrow(/responded 429/);
    await vi.runAllTimersAsync();
    await assertion;
  });

  it("fetchJson does not retry on 5xx (only 429 is retried)", async () => {
    const err500 = mockFetchResponse({}, { ok: false, status: 500 });
    const fetchMock = vi.fn().mockResolvedValue(err500);
    vi.stubGlobal("fetch", fetchMock);
    const ctx = createHttpScanContext();
    await expect(ctx.fetchJson("https://example.test/api")).rejects.toThrow(/responded 500/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
