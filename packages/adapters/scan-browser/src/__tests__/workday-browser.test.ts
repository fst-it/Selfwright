import { describe, expect, it, vi } from "vitest";
import type { ScanTarget } from "@selfwright/core";
import { createWorkdayBrowserProvider } from "../providers/workday-browser.js";
import type { MinimalListingPage, MinimalListingBrowser, ListingLaunchFn } from "../providers/workday-browser.js";
import type { ResolveFn } from "../url-guard.js";

// Fake DNS resolver that always reports a public address — keeps SSRF checks
// from making real network calls while letting all tests navigate normally.
function fakePublicResolve(): ResolveFn {
  return vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
}

// Fake page builder. Raw vi.fn() handles are returned alongside the
// interface-typed fake (the same convention as browser-context.test.ts) so
// assertions never access a method through its interface type —
// @typescript-eslint/unbound-method would fire. Cast via unknown so the
// structural check on MinimalListingPage doesn't require exact vi.Mock types.
function fakePage(opts?: { urlReturn?: string; gotoStatus?: number }) {
  const gotoStatus = opts?.gotoStatus ?? 200;
  const goto = vi.fn().mockResolvedValue({ status: () => gotoStatus });
  const waitForTimeout = vi.fn().mockResolvedValue(undefined);
  // Default URL must match the Acme careersUrl host so the off-host check passes.
  const url = vi.fn().mockReturnValue(
    opts?.urlReturn ?? "https://acme.wd3.myworkdayjobs.com/en-US/AcmeCareers",
  );
  const close = vi.fn().mockResolvedValue(undefined);
  const innerText = vi.fn().mockResolvedValue("");
  const evaluate = vi.fn();
  const page = {
    goto,
    waitForTimeout,
    url,
    close,
    innerText,
    evaluate,
  } as unknown as MinimalListingPage;
  return { page, goto, waitForTimeout, url, close, innerText, evaluate };
}

function fakeBrowser(page: MinimalListingPage) {
  const newPage = vi.fn().mockResolvedValue(page);
  const close = vi.fn().mockResolvedValue(undefined);
  const browser: MinimalListingBrowser = { newPage, close };
  return { browser, newPage, close };
}

// Synthetic careersUrl: tenant=acme, instance=wd3, site=AcmeCareers
const ACME_CAREERS_URL = "https://acme.wd3.myworkdayjobs.com/en-US/AcmeCareers";
const ACME_TARGET: ScanTarget = {
  company: "Acme Corp",
  provider: "workday-browser",
  careersUrl: ACME_CAREERS_URL,
};

// Minimal ScanFetchContext — the provider does not use it but the interface
// requires it.
const UNUSED_CTX = {
  fetchJson: vi.fn(),
  fetchText: vi.fn(),
  fetchRaw: vi.fn(),
};

describe("createWorkdayBrowserProvider — detect", () => {
  it("returns the listing URL for a valid workday-browser target", () => {
    const provider = createWorkdayBrowserProvider(vi.fn(), fakePublicResolve());
    expect(provider.detect(ACME_TARGET)).toEqual({ url: ACME_CAREERS_URL });
  });

  it("returns null when provider is not workday-browser", () => {
    const provider = createWorkdayBrowserProvider(vi.fn(), fakePublicResolve());
    expect(provider.detect({ ...ACME_TARGET, provider: "workday" })).toBeNull();
  });

  it("returns null when careersUrl is absent", () => {
    const provider = createWorkdayBrowserProvider(vi.fn(), fakePublicResolve());
    expect(provider.detect({ company: "Acme", provider: "workday-browser" })).toBeNull();
  });

  it("returns null when careersUrl does not match the myworkdayjobs.com pattern", () => {
    const provider = createWorkdayBrowserProvider(vi.fn(), fakePublicResolve());
    expect(
      provider.detect({ ...ACME_TARGET, careersUrl: "https://acme.com/careers" }),
    ).toBeNull();
  });

  it("accepts a careersUrl without a locale segment", () => {
    const provider = createWorkdayBrowserProvider(vi.fn(), fakePublicResolve());
    expect(
      provider.detect({
        ...ACME_TARGET,
        careersUrl: "https://acme.wd1.myworkdayjobs.com/AcmeCareers",
      }),
    ).toEqual({ url: "https://acme.wd1.myworkdayjobs.com/AcmeCareers" });
  });
});

describe("createWorkdayBrowserProvider — fetch (in-page CXS mode)", () => {
  it("launches the browser lazily and opens one page per fetch call", async () => {
    const { page, evaluate } = fakePage();
    const { browser, newPage } = fakeBrowser(page);
    const launchFn: ListingLaunchFn = vi.fn().mockResolvedValue(browser);
    const provider = createWorkdayBrowserProvider(launchFn, fakePublicResolve());

    // First call triggers the lazy launch.
    evaluate.mockResolvedValueOnce({ jobPostings: [] });
    await provider.fetch(ACME_TARGET, UNUSED_CTX);
    expect(launchFn).toHaveBeenCalledTimes(1);
    expect(newPage).toHaveBeenCalledTimes(1);

    // Second call reuses the same browser instance.
    evaluate.mockResolvedValueOnce({ jobPostings: [] });
    await provider.fetch(ACME_TARGET, UNUSED_CTX);
    expect(launchFn).toHaveBeenCalledTimes(1);
    expect(newPage).toHaveBeenCalledTimes(2);
  });

  it("navigates to the careersUrl with the expected options", async () => {
    const { page, goto, evaluate } = fakePage();
    const { browser } = fakeBrowser(page);
    const launchFn: ListingLaunchFn = vi.fn().mockResolvedValue(browser);
    const provider = createWorkdayBrowserProvider(launchFn, fakePublicResolve());

    evaluate.mockResolvedValueOnce({ jobPostings: [] });
    await provider.fetch(ACME_TARGET, UNUSED_CTX);
    expect(goto).toHaveBeenCalledWith(ACME_CAREERS_URL, {
      timeout: 15_000,
      waitUntil: "domcontentloaded",
    });
  });

  it("maps a CXS response to RawPosting[] with correct fields", async () => {
    const { page, evaluate } = fakePage();
    const { browser } = fakeBrowser(page);
    const launchFn: ListingLaunchFn = vi.fn().mockResolvedValue(browser);
    const provider = createWorkdayBrowserProvider(launchFn, fakePublicResolve());

    evaluate.mockResolvedValueOnce({
      jobPostings: [
        {
          title: "Enterprise Architect",
          externalPath: "/job/Amsterdam/Enterprise-Architect_JR001",
          locationsText: "Amsterdam, Netherlands",
        },
      ],
    });
    const result = await provider.fetch(ACME_TARGET, UNUSED_CTX);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: "Enterprise Architect",
      url: "https://acme.wd3.myworkdayjobs.com/AcmeCareers/job/Amsterdam/Enterprise-Architect_JR001",
      company: "Acme Corp",
      location: "Amsterdam, Netherlands",
      source: "workday-browser",
      sourceKind: "structured",
    });
  });

  it("filters out CXS postings with no externalPath", async () => {
    const { page, evaluate } = fakePage();
    const { browser } = fakeBrowser(page);
    const launchFn: ListingLaunchFn = vi.fn().mockResolvedValue(browser);
    const provider = createWorkdayBrowserProvider(launchFn, fakePublicResolve());

    evaluate.mockResolvedValueOnce({
      jobPostings: [{ title: "No Path" }, { title: "Has Path", externalPath: "/job/1" }],
    });
    const result = await provider.fetch(ACME_TARGET, UNUSED_CTX);
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Has Path");
  });

  it("paginates via CXS offsets until a short page signals the end", async () => {
    const { page, waitForTimeout, evaluate } = fakePage();
    const { browser } = fakeBrowser(page);
    const launchFn: ListingLaunchFn = vi.fn().mockResolvedValue(browser);
    const provider = createWorkdayBrowserProvider(launchFn, fakePublicResolve());

    const fullPage = {
      jobPostings: Array.from({ length: 20 }, (_, i) => ({
        title: `Role ${i}`,
        externalPath: `/job/${i}`,
        locationsText: "Remote",
      })),
    };
    const shortPage = {
      jobPostings: Array.from({ length: 3 }, (_, i) => ({
        title: `Role ${20 + i}`,
        externalPath: `/job/${20 + i}`,
        locationsText: "Remote",
      })),
    };
    evaluate.mockResolvedValueOnce(fullPage).mockResolvedValueOnce(shortPage);

    const result = await provider.fetch(ACME_TARGET, UNUSED_CTX);
    expect(result).toHaveLength(23);
    expect(evaluate).toHaveBeenCalledTimes(2);

    // At least two waitForTimeout calls: SETTLE_MS + POLITENESS_DELAY_MS.
    const delayCalls = waitForTimeout.mock.calls.filter(
      (call) => (call[0] as number) === 2_000,
    );
    expect(delayCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("stops at MAX_PAGES and emits a truncation warn on stderr", async () => {
    const { page, evaluate } = fakePage();
    const { browser } = fakeBrowser(page);
    const launchFn: ListingLaunchFn = vi.fn().mockResolvedValue(browser);
    const provider = createWorkdayBrowserProvider(launchFn, fakePublicResolve());

    const fullPage = {
      jobPostings: Array.from({ length: 20 }, (_, i) => ({
        title: `Role ${i}`,
        externalPath: `/job/${i}`,
      })),
    };
    for (let i = 0; i < 20; i++) {
      evaluate.mockResolvedValueOnce(fullPage);
    }

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await provider.fetch(ACME_TARGET, UNUSED_CTX);
      const warnings = stderrSpy.mock.calls.map((c) => c[0]).join("");
      expect(warnings).toMatch(/hit MAX_PAGES/);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("emits a never-silent warn when 0 postings are returned", async () => {
    const { page, evaluate } = fakePage();
    const { browser } = fakeBrowser(page);
    const launchFn: ListingLaunchFn = vi.fn().mockResolvedValue(browser);
    const provider = createWorkdayBrowserProvider(launchFn, fakePublicResolve());

    evaluate.mockResolvedValueOnce({ jobPostings: [] });

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const result = await provider.fetch(ACME_TARGET, UNUSED_CTX);
      expect(result).toHaveLength(0);
      const warnings = stderrSpy.mock.calls.map((c) => c[0]).join("");
      expect(warnings).toMatch(/0 postings fetched/);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("closes the page in the finally block even when goto throws", async () => {
    const { page, goto, close } = fakePage();
    const { browser } = fakeBrowser(page);
    const launchFn: ListingLaunchFn = vi.fn().mockResolvedValue(browser);
    const provider = createWorkdayBrowserProvider(launchFn, fakePublicResolve());

    goto.mockRejectedValueOnce(new Error("Navigation timeout"));
    await expect(provider.fetch(ACME_TARGET, UNUSED_CTX)).rejects.toThrow("Navigation timeout");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("emits a warn on stderr when the listing page returns a non-2xx status and continues extraction", async () => {
    const { page, evaluate } = fakePage({ gotoStatus: 403 });
    const { browser } = fakeBrowser(page);
    const launchFn: ListingLaunchFn = vi.fn().mockResolvedValue(browser);
    const provider = createWorkdayBrowserProvider(launchFn, fakePublicResolve());

    // CXS returns empty so fetch completes gracefully without further mocks.
    evaluate.mockResolvedValueOnce({ jobPostings: [] });

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const result = await provider.fetch(ACME_TARGET, UNUSED_CTX);
      expect(result).toHaveLength(0);
      const output = stderrSpy.mock.calls.map((c) => c[0]).join("");
      expect(output).toMatch(/listing page returned HTTP 403/);
      expect(output).toMatch(/attempting extraction anyway/);
    } finally {
      stderrSpy.mockRestore();
    }
  });
});

describe("createWorkdayBrowserProvider — fetch (DOM fallback mode)", () => {
  it("falls back to DOM extraction when in-page CXS throws", async () => {
    const { page, evaluate } = fakePage();
    const { browser } = fakeBrowser(page);
    const launchFn: ListingLaunchFn = vi.fn().mockResolvedValue(browser);
    const provider = createWorkdayBrowserProvider(launchFn, fakePublicResolve());

    // First evaluate call (CXS) throws; second returns DOM items; third
    // (pagination check) returns false → last page.
    evaluate
      .mockRejectedValueOnce(new Error("CXS: 403"))
      .mockResolvedValueOnce([
        {
          title: "Director of Architecture",
          href: "https://acme.wd3.myworkdayjobs.com/en-US/AcmeCareers/job/1",
          location: "Amsterdam",
        },
      ])
      .mockResolvedValueOnce(false);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const result = await provider.fetch(ACME_TARGET, UNUSED_CTX);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        title: "Director of Architecture",
        source: "workday-browser",
      });
      const info = stderrSpy.mock.calls.map((c) => c[0]).join("");
      expect(info).toMatch(/in-page CXS failed/);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("paginates via DOM next-button clicks until hasNext returns false", async () => {
    const { page, evaluate, waitForTimeout } = fakePage();
    const { browser } = fakeBrowser(page);
    const launchFn: ListingLaunchFn = vi.fn().mockResolvedValue(browser);
    const provider = createWorkdayBrowserProvider(launchFn, fakePublicResolve());

    const item = (n: number) => ({
      title: `Role ${n}`,
      href: `https://acme.wd3.myworkdayjobs.com/en-US/AcmeCareers/job/${n}`,
      location: "Amsterdam",
    });

    evaluate
      .mockRejectedValueOnce(new Error("CXS: 403")) // CXS fails
      .mockResolvedValueOnce([item(1), item(2)]) // DOM page 1
      .mockResolvedValueOnce(true) // pagination → has next
      .mockResolvedValueOnce([item(3)]) // DOM page 2
      .mockResolvedValueOnce(false); // pagination → no next

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const result = await provider.fetch(ACME_TARGET, UNUSED_CTX);
      expect(result).toHaveLength(3);
      // Politeness delay called at least twice: SETTLE_MS + 1x DOM pagination.
      const delayCalls = waitForTimeout.mock.calls.filter(
        (call) => (call[0] as number) === 2_000,
      );
      expect(delayCalls.length).toBeGreaterThanOrEqual(2);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("stops at MAX_PAGES in DOM mode and emits a truncation warn on stderr", async () => {
    const { page, evaluate } = fakePage();
    const { browser } = fakeBrowser(page);
    const launchFn: ListingLaunchFn = vi.fn().mockResolvedValue(browser);
    const provider = createWorkdayBrowserProvider(launchFn, fakePublicResolve());

    // CXS fails → DOM fallback. Each of the 20 iterations calls evaluate twice:
    // once for DOM items and once for the pagination button. Always returning
    // true for hasNext ensures the loop never self-terminates, so it runs all
    // MAX_PAGES iterations and sets hitCap = true.
    evaluate.mockRejectedValueOnce(new Error("CXS: 403"));
    for (let i = 0; i < 20; i++) {
      evaluate.mockResolvedValueOnce([]); // DOM items (empty is fine)
      evaluate.mockResolvedValueOnce(true); // pagination → always has next
    }

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await provider.fetch(ACME_TARGET, UNUSED_CTX);
      const output = stderrSpy.mock.calls.map((c) => c[0]).join("");
      expect(output).toMatch(/hit MAX_PAGES/);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("resets partial CXS results before falling back to DOM", async () => {
    // CXS page 1 succeeds (20 items), then page 2 throws.
    // DOM extraction starts fresh — the 20 partial CXS items must not appear.
    const { page, evaluate } = fakePage();
    const { browser } = fakeBrowser(page);
    const launchFn: ListingLaunchFn = vi.fn().mockResolvedValue(browser);
    const provider = createWorkdayBrowserProvider(launchFn, fakePublicResolve());

    const partialCxs = {
      jobPostings: Array.from({ length: 20 }, (_, i) => ({
        title: `CXS Role ${i}`,
        externalPath: `/job/cxs-${i}`,
        locationsText: "Remote",
      })),
    };

    evaluate
      .mockResolvedValueOnce(partialCxs) // CXS page 1 succeeds
      .mockRejectedValueOnce(new Error("CXS: 500")) // CXS page 2 throws
      .mockResolvedValueOnce([
        {
          title: "DOM Role",
          href: "https://acme.wd3.myworkdayjobs.com/en-US/AcmeCareers/job/dom-1",
          location: "Amsterdam",
        },
      ])
      .mockResolvedValueOnce(false); // DOM pagination → no next

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const result = await provider.fetch(ACME_TARGET, UNUSED_CTX);
      // Only the 1 DOM result — the 20 CXS partial items must be cleared.
      expect(result).toHaveLength(1);
      expect(result[0]?.title).toBe("DOM Role");
    } finally {
      stderrSpy.mockRestore();
    }
  });
});

describe("createWorkdayBrowserProvider — SSRF guards", () => {
  it("rejects a non-https careersUrl before navigating", async () => {
    // The URL parser (resolveEndpoint) requires https:// in its regex, so an
    // http:// URL is caught at the parse step — "cannot parse" IS the SSRF
    // rejection; the browser is never launched.
    const { page, goto } = fakePage();
    const { browser } = fakeBrowser(page);
    const launchFn: ListingLaunchFn = vi.fn().mockResolvedValue(browser);
    const provider = createWorkdayBrowserProvider(launchFn, fakePublicResolve());

    await expect(
      provider.fetch(
        { ...ACME_TARGET, careersUrl: "http://acme.wd3.myworkdayjobs.com/AcmeCareers" },
        UNUSED_CTX,
      ),
    ).rejects.toThrow(/cannot parse careersUrl/);
    expect(goto).not.toHaveBeenCalled();
  });

  it("rejects when DNS resolution returns a private address", async () => {
    const { page, goto } = fakePage();
    const { browser } = fakeBrowser(page);
    const launchFn: ListingLaunchFn = vi.fn().mockResolvedValue(browser);
    const privateResolve: ResolveFn = vi.fn().mockResolvedValue([
      { address: "10.0.0.5", family: 4 },
    ]);
    const provider = createWorkdayBrowserProvider(launchFn, privateResolve);

    await expect(provider.fetch(ACME_TARGET, UNUSED_CTX)).rejects.toThrow(
      /private\/reserved address/,
    );
    expect(goto).not.toHaveBeenCalled();
  });

  it("rejects when navigation redirects off-host", async () => {
    const { page } = fakePage({ urlReturn: "https://evil.example/hijacked" });
    const { browser } = fakeBrowser(page);
    const launchFn: ListingLaunchFn = vi.fn().mockResolvedValue(browser);
    const provider = createWorkdayBrowserProvider(launchFn, fakePublicResolve());

    await expect(provider.fetch(ACME_TARGET, UNUSED_CTX)).rejects.toThrow(
      /redirected off-host/,
    );
  });

  it("keeps CXS postings on the same myworkdayjobs.com host", async () => {
    const { page, evaluate } = fakePage();
    const { browser } = fakeBrowser(page);
    const launchFn: ListingLaunchFn = vi.fn().mockResolvedValue(browser);
    const provider = createWorkdayBrowserProvider(launchFn, fakePublicResolve());

    evaluate.mockResolvedValueOnce({
      jobPostings: [{ title: "Legit", externalPath: "/job/1", locationsText: "" }],
    });
    const result = await provider.fetch(ACME_TARGET, UNUSED_CTX);
    // jobBase + externalPath stays on acme.wd3.myworkdayjobs.com → kept.
    expect(result).toHaveLength(1);
  });

  it("drops DOM items whose href is on an unexpected host", async () => {
    const { page, evaluate } = fakePage();
    const { browser } = fakeBrowser(page);
    const launchFn: ListingLaunchFn = vi.fn().mockResolvedValue(browser);
    const provider = createWorkdayBrowserProvider(launchFn, fakePublicResolve());

    evaluate
      .mockRejectedValueOnce(new Error("CXS: 403"))
      .mockResolvedValueOnce([
        // Same host → kept
        {
          title: "Good",
          href: "https://acme.wd3.myworkdayjobs.com/en-US/AcmeCareers/job/1",
          location: "",
        },
        // Different host → dropped
        { title: "Bad", href: "https://evil.example/phish", location: "" },
      ])
      .mockResolvedValueOnce(false);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const result = await provider.fetch(ACME_TARGET, UNUSED_CTX);
      expect(result).toHaveLength(1);
      expect(result[0]?.title).toBe("Good");
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("throws when careersUrl cannot be parsed (no endpoint derivable)", async () => {
    const { browser } = fakeBrowser(fakePage().page);
    const launchFn: ListingLaunchFn = vi.fn().mockResolvedValue(browser);
    const provider = createWorkdayBrowserProvider(launchFn, fakePublicResolve());

    await expect(
      provider.fetch({ company: "Acme", provider: "workday-browser" }, UNUSED_CTX),
    ).rejects.toThrow(/cannot parse careersUrl/);
  });
});

describe("createWorkdayBrowserProvider — close()", () => {
  it("is a no-op when the browser was never launched", async () => {
    const { browser, close } = fakeBrowser(fakePage().page);
    const launchFn: ListingLaunchFn = vi.fn().mockResolvedValue(browser);
    const provider = createWorkdayBrowserProvider(launchFn, fakePublicResolve());
    await provider.close();
    expect(close).not.toHaveBeenCalled();
  });

  it("closes the browser after a successful fetch", async () => {
    const { page, evaluate } = fakePage();
    const { browser, close } = fakeBrowser(page);
    const launchFn: ListingLaunchFn = vi.fn().mockResolvedValue(browser);
    const provider = createWorkdayBrowserProvider(launchFn, fakePublicResolve());

    evaluate.mockResolvedValueOnce({ jobPostings: [] });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await provider.fetch(ACME_TARGET, UNUSED_CTX);
    } finally {
      stderrSpy.mockRestore();
    }
    await provider.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("swallows a rejected launch in close() instead of re-throwing", async () => {
    const launchFn: ListingLaunchFn = vi.fn().mockRejectedValue(new Error("Executable not found"));
    const provider = createWorkdayBrowserProvider(launchFn, fakePublicResolve());
    // fetch() fails because launchFn rejects; close() must not re-throw.
    await expect(provider.fetch(ACME_TARGET, UNUSED_CTX)).rejects.toThrow("Executable not found");
    await expect(provider.close()).resolves.toBeUndefined();
  });

  it("swallows browser.close() errors after a completed fetch", async () => {
    const { page, evaluate } = fakePage();
    const { browser } = fakeBrowser(page);
    const failingClose = vi.fn().mockRejectedValue(new Error("Chromium crashed"));
    browser.close = failingClose;
    const launchFn: ListingLaunchFn = vi.fn().mockResolvedValue(browser);
    const provider = createWorkdayBrowserProvider(launchFn, fakePublicResolve());

    evaluate.mockResolvedValueOnce({ jobPostings: [] });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await provider.fetch(ACME_TARGET, UNUSED_CTX);
    } finally {
      stderrSpy.mockRestore();
    }
    await expect(provider.close()).resolves.toBeUndefined();
    expect(failingClose).toHaveBeenCalledTimes(1);
  });
});

describe("createWorkdayBrowserProvider — politeness delay", () => {
  it("applies a >=2s delay between CXS pagination requests", async () => {
    const { page, waitForTimeout, evaluate } = fakePage();
    const { browser } = fakeBrowser(page);
    const launchFn: ListingLaunchFn = vi.fn().mockResolvedValue(browser);
    const provider = createWorkdayBrowserProvider(launchFn, fakePublicResolve());

    const fullPage = {
      jobPostings: Array.from({ length: 20 }, (_, i) => ({
        title: `Role ${i}`,
        externalPath: `/job/${i}`,
      })),
    };
    // Two full pages → one politeness delay between them.
    evaluate.mockResolvedValueOnce(fullPage).mockResolvedValueOnce({ jobPostings: [] });

    await provider.fetch(ACME_TARGET, UNUSED_CTX);

    const delayValues = waitForTimeout.mock.calls.map(
      (call) => call[0] as number,
    );
    // At least one waitForTimeout call must be >=2000ms (POLITENESS_DELAY_MS).
    expect(delayValues.some((v) => v >= 2_000)).toBe(true);
  });
});
