import type { ScanFetchContext } from "@selfwright/core";

// Retry on 429 (rate limited) only. Servers that consistently return 5xx are
// genuinely down — retry adds noise without signal. 429 is the specific failure
// mode documented for Ashby/Workday/SmartRecruiters under traffic.
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1_000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<{ status: number; value: T }>,
  url: string,
  label: string,
): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const { status, value } = await fn();
    if (status !== 429 || attempt === MAX_RETRIES) {
      if (status < 200 || status >= 300) {
        throw new Error(`${label}: ${url} responded ${status}`);
      }
      return value;
    }
    // 429 — respect Retry-After if available, otherwise exponential backoff with cap.
    const delayMs = Math.min(RETRY_BASE_MS * 2 ** attempt, 30_000);
    await sleep(delayMs);
  }
  /* v8 ignore next */
  throw new Error(`${label}: ${url} gave up after ${MAX_RETRIES} retries`);
}

/**
 * Real, network-backed ScanFetchContext (native fetch, Node 22). `redirect:
 * "error"` on every call prevents SSRF via a server-side redirect to an
 * unexpected host — combined with each provider's own URL guard (ATS providers
 * have an allowlist; the generic provider calls assertPubliclyRoutableUrl +
 * assertDnsResolvesPublicly from scan-http/src/url-guard.ts before the URL
 * reaches here), the final request hostname stays within the allowed set.
 * This is the only place `fetch` is used in the scanner — providers never
 * call it directly.
 */
export function createHttpScanContext(): ScanFetchContext {
  return {
    async fetchJson(
      url: string,
      opts?: {
        redirect?: "error" | "follow";
        method?: "GET" | "POST";
        body?: string;
        headers?: Record<string, string>;
      },
    ): Promise<unknown> {
      return withRetry(async () => {
        const baseHeaders: Record<string, string> = opts?.body !== undefined
          ? { "content-type": "application/json", "accept": "application/json" }
          : {};
        const mergedHeaders = { ...baseHeaders, ...(opts?.headers ?? {}) };
        const res = await fetch(url, {
          redirect: opts?.redirect ?? "error",
          method: opts?.method ?? "GET",
          ...(opts?.body !== undefined ? { body: opts.body } : {}),
          ...(Object.keys(mergedHeaders).length > 0 ? { headers: mergedHeaders } : {}),
        });
        // Only parse JSON on success — error bodies may not be valid JSON.
        const value = res.ok ? await res.json() : undefined;
        return { status: res.status, value };
      }, url, "fetchJson");
    },
    async fetchText(
      url: string,
      opts?: { redirect?: "error" | "follow"; headers?: Record<string, string> },
    ): Promise<string> {
      return withRetry(async () => {
        const res = await fetch(url, {
          redirect: opts?.redirect ?? "error",
          ...(opts?.headers !== undefined ? { headers: opts.headers } : {}),
        });
        const value = res.ok ? await res.text() : "";
        return { status: res.status, value };
      }, url, "fetchText");
    },
    async fetchRaw(url: string, opts?: { redirect?: "error" | "follow" }) {
      const res = await fetch(url, { redirect: opts?.redirect ?? "error" });
      return { status: res.status, text: await res.text(), finalUrl: res.url };
    },
  };
}
