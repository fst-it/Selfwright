import { describe, expect, it, vi } from "vitest";
import { createBrowserVerifyContext } from "../browser-context.js";
import type { LaunchFn, MinimalBrowser, MinimalPage } from "../browser-context.js";
import type { ResolveFn } from "../url-guard.js";

// Every test below injects this fake resolver instead of the real
// dns.lookup-backed default — the R5 DNS-resolve SSRF check now runs inside
// fetchRendered before every page.goto, and these tests must never make a
// real DNS call (nor depend on network access / "a.example" being
// resolvable, which it isn't — it's an RFC 2606 reserved test domain).
function fakeResolveFn(): ResolveFn {
  return vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
}

// Raw vi.fn() handles are kept alongside the interface-typed fake (rather
// than asserting through e.g. `browser.newPage`) so assertions never access
// a method through its interface type — same convention as llm-claude-cli's
// SpawnedProcess fake, which avoids @typescript-eslint/unbound-method.
// Same host as every fetchRendered(...) call below ("a.example") — a fake
// that defaults to a same-host finalUrl represents the common case (no
// redirect); tests below override `url` explicitly to exercise a redirect.
function fakePage(gotoImpl?: () => Promise<{ status(): number } | null>) {
  const goto = vi.fn(gotoImpl ?? (() => Promise.resolve({ status: () => 200 })));
  const waitForTimeout = vi.fn().mockResolvedValue(undefined);
  const innerText = vi.fn().mockResolvedValue("rendered body text");
  const url = vi.fn().mockReturnValue("https://a.example/final");
  const close = vi.fn().mockResolvedValue(undefined);
  const page: MinimalPage = { goto, waitForTimeout, innerText, url, close };
  return { page, goto, waitForTimeout, innerText, url, close };
}

function fakeBrowser(page: MinimalPage) {
  const newPage = vi.fn().mockResolvedValue(page);
  const close = vi.fn().mockResolvedValue(undefined);
  const browser: MinimalBrowser = { newPage, close };
  return { browser, newPage, close };
}

describe("createBrowserVerifyContext", () => {
  it("does not launch a browser until fetchRendered is first called", () => {
    const { browser } = fakeBrowser(fakePage().page);
    const launchFn: LaunchFn = vi.fn().mockResolvedValue(browser);
    createBrowserVerifyContext(launchFn, fakeResolveFn());
    expect(launchFn).not.toHaveBeenCalled();
  });

  it("launches once and reuses the same browser across multiple calls", async () => {
    const { page } = fakePage();
    const { browser, newPage } = fakeBrowser(page);
    const launchFn: LaunchFn = vi.fn().mockResolvedValue(browser);
    const ctx = createBrowserVerifyContext(launchFn, fakeResolveFn());
    await ctx.fetchRendered("https://a.example/1");
    await ctx.fetchRendered("https://a.example/2");
    expect(launchFn).toHaveBeenCalledTimes(1);
    expect(newPage).toHaveBeenCalledTimes(2);
  });

  it("returns a RawFetchResult-shaped status/text/finalUrl", async () => {
    const { page } = fakePage();
    const { browser } = fakeBrowser(page);
    const launchFn: LaunchFn = vi.fn().mockResolvedValue(browser);
    const ctx = createBrowserVerifyContext(launchFn, fakeResolveFn());
    const result = await ctx.fetchRendered("https://a.example/1");
    expect(result).toEqual({
      status: 200,
      text: "rendered body text",
      finalUrl: "https://a.example/final",
    });
  });

  it("falls back to status 0 when goto returns no response", async () => {
    const { page } = fakePage(() => Promise.resolve(null));
    const { browser } = fakeBrowser(page);
    const launchFn: LaunchFn = vi.fn().mockResolvedValue(browser);
    const ctx = createBrowserVerifyContext(launchFn, fakeResolveFn());
    const result = await ctx.fetchRendered("https://a.example/1");
    expect(result.status).toBe(0);
  });

  it("closes the page even when navigation throws", async () => {
    const { page, close } = fakePage(() => Promise.reject(new Error("nav timeout")));
    const { browser } = fakeBrowser(page);
    const launchFn: LaunchFn = vi.fn().mockResolvedValue(browser);
    const ctx = createBrowserVerifyContext(launchFn, fakeResolveFn());
    await expect(ctx.fetchRendered("https://a.example/1")).rejects.toThrow("nav timeout");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rejects when the final URL redirects to a different host (SSRF guard)", async () => {
    const { page, url } = fakePage();
    url.mockReturnValue("https://evil.example/redirected");
    const { browser } = fakeBrowser(page);
    const launchFn: LaunchFn = vi.fn().mockResolvedValue(browser);
    const ctx = createBrowserVerifyContext(launchFn, fakeResolveFn());
    await expect(ctx.fetchRendered("https://a.example/1")).rejects.toThrow("redirected off-host");
  });

  // Finding 3 (SSRF): posting.url is untrusted — several scan-http providers
  // copy it verbatim from third-party JSON. fetchRendered must reject an
  // unsafe URL before ever calling page.goto, and must not even launch the
  // browser to do it (no launchFn call for a rejected URL).
  it.each([
    ["a file:// URL", "file:///etc/passwd"],
    ["cloud metadata", "http://169.254.169.254/latest/meta-data"],
    ["a private LAN address", "http://192.168.1.10/"],
    ["loopback", "http://127.0.0.1/"],
    ["localhost", "http://localhost/"],
    ["plain http", "http://example.com/"],
  ])("rejects (throws) for %s: %s", async (_label, badUrl) => {
    const { page, goto } = fakePage();
    const { browser } = fakeBrowser(page);
    const launchFn: LaunchFn = vi.fn().mockResolvedValue(browser);
    const ctx = createBrowserVerifyContext(launchFn, fakeResolveFn());
    await expect(ctx.fetchRendered(badUrl)).rejects.toThrow();
    expect(launchFn).not.toHaveBeenCalled();
    expect(goto).not.toHaveBeenCalled();
  });

  // R5: best-effort DNS-resolve SSRF check — a public hostname that resolves
  // to a private/reserved address must be rejected before page.goto, and
  // must not launch the browser to do it, same as the literal-hostname guard.
  it("rejects when the resolved address is private (DNS-resolve SSRF guard)", async () => {
    const { page, goto } = fakePage();
    const { browser } = fakeBrowser(page);
    const launchFn: LaunchFn = vi.fn().mockResolvedValue(browser);
    const resolveFn: ResolveFn = vi.fn().mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    const ctx = createBrowserVerifyContext(launchFn, resolveFn);
    await expect(ctx.fetchRendered("https://internal.example/")).rejects.toThrow("private/reserved address");
    expect(launchFn).not.toHaveBeenCalled();
    expect(goto).not.toHaveBeenCalled();
  });

  it("rejects when DNS resolution fails (fail-closed)", async () => {
    const { page, goto } = fakePage();
    const { browser } = fakeBrowser(page);
    const launchFn: LaunchFn = vi.fn().mockResolvedValue(browser);
    const resolveFn: ResolveFn = vi.fn().mockRejectedValue(new Error("NXDOMAIN"));
    const ctx = createBrowserVerifyContext(launchFn, resolveFn);
    await expect(ctx.fetchRendered("https://nonexistent.example/")).rejects.toThrow("DNS resolution failed");
    expect(launchFn).not.toHaveBeenCalled();
    expect(goto).not.toHaveBeenCalled();
  });

  it("still succeeds for a normal https:// URL", async () => {
    const { page, url } = fakePage();
    // Same host as the requested URL so the post-navigation off-host check
    // (a separate guard, exercised above) doesn't interfere with this test.
    url.mockReturnValue("https://boards.greenhouse.io/acme/jobs/1");
    const { browser } = fakeBrowser(page);
    const launchFn: LaunchFn = vi.fn().mockResolvedValue(browser);
    const ctx = createBrowserVerifyContext(launchFn, fakeResolveFn());
    const result = await ctx.fetchRendered("https://boards.greenhouse.io/acme/jobs/1");
    expect(result.text).toBe("rendered body text");
    expect(launchFn).toHaveBeenCalledTimes(1);
  });

  it("close() swallows a failed launch instead of re-throwing", async () => {
    const launchFn: LaunchFn = vi.fn().mockRejectedValue(new Error("Executable doesn't exist"));
    const ctx = createBrowserVerifyContext(launchFn, fakeResolveFn());
    await expect(ctx.fetchRendered("https://a.example/1")).rejects.toThrow("Executable doesn't exist");
    await expect(ctx.close()).resolves.toBeUndefined();
  });

  it("close() is a no-op if the browser was never launched", async () => {
    const { browser, close } = fakeBrowser(fakePage().page);
    const launchFn: LaunchFn = vi.fn().mockResolvedValue(browser);
    const ctx = createBrowserVerifyContext(launchFn, fakeResolveFn());
    await ctx.close();
    expect(close).not.toHaveBeenCalled();
  });

  it("close() closes the browser once it has been launched", async () => {
    const { page } = fakePage();
    const { browser, close } = fakeBrowser(page);
    const launchFn: LaunchFn = vi.fn().mockResolvedValue(browser);
    const ctx = createBrowserVerifyContext(launchFn, fakeResolveFn());
    await ctx.fetchRendered("https://a.example/1");
    await ctx.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  // Finding 14: a successful scan (browser launched, fetchRendered already
  // returned) must not be turned into a CLI nonzero exit / replaced MCP
  // response just because browser.close() itself then throws (e.g. Chromium
  // crashed/was killed after use) — same swallow rationale already applied
  // to a rejected launch, one line above in the source.
  it("close() resolves even when browser.close() rejects after a successful fetchRendered", async () => {
    const { page } = fakePage();
    const { browser } = fakeBrowser(page);
    const failingClose = vi.fn().mockRejectedValue(new Error("Chromium crashed"));
    browser.close = failingClose;
    const launchFn: LaunchFn = vi.fn().mockResolvedValue(browser);
    const ctx = createBrowserVerifyContext(launchFn, fakeResolveFn());
    await ctx.fetchRendered("https://a.example/1");
    await expect(ctx.close()).resolves.toBeUndefined();
    expect(failingClose).toHaveBeenCalledTimes(1);
  });
});
