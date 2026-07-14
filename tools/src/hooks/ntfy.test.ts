import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyNtfy } from "./ntfy.js";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env["NTFY_URL"];
});

describe("notifyNtfy", () => {
  it("is a no-op and does not call fetch when NTFY_URL is not set", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    await notifyNtfy("test message");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends a POST request to NTFY_URL with the message as body", async () => {
    process.env["NTFY_URL"] = "https://ntfy.example.com/selfwright";
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", mockFetch);

    await notifyNtfy("session started");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ntfy.example.com/selfwright");
    expect(opts.method).toBe("POST");
    expect(opts.body).toBe("session started");
  });

  it("sets the Title header when a title is provided", async () => {
    process.env["NTFY_URL"] = "https://ntfy.example.com/selfwright";
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", mockFetch);

    await notifyNtfy("blocked", { title: "Selfwright" });

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)["Title"]).toBe("Selfwright");
  });

  it("sets the Priority header when a priority is provided", async () => {
    process.env["NTFY_URL"] = "https://ntfy.example.com/selfwright";
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", mockFetch);

    await notifyNtfy("urgent item", { priority: "high" });

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)["Priority"]).toBe("high");
  });

  it("does not set Title or Priority when not provided", async () => {
    process.env["NTFY_URL"] = "https://ntfy.example.com/selfwright";
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", mockFetch);

    await notifyNtfy("plain message");

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers["Title"]).toBeUndefined();
    expect(headers["Priority"]).toBeUndefined();
  });

  it("resolves without throwing when fetch fails (advisory — never blocks)", async () => {
    process.env["NTFY_URL"] = "https://ntfy.example.com/selfwright";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    await expect(notifyNtfy("test")).resolves.toBeUndefined();
  });

  it("resolves without throwing when fetch times out (AbortError)", async () => {
    process.env["NTFY_URL"] = "https://ntfy.example.com/selfwright";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" })),
    );
    await expect(notifyNtfy("test")).resolves.toBeUndefined();
  });
});
