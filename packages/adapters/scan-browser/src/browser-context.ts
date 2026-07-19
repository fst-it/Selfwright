import { chromium } from "playwright";
import type { RawFetchResult } from "@selfwright/core";
import { assertPubliclyRoutableUrl, assertDnsResolvesPublicly, defaultDnsResolve } from "./url-guard.js";
import type { ResolveFn } from "./url-guard.js";

// A bot-challenge page (Cloudflare "Just a moment...", hCaptcha) typically
// auto-resolves and redirects within a couple of seconds for a real browser —
// that's the whole point of re-verifying via Playwright instead of plain
// fetch(). "networkidle" is deliberately NOT used as the wait condition: SPA
// career pages commonly keep background polling/websockets alive forever,
// which would make every navigation wait out the full timeout instead of
// resolving quickly. domcontentloaded + a short fixed settle window is a
// bounded, pragmatic compromise for a liveness check — the goal is rendered
// text, not a fully idle network.
const NAV_TIMEOUT_MS = 15_000;
const SETTLE_MS = 2_000;

/**
 * Minimal surface of Playwright's Browser/Page that this adapter needs. Kept
 * intentionally narrow (rather than depending on Playwright's full,
 * heavily-overloaded typings) so tests can inject a plain fake without
 * constructing a real Browser/Page — same rationale as llm-claude-cli's
 * SpawnFn.
 */
export interface MinimalPage {
  goto(
    url: string,
    opts: { timeout: number; waitUntil: "domcontentloaded" },
  ): Promise<{ status(): number } | null>;
  waitForTimeout(ms: number): Promise<void>;
  innerText(selector: string): Promise<string>;
  url(): string;
  close(): Promise<void>;
}

export interface MinimalBrowser {
  newPage(): Promise<MinimalPage>;
  close(): Promise<void>;
}

export type LaunchFn = () => Promise<MinimalBrowser>;

// Real Chromium launch — deliberately excluded from unit-test coverage
// (tests inject a fake LaunchFn and must never launch a real browser).
/* v8 ignore start */
async function defaultLaunch(): Promise<MinimalBrowser> {
  return chromium.launch({ headless: true });
}
/* v8 ignore stop */

export interface BrowserVerifyContext {
  fetchRendered(url: string): Promise<RawFetchResult>;
  close(): Promise<void>;
}

/**
 * Playwright-backed liveness re-verification (ADR 0012). Lazily launches one
 * headless Chromium instance on first fetchRendered() call — never at
 * construction, since most scan runs never hit an "uncertain" verdict and
 * shouldn't pay the launch cost. The same instance is reused across calls
 * within one scan run; the caller must call close() once done (a no-op if
 * fetchRendered was never called).
 *
 * Requires `npx playwright install chromium` once — deliberately not wired
 * to run automatically on `pnpm install` (see ADR 0012): most scan runs
 * don't opt into --verify, so most installs shouldn't pay for a browser
 * download they'll never use.
 */
export function createBrowserVerifyContext(
  launchFn: LaunchFn = defaultLaunch,
  resolveFn: ResolveFn = defaultDnsResolve,
): BrowserVerifyContext {
  let browserPromise: Promise<MinimalBrowser> | null = null;

  function getBrowser(): Promise<MinimalBrowser> {
    if (!browserPromise) browserPromise = launchFn();
    return browserPromise;
  }

  return {
    async fetchRendered(url: string): Promise<RawFetchResult> {
      // SSRF backstop (Finding 3): posting.url is untrusted — several
      // scan-http providers copy it verbatim from third-party JSON. Validate
      // BEFORE launching the browser or opening a page, not just before
      // page.goto, so an unsafe URL never costs a page open either. Both the
      // literal-hostname check and the best-effort DNS-resolve layer (R5) run
      // here, before the browser is even launched.
      assertPubliclyRoutableUrl(url);
      await assertDnsResolvesPublicly(url, resolveFn);
      const browser = await getBrowser();
      const page = await browser.newPage();
      try {
        const response = await page.goto(url, { timeout: NAV_TIMEOUT_MS, waitUntil: "domcontentloaded" });
        const finalUrl = page.url();
        // page.goto() always follows redirects — Playwright has no redirect:
        // "error" equivalent. Every fetch-based provider in scan-http treats
        // a pinned final hostname as load-bearing SSRF protection (redirect:
        // "error" + a per-provider host check); this is the post-navigation
        // equivalent — a target that redirects off-host is refused rather
        // than rendered.
        if (new URL(finalUrl).hostname !== new URL(url).hostname) {
          throw new Error(
            `fetchRendered: redirected off-host (${new URL(url).hostname} -> ${new URL(finalUrl).hostname})`,
          );
        }
        await page.waitForTimeout(SETTLE_MS);
        const text = await page.innerText("body");
        return { status: response?.status() ?? 0, text, finalUrl };
      } finally {
        await page.close();
      }
    },
    async close(): Promise<void> {
      if (!browserPromise) return;
      // A rejected launch means there is nothing to close — swallow it here
      // rather than re-throwing the same failure a second time. fetchRendered
      // already surfaced it once to the caller when the launch first failed.
      const browser = await browserPromise.catch(() => null);
      // Same swallow rationale as the launch-rejection catch above: by the
      // time close() runs, the scan has already completed (results computed,
      // queue.yml/scan-history.yml written) — a browser.close() failure
      // (Chromium crashed/was killed) is a cleanup-time error, not a reason
      // to turn a successful run into a CLI nonzero exit or a replaced MCP
      // error response (Finding 14).
      if (browser) await browser.close().catch(() => {});
    },
  };
}
