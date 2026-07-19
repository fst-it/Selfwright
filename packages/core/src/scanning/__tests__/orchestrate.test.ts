import { describe, expect, it, vi } from "vitest";
import { runScan } from "../orchestrate.js";
import type { ScanFetchContext, ScanProvider } from "../../ports/scan-provider.js";
import type { Archetype } from "../../truth/schemas/index.js";
import type { RawPosting, ScanTarget, SeenEntry } from "../types.js";

const ARCHETYPES: Archetype[] = [
  {
    id: "enterprise-architect",
    related_titles: ["Director of Architecture"],
    match_keywords: ["enterprise architecture", "tech radar", "platform engineering"],
  },
];

function fakeCtx(overrides: Partial<ScanFetchContext> = {}): ScanFetchContext {
  return { fetchJson: vi.fn(), fetchText: vi.fn(), fetchRaw: vi.fn(), ...overrides };
}

function fakeProvider(postings: RawPosting[], id = "fake"): ScanProvider {
  return {
    id,
    detect: () => ({ url: "https://example.test" }),
    fetch: vi.fn().mockResolvedValue(postings),
  };
}

const LIVE_MATCHING: RawPosting = {
  url: "https://a.example/1",
  title: "Director of Architecture",
  company: "Acme",
  location: "Amsterdam, NL",
  description: "Own enterprise architecture, the tech radar and platform engineering. Apply now.",
  source: "fake",
  fetchedAt: "2026-07-03T00:00:00.000Z",
};

describe("runScan", () => {
  it("fetches, scores, and queues a new live matching posting", async () => {
    const target: ScanTarget = { company: "Acme", provider: "fake" };
    const result = await runScan({
      targets: [target],
      providers: { fake: fakeProvider([LIVE_MATCHING]) },
      ctx: fakeCtx(),
      archetypes: ARCHETYPES,
      synonymMap: new Map(),
      seen: [],
      queue: [],
      now: "2026-07-03T12:00:00.000Z",
    });
    expect(result.stats.fetched).toBe(1);
    expect(result.stats.queued).toBe(1);
    expect(result.stats.expired).toBe(0);
    expect(result.queue).toHaveLength(1);
    expect(result.seen).toHaveLength(1);
    expect(result.seen[0]?.status).toBe("live");
  });

  it("does not re-queue a posting whose URL is already in the seen ledger", async () => {
    const target: ScanTarget = { company: "Acme", provider: "fake" };
    const seen: SeenEntry[] = [{ url: LIVE_MATCHING.url, firstSeen: "2026-01-01", source: "fake", status: "live" }];
    const result = await runScan({
      targets: [target],
      providers: { fake: fakeProvider([LIVE_MATCHING]) },
      ctx: fakeCtx(),
      archetypes: ARCHETYPES,
      synonymMap: new Map(),
      seen,
      queue: [],
      now: "2026-07-03T12:00:00.000Z",
    });
    expect(result.stats.alreadySeen).toBe(1);
    expect(result.stats.queued).toBe(0);
    expect(result.queue).toHaveLength(0);
  });

  it("marks an expired posting as seen but does not queue it", async () => {
    const expiredPosting: RawPosting = {
      ...LIVE_MATCHING,
      url: "https://a.example/2",
      description: "This job posting has expired. No longer accepting applications.",
    };
    const target: ScanTarget = { company: "Acme", provider: "fake" };
    const result = await runScan({
      targets: [target],
      providers: { fake: fakeProvider([expiredPosting]) },
      ctx: fakeCtx(),
      archetypes: ARCHETYPES,
      synonymMap: new Map(),
      seen: [],
      queue: [],
      now: "2026-07-03T12:00:00.000Z",
    });
    expect(result.stats.expired).toBe(1);
    expect(result.stats.queued).toBe(0);
    expect(result.seen).toHaveLength(1);
    expect(result.seen[0]?.status).toBe("expired");
  });

  it("does not queue a posting that doesn't clear the non-degeneracy floor (no archetype match)", async () => {
    const unrelated: RawPosting = {
      ...LIVE_MATCHING,
      url: "https://a.example/3",
      title: "Barista",
      description: "Make coffee and serve customers. Apply now.",
    };
    const target: ScanTarget = { company: "Acme", provider: "fake" };
    const result = await runScan({
      targets: [target],
      providers: { fake: fakeProvider([unrelated]) },
      ctx: fakeCtx(),
      archetypes: ARCHETYPES,
      synonymMap: new Map(),
      seen: [],
      queue: [],
      now: "2026-07-03T12:00:00.000Z",
    });
    expect(result.stats.queued).toBe(0);
    // Still recorded in the seen ledger even though it's never queued.
    expect(result.seen).toHaveLength(1);
  });

  it("records a provider error and continues scanning remaining targets", async () => {
    const failingProvider: ScanProvider = {
      id: "failing",
      detect: () => null,
      fetch: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const targets: ScanTarget[] = [
      { company: "Broken Co", provider: "failing" },
      { company: "Acme", provider: "fake" },
    ];
    const result = await runScan({
      targets,
      providers: { failing: failingProvider, fake: fakeProvider([LIVE_MATCHING]) },
      ctx: fakeCtx(),
      archetypes: ARCHETYPES,
      synonymMap: new Map(),
      seen: [],
      queue: [],
      now: "2026-07-03T12:00:00.000Z",
    });
    expect(result.stats.providerErrors).toHaveLength(1);
    expect(result.stats.providerErrors[0]).toContain("Broken Co");
    expect(result.stats.fetched).toBe(1);
    expect(result.stats.queued).toBe(1);
  });

  it("reports an unknown provider name as an error without throwing", async () => {
    const target: ScanTarget = { company: "Acme", provider: "does-not-exist" };
    const result = await runScan({
      targets: [target],
      providers: {},
      ctx: fakeCtx(),
      archetypes: ARCHETYPES,
      synonymMap: new Map(),
      seen: [],
      queue: [],
      now: "2026-07-03T12:00:00.000Z",
    });
    expect(result.stats.providerErrors[0]).toContain("does-not-exist");
    expect(result.stats.fetched).toBe(0);
  });

  it("re-verifies an 'uncertain' posting via ctx.fetchRendered and upgrades the verdict", async () => {
    const uncertain: RawPosting = {
      ...LIVE_MATCHING,
      url: "https://a.example/4",
      description:
        "Own enterprise architecture, the tech radar and platform engineering across a large, " +
        "federated organisation. Partner with senior stakeholders to define technology direction " +
        "for the next several years, and lead distributed engineering teams through complex " +
        "platform migrations spanning multiple business units and geographies.",
    };
    const fetchRendered = vi
      .fn()
      .mockResolvedValue({ status: 200, text: "Apply now to join our team.", finalUrl: uncertain.url });
    const target: ScanTarget = { company: "Acme", provider: "fake" };
    const result = await runScan({
      targets: [target],
      providers: { fake: fakeProvider([uncertain]) },
      ctx: fakeCtx({ fetchRendered }),
      archetypes: ARCHETYPES,
      synonymMap: new Map(),
      seen: [],
      queue: [],
      now: "2026-07-09T00:00:00.000Z",
    });
    expect(fetchRendered).toHaveBeenCalledWith(uncertain.url);
    expect(result.stats.browserVerified).toBe(1);
    expect(result.seen[0]?.status).toBe("live");
    expect(result.stats.queued).toBe(1);
  });

  it("re-verifies an 'uncertain' posting and downgrades to expired via the rendered page", async () => {
    const uncertain: RawPosting = {
      ...LIVE_MATCHING,
      url: "https://a.example/6",
      description:
        "Own enterprise architecture, the tech radar and platform engineering across a large, " +
        "federated organisation. Partner with senior stakeholders to define technology direction " +
        "for the next several years, and lead distributed engineering teams through complex " +
        "platform migrations spanning multiple business units and geographies.",
    };
    const fetchRendered = vi.fn().mockResolvedValue({
      status: 200,
      text: "This job posting has expired. No longer accepting applications.",
      finalUrl: uncertain.url,
    });
    const target: ScanTarget = { company: "Acme", provider: "fake" };
    const result = await runScan({
      targets: [target],
      providers: { fake: fakeProvider([uncertain]) },
      ctx: fakeCtx({ fetchRendered }),
      archetypes: ARCHETYPES,
      synonymMap: new Map(),
      seen: [],
      queue: [],
      now: "2026-07-09T00:00:00.000Z",
    });
    expect(result.stats.browserVerified).toBe(1);
    expect(result.seen[0]?.status).toBe("expired");
    expect(result.stats.expired).toBe(1);
    expect(result.stats.queued).toBe(0);
  });

  it("does not call fetchRendered for a posting that already classified as live", async () => {
    const fetchRendered = vi.fn();
    const target: ScanTarget = { company: "Acme", provider: "fake" };
    const result = await runScan({
      targets: [target],
      providers: { fake: fakeProvider([LIVE_MATCHING]) },
      ctx: fakeCtx({ fetchRendered }),
      archetypes: ARCHETYPES,
      synonymMap: new Map(),
      seen: [],
      queue: [],
      now: "2026-07-09T00:00:00.000Z",
    });
    expect(fetchRendered).not.toHaveBeenCalled();
    expect(result.stats.browserVerified).toBe(0);
  });

  it("keeps the original 'uncertain' verdict and records a warning when fetchRendered throws", async () => {
    const uncertain: RawPosting = {
      ...LIVE_MATCHING,
      url: "https://a.example/5",
      description:
        "Own enterprise architecture, the tech radar and platform engineering across a large, " +
        "federated organisation. Partner with senior stakeholders to define technology direction " +
        "for the next several years, and lead distributed engineering teams through complex " +
        "platform migrations spanning multiple business units and geographies.",
    };
    const fetchRendered = vi.fn().mockRejectedValue(new Error("navigation timeout"));
    const target: ScanTarget = { company: "Acme", provider: "fake" };
    const result = await runScan({
      targets: [target],
      providers: { fake: fakeProvider([uncertain]) },
      ctx: fakeCtx({ fetchRendered }),
      archetypes: ARCHETYPES,
      synonymMap: new Map(),
      seen: [],
      queue: [],
      now: "2026-07-09T00:00:00.000Z",
    });
    expect(result.stats.browserVerified).toBe(1);
    expect(result.seen[0]?.status).toBe("uncertain");
    expect(result.stats.providerErrors[0]).toContain("browser-verify");
    expect(result.stats.providerErrors[0]).toContain("navigation timeout");
  });

  it("excludes a posting from queue when it matches an existing application (company + fuzzy role)", async () => {
    const target: ScanTarget = { company: "Acme", provider: "fake" };
    const result = await runScan({
      targets: [target],
      providers: { fake: fakeProvider([LIVE_MATCHING]) },
      ctx: fakeCtx(),
      archetypes: ARCHETYPES,
      synonymMap: new Map(),
      seen: [],
      queue: [],
      now: "2026-07-11T00:00:00.000Z",
      existingApplications: [{ company: "Acme", role: "Director of Architecture" }],
    });
    // Still recorded in seen (always) but NOT queued.
    expect(result.seen).toHaveLength(1);
    expect(result.stats.queued).toBe(0);
    expect(result.queue).toHaveLength(0);
  });

  it("still queues a posting when the existing application role is a near-miss below Jaccard threshold", async () => {
    const target: ScanTarget = { company: "Acme", provider: "fake" };
    // "Barista" shares no tokens with "Director of Architecture" → Jaccard = 0
    const result = await runScan({
      targets: [target],
      providers: { fake: fakeProvider([LIVE_MATCHING]) },
      ctx: fakeCtx(),
      archetypes: ARCHETYPES,
      synonymMap: new Map(),
      seen: [],
      queue: [],
      now: "2026-07-11T00:00:00.000Z",
      existingApplications: [{ company: "Acme", role: "Barista" }],
    });
    expect(result.stats.queued).toBe(1);
    expect(result.queue).toHaveLength(1);
  });

  it("handles undefined existingApplications gracefully (same as empty cross-dedup list)", async () => {
    const target: ScanTarget = { company: "Acme", provider: "fake" };
    const result = await runScan({
      targets: [target],
      providers: { fake: fakeProvider([LIVE_MATCHING]) },
      ctx: fakeCtx(),
      archetypes: ARCHETYPES,
      synonymMap: new Map(),
      seen: [],
      queue: [],
      now: "2026-07-11T00:00:00.000Z",
      // omitting existingApplications entirely — must not crash and must queue normally
    });
    expect(result.stats.queued).toBe(1);
  });

  it("does not mutate the input seen/queue arrays", async () => {
    const target: ScanTarget = { company: "Acme", provider: "fake" };
    const inputSeen: SeenEntry[] = [];
    const inputQueue: import("../../services/types.js").QueueEntry[] = [];
    await runScan({
      targets: [target],
      providers: { fake: fakeProvider([LIVE_MATCHING]) },
      ctx: fakeCtx(),
      archetypes: ARCHETYPES,
      synonymMap: new Map(),
      seen: inputSeen,
      queue: inputQueue,
      now: "2026-07-03T12:00:00.000Z",
    });
    expect(inputSeen).toHaveLength(0);
    expect(inputQueue).toHaveLength(0);
  });
});
