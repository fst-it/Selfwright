import type { RawPosting, ScanTarget } from "../scanning/types.js";

export interface RawFetchResult {
  status: number;
  text: string;
  finalUrl: string;
}

export interface ScanFetchContext {
  fetchJson(
    url: string,
    opts?: {
      redirect?: "error" | "follow";
      method?: "GET" | "POST";
      body?: string;
      headers?: Record<string, string>;
    },
  ): Promise<unknown>;
  fetchText(
    url: string,
    opts?: { redirect?: "error" | "follow"; headers?: Record<string, string> },
  ): Promise<string>;
  // Never throws on a non-2xx HTTP status (only on a network-level failure) —
  // 403/404/410 etc. are liveness signals for a single-posting page, not fetch
  // failures. Used by providers that check per-posting liveness (e.g. the
  // generic company-page fetcher); the ATS JSON-API providers use
  // fetchJson/fetchText, where a non-ok response is an unambiguous whole-board
  // fetch failure, not a per-posting signal.
  fetchRaw(url: string, opts?: { redirect?: "error" | "follow" }): Promise<RawFetchResult>;
  // Optional (ADR 0012, T3.1): a real-browser re-fetch of a single posting
  // URL, used only by orchestrate.ts to re-verify an "uncertain" liveness
  // verdict (anti-bot walls, JS-hydrated content plain fetch() can't see).
  // Absent on the plain-HTTP context; present only when a browser-capable
  // context (packages/adapters/scan-browser) is composed in by the caller.
  // Never called by providers directly — same shape as fetchRaw so the
  // caller can feed the result straight into checkLiveness().
  fetchRendered?(url: string): Promise<RawFetchResult>;
}

export interface ScanProvider {
  readonly id: string;
  detect(target: ScanTarget): { url: string } | null;
  fetch(target: ScanTarget, ctx: ScanFetchContext): Promise<RawPosting[]>;
}
