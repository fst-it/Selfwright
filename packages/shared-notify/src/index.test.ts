import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notify, notifyCoaching } from "./index.js";

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env["NTFY_URL"];
});

describe("notify", () => {
  it("is a no-op and does not call fetch when NTFY_URL is not set", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    await notify("test message");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends a POST request to NTFY_URL with the message as body", async () => {
    process.env["NTFY_URL"] = "https://ntfy.example.com/selfwright";
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", mockFetch);

    await notify("session started");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ntfy.example.com/selfwright");
    expect(opts.method).toBe("POST");
    expect(opts.body).toBe("session started");
  });

  it("sets the Content-Type header to text/plain", async () => {
    process.env["NTFY_URL"] = "https://ntfy.example.com/selfwright";
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", mockFetch);

    await notify("test");

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)["Content-Type"]).toBe(
      "text/plain; charset=utf-8",
    );
  });

  it("sets the Title header when a title is provided", async () => {
    process.env["NTFY_URL"] = "https://ntfy.example.com/selfwright";
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", mockFetch);

    await notify("blocked", { title: "Selfwright" });

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)["Title"]).toBe("Selfwright");
  });

  it("sets the Priority header when a priority is provided", async () => {
    process.env["NTFY_URL"] = "https://ntfy.example.com/selfwright";
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", mockFetch);

    await notify("urgent item", { priority: "high" });

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)["Priority"]).toBe("high");
  });

  it("does not set Title or Priority when not provided", async () => {
    process.env["NTFY_URL"] = "https://ntfy.example.com/selfwright";
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", mockFetch);

    await notify("plain message");

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers["Title"]).toBeUndefined();
    expect(headers["Priority"]).toBeUndefined();
  });

  it("resolves without throwing when fetch fails (advisory — never blocks)", async () => {
    process.env["NTFY_URL"] = "https://ntfy.example.com/selfwright";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    await expect(notify("test")).resolves.toBeUndefined();
  });

  it("resolves without throwing when fetch times out (AbortError)", async () => {
    process.env["NTFY_URL"] = "https://ntfy.example.com/selfwright";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" })),
    );
    await expect(notify("test")).resolves.toBeUndefined();
  });

  it("uses config.urlOverride instead of NTFY_URL when provided", async () => {
    process.env["NTFY_URL"] = "https://ntfy.example.com/env-topic";
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", mockFetch);

    await notify("test", {}, { urlOverride: "https://ntfy.example.com/override-topic" });

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ntfy.example.com/override-topic");
  });

  it("uses config.urlOverride even when NTFY_URL is not set", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", mockFetch);

    await notify("test", {}, { urlOverride: "https://ntfy.example.com/override-only" });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ntfy.example.com/override-only");
  });

  it("suppresses notification when current hour is within a same-day quiet-hours window", async () => {
    // Fix time at 02:30; quiet window is 01–05.
    vi.useFakeTimers({ now: new Date("2026-01-01T02:30:00") });
    process.env["NTFY_URL"] = "https://ntfy.example.com/selfwright";
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    await notify("should be suppressed", {}, { quietHours: { start: 1, end: 5 } });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends notification when current hour is outside the quiet-hours window", async () => {
    // Fix time at 10:00; quiet window wraps 23–07 (does not include 10).
    vi.useFakeTimers({ now: new Date("2026-01-01T10:00:00") });
    process.env["NTFY_URL"] = "https://ntfy.example.com/selfwright";
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", mockFetch);

    await notify("should be sent", {}, { quietHours: { start: 23, end: 7 } });

    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("suppresses notification when current hour is within a wrap-around quiet-hours window", async () => {
    // Fix time at 00:30; quiet window wraps 23–07 (includes midnight).
    vi.useFakeTimers({ now: new Date("2026-01-01T00:30:00") });
    process.env["NTFY_URL"] = "https://ntfy.example.com/selfwright";
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    await notify("should be suppressed", {}, { quietHours: { start: 23, end: 7 } });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  describe("enabled_digests suppression", () => {
    it("suppresses notification when digestKind is not in enabledDigests", async () => {
      process.env["NTFY_URL"] = "https://ntfy.example.com/selfwright";
      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      await notify("scan done", { digestKind: "scan" }, { enabledDigests: ["inbox"] });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("sends notification when digestKind is in enabledDigests", async () => {
      process.env["NTFY_URL"] = "https://ntfy.example.com/selfwright";
      const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));
      vi.stubGlobal("fetch", mockFetch);

      await notify("inbox ready", { digestKind: "inbox" }, { enabledDigests: ["inbox", "scan"] });

      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it("sends notification when enabledDigests is absent (no restriction)", async () => {
      process.env["NTFY_URL"] = "https://ntfy.example.com/selfwright";
      const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));
      vi.stubGlobal("fetch", mockFetch);

      await notify("scan done", { digestKind: "scan" });

      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it("sends notification when digestKind is absent even if enabledDigests is set", async () => {
      process.env["NTFY_URL"] = "https://ntfy.example.com/selfwright";
      const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));
      vi.stubGlobal("fetch", mockFetch);

      // No digestKind on the call → suppression list is irrelevant.
      await notify("untyped alert", {}, { enabledDigests: ["inbox"] });

      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it("suppresses notification when enabledDigests is empty", async () => {
      process.env["NTFY_URL"] = "https://ntfy.example.com/selfwright";
      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      await notify("scan done", { digestKind: "scan" }, { enabledDigests: [] });

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});

describe("notifyCoaching", () => {
  it("joins the ids array and forwards the title to notify", async () => {
    process.env["NTFY_URL"] = "https://ntfy.example.com/selfwright";
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", mockFetch);

    await notifyCoaching(["GAP-DATA-MESH", "EVD-ACME-CTRM"], "Coaching gaps");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(opts.body).toBe("GAP-DATA-MESH, EVD-ACME-CTRM");
    expect((opts.headers as Record<string, string>)["Title"]).toBe("Coaching gaps");
  });

  it("passes config.urlOverride to notify", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", mockFetch);

    await notifyCoaching(["GAP-1"], "Drill", { urlOverride: "https://ntfy.example.com/coaching" });

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ntfy.example.com/coaching");
  });
});
