import { chromium } from "playwright";
import type { RawPosting, ScanFetchContext, ScanProvider, ScanTarget } from "@selfwright/core";
import {
  assertPubliclyRoutableUrl,
  assertDnsResolvesPublicly,
  defaultDnsResolve,
} from "../url-guard.js";
import type { ResolveFn } from "../url-guard.js";
import type { MinimalPage } from "../browser-context.js";

// Playwright-backed Workday listing provider for bot-gated tenants (ADR 0012
// §T5.4). Uses in-page CXS as the primary extraction mode (page.evaluate sends
// a fetch() from inside the browser, carrying the page's own cookies/session
// so the request bypasses bot-gating that targets server-side POSTs), with DOM
// extraction as a fallback when the in-page CXS call is rejected.

// Minimum wait between successive page interactions (between CXS offset
// requests or between DOM next-page clicks). Two seconds is deliberately
// conservative — these are bot-gated tenants and a shorter delay risks
// triggering the same anti-bot stack we are working around. DoD requirement.
const POLITENESS_DELAY_MS = 2_000;

// Wait after page.goto before interacting with the rendered DOM. Same value
// and rationale as BrowserVerifyContext's SETTLE_MS: domcontentloaded fires
// before React/Workday SPA finishes rendering the job list, so a short fixed
// delay is a pragmatic bounded wait.
const SETTLE_MS = 2_000;

// Navigation timeout for page.goto. Same as BrowserVerifyContext.
const NAV_TIMEOUT_MS = 15_000;

// Maximum result pages fetched per tenant (both CXS and DOM modes).
// Mirrors the HTTP workday provider to cap scan time.
const MAX_PAGES = 20;

// CXS page size — identical to the HTTP workday provider.
const PAGE_SIZE = 20;

/**
 * Extension of MinimalPage with page.evaluate() needed for in-page CXS fetch
 * and DOM extraction.
 *
 * Accepts only a JavaScript-expression string (not the function form): the
 * function form would require DOM type definitions (`HTMLElement`, `document`,
 * `fetch`, etc.) unavailable in this package's `lib: ["ES2022"]` tsconfig, so
 * all browser-side logic is expressed as a self-contained JS string and the
 * dynamic values are embedded via JSON.stringify().
 */
export interface MinimalListingPage extends MinimalPage {
  evaluate<T>(script: string): Promise<T>;
}

export interface MinimalListingBrowser {
  newPage(): Promise<MinimalListingPage>;
  close(): Promise<void>;
}

export type ListingLaunchFn = () => Promise<MinimalListingBrowser>;

// Real Chromium launch — excluded from unit-test coverage (tests inject a fake
// ListingLaunchFn and must never launch a real browser).
/* v8 ignore start */
async function defaultListingLaunch(): Promise<MinimalListingBrowser> {
  // Playwright's Browser structurally satisfies MinimalListingBrowser (skipLibCheck:
  // true lets TypeScript verify structural compatibility without deep lib checks).
  return chromium.launch({ headless: true });
}
/* v8 ignore stop */

// Parse a Workday careersUrl into the components this provider needs.
// Accepts the same URL pattern as the HTTP workday provider:
//   https://<tenant>.<instance>.myworkdayjobs.com[/<locale>]/<site>
interface WorkdayEndpoint {
  listingUrl: string; // the URL to navigate to (the careersUrl)
  cxsPath: string; // relative path for in-page CXS: /wday/cxs/<tenant>/<site>/jobs
  jobBase: string; // prefix for externalPath → absolute posting URL
  hostname: string; // hostname of the career site (for posting URL allowlist)
}

function resolveEndpoint(target: ScanTarget): WorkdayEndpoint | null {
  const url = target.careersUrl ?? "";
  const match =
    /^https:\/\/([\w-]+)\.(wd[\w-]*)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+)/.exec(
      url,
    );
  if (!match) return null;
  const [, tenant, instance, site] = match;
  const origin = `https://${tenant}.${instance}.myworkdayjobs.com`;
  return {
    listingUrl: url,
    cxsPath: `/wday/cxs/${tenant}/${site}/jobs`,
    jobBase: `${origin}/${site}`,
    hostname: `${tenant}.${instance}.myworkdayjobs.com`,
  };
}

// Accept posting URLs that are same-origin with the configured career site OR
// on any *.myworkdayjobs.com host. The leading-dot suffix pattern prevents the
// bypass "evil.myworkdayjobs.com.evil.com" (ends with "myworkdayjobs.com" but
// NOT ".myworkdayjobs.com") while accepting any legitimate tenant subdomain.
// Pattern from adzuna.ts isAllowedPostingUrl (Phase 3 SSRF review).
function isAllowedWorkdayPostingUrl(url: string, expectedHostname: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const h = parsed.hostname.toLowerCase();
    const expected = expectedHostname.toLowerCase();
    if (h === expected) return true;
    if (h === "myworkdayjobs.com" || h.endsWith(".myworkdayjobs.com")) return true;
    return false;
  } catch {
    return false;
  }
}

interface WorkdayJobPosting {
  title?: string;
  externalPath?: string;
  locationsText?: string;
}

interface WorkdayCxsResponse {
  jobPostings?: WorkdayJobPosting[];
}

interface DomJobItem {
  title: string;
  href: string;
  location: string;
}

/**
 * Playwright-backed Workday listing provider for bot-gated tenants.
 * Target config: `provider: workday-browser` + `careersUrl` pointing at the
 * tenant's public Workday career-site listing page (same URL pattern as the
 * HTTP workday provider).
 *
 * Extraction modes (tried in order per tenant):
 *   1. In-page CXS: evaluates a fetch() from inside the browser page (uses the
 *      page's own session to bypass bot-gating on plain server-side requests).
 *   2. DOM extraction: reads job cards via stable data-automation-id attributes
 *      that Workday uses pervasively across tenant career sites, paginating via
 *      the next-page button.
 *
 * @param launchFn  Injectable for tests — tests must never launch a real browser.
 * @param resolveFn Injectable DNS resolver for SSRF best-effort DNS check.
 */
export function createWorkdayBrowserProvider(
  launchFn: ListingLaunchFn = defaultListingLaunch,
  resolveFn: ResolveFn = defaultDnsResolve,
): ScanProvider & { close(): Promise<void> } {
  let browserPromise: Promise<MinimalListingBrowser> | null = null;

  function getBrowser(): Promise<MinimalListingBrowser> {
    if (!browserPromise) browserPromise = launchFn();
    return browserPromise;
  }

  return {
    id: "workday-browser",

    detect(target: ScanTarget): { url: string } | null {
      if (target.provider !== "workday-browser") return null;
      const ep = resolveEndpoint(target);
      return ep ? { url: ep.listingUrl } : null;
    },

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async fetch(target: ScanTarget, _ctx: ScanFetchContext): Promise<RawPosting[]> {
      const ep = resolveEndpoint(target);
      if (!ep) {
        throw new Error(`workday-browser: cannot parse careersUrl for ${target.company}`);
      }

      // SSRF: validate before launching browser or opening a page — same
      // backstop as BrowserVerifyContext.fetchRendered.
      assertPubliclyRoutableUrl(ep.listingUrl);
      await assertDnsResolvesPublicly(ep.listingUrl, resolveFn);

      const browser = await getBrowser();
      const page = await browser.newPage();
      const fetchedAt = new Date().toISOString();
      const all: RawPosting[] = [];

      try {
        const response = await page.goto(ep.listingUrl, {
          timeout: NAV_TIMEOUT_MS,
          waitUntil: "domcontentloaded",
        });
        const navStatus = response?.status() ?? 0;
        const finalUrl = page.url();

        // SSRF: reject off-host redirects — same guarantee as BrowserVerifyContext
        // (Playwright always follows redirects; enforce post-navigation).
        if (new URL(finalUrl).hostname !== new URL(ep.listingUrl).hostname) {
          throw new Error(
            `workday-browser: redirected off-host (${new URL(ep.listingUrl).hostname} -> ${new URL(finalUrl).hostname})`,
          );
        }

        if (navStatus !== 0 && (navStatus < 200 || navStatus >= 300)) {
          process.stderr.write(
            `[workday-browser] warn: ${target.company}: listing page returned HTTP ${navStatus}; attempting extraction anyway\n`,
          );
        }

        // Wait for the Workday SPA to finish rendering the initial job list.
        await page.waitForTimeout(SETTLE_MS);

        let hitCap = false;
        let mode: "cxs" | "dom" = "cxs";

        try {
          // ── In-page CXS (primary) ────────────────────────────────────────
          // page.evaluate runs the script in the browser's JS environment,
          // so the fetch() carries the page's cookies/session — bypassing the
          // same bot-gating that rejects a plain server-side POST.
          // Pagination uses CXS offset (no DOM clicks needed).
          for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
            const offset = pageNum * PAGE_SIZE;
            const reqBody = JSON.stringify({
              limit: PAGE_SIZE,
              offset,
              searchText: "",
              appliedFacets: {},
            });

            // Build a self-contained JS expression — JSON.stringify ensures
            // the path and body are properly escaped string literals.
            const cxsScript = `(function(){
  return fetch(${JSON.stringify(ep.cxsPath)},{
    method:"POST",
    headers:{"Content-Type":"application/json","Accept":"application/json"},
    body:${JSON.stringify(reqBody)}
  }).then(function(r){
    if(!r.ok)throw new Error("CXS:"+r.status);
    return r.json();
  });
})()`;

            const json = await page.evaluate<WorkdayCxsResponse>(cxsScript);
            const postings = Array.isArray(json.jobPostings) ? json.jobPostings : [];

            for (const j of postings.filter(
              (j): j is WorkdayJobPosting & { externalPath: string } =>
                typeof j.externalPath === "string",
            )) {
              const postingUrl = ep.jobBase + j.externalPath;
              if (!isAllowedWorkdayPostingUrl(postingUrl, ep.hostname)) continue;
              all.push({
                title: j.title ?? "",
                url: postingUrl,
                company: target.company,
                location: j.locationsText ?? "",
                source: "workday-browser",
                sourceKind: "structured",
                fetchedAt,
              });
            }

            if (postings.length < PAGE_SIZE) break; // short page → last page
            if (pageNum === MAX_PAGES - 1) {
              hitCap = true;
              break;
            }

            // Politeness delay between CXS offset requests (DoD requirement).
            await page.waitForTimeout(POLITENESS_DELAY_MS);
          }
        } catch (cxsErr) {
          // ── DOM extraction fallback ──────────────────────────────────────
          // In-page CXS failed (e.g. CSRF enforcement, 403 from browser, or
          // the endpoint is unavailable). Fall back to reading job cards from
          // the rendered DOM using Workday's stable data-automation-id attrs.
          mode = "dom";
          process.stderr.write(
            `[workday-browser] info: ${target.company}: in-page CXS failed` +
              ` (${cxsErr instanceof Error ? cxsErr.message : String(cxsErr)});` +
              ` falling back to DOM extraction\n`,
          );
          // Reset any partial CXS results accumulated before the failure.
          all.length = 0;

          for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
            // Workday career sites use these data-automation-id attributes
            // pervasively across tenant instances (stable component IDs):
            //   jobItem           — each job card in the listing
            //   jobDetailsLink    — the anchor linking to the job detail page
            //   compositeHeader   — alternative job title container (fallback)
            //   jobLocations      — location text within the card
            const domScript = `(function(){
  var cards=Array.from(document.querySelectorAll('[data-automation-id="jobItem"]'));
  return cards.map(function(card){
    var link=card.querySelector('[data-automation-id="jobDetailsLink"]')
           ||card.querySelector('[data-automation-id="compositeHeader"] a');
    var loc=card.querySelector('[data-automation-id="jobLocations"]');
    return{
      title:(link?link.textContent||"":"").trim(),
      href:link?link.href:"",
      location:(loc?loc.textContent||"":"").trim()
    };
  });
})()`;

            const items = await page.evaluate<DomJobItem[]>(domScript);

            for (const item of items.filter((i) => i.href && i.title)) {
              if (!isAllowedWorkdayPostingUrl(item.href, ep.hostname)) continue;
              all.push({
                title: item.title,
                url: item.href,
                company: target.company,
                location: item.location,
                source: "workday-browser",
                sourceKind: "structured",
                fetchedAt,
              });
            }

            // Pagination: click next-page button (returns false → last page).
            // Workday uses data-automation-id="paginationNextButton"; some
            // older tenant builds use "navigateNextButton".
            const paginateScript = `(function(){
  var btn=document.querySelector('[data-automation-id="paginationNextButton"]')
        ||document.querySelector('[data-automation-id="navigateNextButton"]');
  if(!btn||btn.disabled)return false;
  btn.click();
  return true;
})()`;

            const hasNext = await page.evaluate<boolean>(paginateScript);

            if (!hasNext) break;
            if (pageNum === MAX_PAGES - 1) {
              hitCap = true;
              break;
            }

            // Politeness delay between DOM page navigations (DoD requirement).
            await page.waitForTimeout(POLITENESS_DELAY_MS);
          }
        }

        // Never-silent rule: 0 postings from a configured tenant → stderr warn.
        if (all.length === 0) {
          process.stderr.write(
            `[workday-browser] warn: 0 postings fetched from ${target.company}` +
              ` (mode: ${mode})\n`,
          );
        }

        // Truncation warn: hit MAX_PAGES with more content likely available.
        if (hitCap) {
          process.stderr.write(
            `[workday-browser] warn: ${target.company}: hit MAX_PAGES (${MAX_PAGES}) cap;` +
              ` more postings may be available\n`,
          );
        }

        return all;
      } finally {
        await page.close();
      }
    },

    async close(): Promise<void> {
      if (!browserPromise) return;
      // Swallow a rejected launch (same rationale as BrowserVerifyContext.close):
      // a scan run that already completed must not crash on cleanup.
      const browser = await browserPromise.catch(() => null);
      if (browser) await browser.close().catch(() => {});
    },
  };
}
