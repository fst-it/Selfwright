import { describe, expect, it, vi } from "vitest";
import { isStaleEntry, partitionQueueByAge, backfillQueuedAt, DEFAULT_AGING_WINDOW_DAYS } from "../queue-aging.js";
import { runScan } from "../orchestrate.js";
import type { QueueEntry } from "../types.js";
import type { ScanFetchContext, ScanProvider } from "../../ports/scan-provider.js";
import type { Archetype } from "../../truth/schemas/index.js";
import type { RawPosting, SeenEntry } from "../types.js";
import { hashUrl } from "../queue-entry.js";

// ── fixtures ─────────────────────────────────────────────────────────────────

const WINDOW = 30;
const AS_OF = new Date("2026-08-01T12:00:00.000Z");

function daysAgo(n: number, base: Date = AS_OF): string {
  const d = new Date(base);
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function entry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    id: "SCAN-test",
    company: "Acme",
    derived_role: "Director of Architecture",
    fit_score: 4.0,
    ...overrides,
  };
}

// ── isStaleEntry — boundary cases ─────────────────────────────────────────────

describe("isStaleEntry — 30-day boundary", () => {
  it("29 days old → not stale", () => {
    expect(
      isStaleEntry(entry({ queuedAt: daysAgo(29) }), WINDOW, AS_OF),
    ).toBe(false);
  });

  it("exactly 30 days old → not stale (boundary is exclusive: > not >=)", () => {
    // 30 days * 86_400_000 ms exactly = boundary; > comparison means it is not stale
    expect(
      isStaleEntry(entry({ queuedAt: daysAgo(30) }), WINDOW, AS_OF),
    ).toBe(false);
  });

  it("30 days + 1 second → stale", () => {
    const ts = new Date(AS_OF.getTime() - WINDOW * 86_400_000 - 1000).toISOString();
    expect(isStaleEntry(entry({ queuedAt: ts }), WINDOW, AS_OF)).toBe(true);
  });

  it("31 days old → stale", () => {
    expect(
      isStaleEntry(entry({ queuedAt: daysAgo(31) }), WINDOW, AS_OF),
    ).toBe(true);
  });
});

// ── isStaleEntry — lastSeenAt overrides queuedAt ─────────────────────────────

describe("isStaleEntry — lastSeenAt refresh", () => {
  it("queuedAt is 60 days ago but lastSeenAt is 1 day ago → not stale", () => {
    expect(
      isStaleEntry(
        entry({ queuedAt: daysAgo(60), lastSeenAt: daysAgo(1) }),
        WINDOW,
        AS_OF,
      ),
    ).toBe(false);
  });

  it("lastSeenAt is 31 days ago (even if queuedAt is recent) → stale", () => {
    expect(
      isStaleEntry(
        entry({ queuedAt: daysAgo(5), lastSeenAt: daysAgo(31) }),
        WINDOW,
        AS_OF,
      ),
    ).toBe(true);
  });

  it("lastSeenAt absent, queuedAt is 31 days ago → stale", () => {
    expect(
      isStaleEntry(entry({ queuedAt: daysAgo(31) }), WINDOW, AS_OF),
    ).toBe(true);
  });
});

// ── isStaleEntry — legacy entries (no timestamp) ─────────────────────────────

describe("isStaleEntry — backward compatibility", () => {
  it("entry with no queuedAt and no lastSeenAt → not stale (legacy backward compat)", () => {
    expect(isStaleEntry(entry(), WINDOW, AS_OF)).toBe(false);
  });

  it("entry with malformed queuedAt timestamp → not stale", () => {
    expect(
      isStaleEntry(entry({ queuedAt: "not-a-date" }), WINDOW, AS_OF),
    ).toBe(false);
  });
});

// ── partitionQueueByAge ───────────────────────────────────────────────────────

describe("partitionQueueByAge", () => {
  it("separates active from stale entries", () => {
    const entries: QueueEntry[] = [
      entry({ id: "a", queuedAt: daysAgo(5) }),   // active
      entry({ id: "b", queuedAt: daysAgo(31) }),  // stale
      entry({ id: "c" }),                          // legacy → active
      entry({ id: "d", queuedAt: daysAgo(29) }),  // active
    ];
    const { active, stale } = partitionQueueByAge(entries, WINDOW, AS_OF);
    expect(active.map((e) => e.id)).toEqual(["a", "c", "d"]);
    expect(stale.map((e) => e.id)).toEqual(["b"]);
  });

  it("all active → stale is empty array", () => {
    const entries = [entry({ id: "x", queuedAt: daysAgo(1) })];
    const { stale } = partitionQueueByAge(entries, WINDOW, AS_OF);
    expect(stale).toHaveLength(0);
  });

  it("empty queue → both partitions empty", () => {
    const { active, stale } = partitionQueueByAge([], WINDOW, AS_OF);
    expect(active).toHaveLength(0);
    expect(stale).toHaveLength(0);
  });
});

// ── DEFAULT_AGING_WINDOW_DAYS ─────────────────────────────────────────────────

describe("DEFAULT_AGING_WINDOW_DAYS", () => {
  it("is 30", () => {
    expect(DEFAULT_AGING_WINDOW_DAYS).toBe(30);
  });
});

// ── runScan: refresh-on-rescan (T5.5) ─────────────────────────────────────────

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

const POSTING_URL = "https://acme.example/jobs/1";
const LIVE_POSTING: RawPosting = {
  url: POSTING_URL,
  title: "Director of Architecture",
  company: "Acme",
  location: "Amsterdam, NL",
  description: "Own enterprise architecture, the tech radar and platform engineering. Apply now.",
  source: "fake",
  fetchedAt: "2026-08-01T00:00:00.000Z",
};

describe("runScan — refresh-on-rescan (T5.5)", () => {
  it("re-encountered already-queued URL refreshes lastSeenAt on the queue entry", async () => {
    const expectedId = `SCAN-${hashUrl(POSTING_URL)}`;
    const seenAt = "2026-06-01T00:00:00.000Z"; // queued 60 days ago
    const existing: SeenEntry[] = [
      { url: POSTING_URL, firstSeen: seenAt, source: "fake", status: "live" },
    ];
    const existingQueue: QueueEntry[] = [
      {
        id: expectedId,
        company: "Acme",
        derived_role: "Director of Architecture",
        fit_score: 4.0,
        queuedAt: seenAt,
      },
    ];

    const now = "2026-08-01T12:00:00.000Z";
    const result = await runScan({
      targets: [{ company: "Acme", provider: "fake" }],
      providers: { fake: fakeProvider([LIVE_POSTING]) },
      ctx: fakeCtx(),
      archetypes: ARCHETYPES,
      synonymMap: new Map(),
      seen: existing,
      queue: existingQueue,
      now,
    });

    // Posting was already seen → not re-queued.
    expect(result.stats.alreadySeen).toBe(1);
    expect(result.stats.queued).toBe(0);
    // But the existing queue entry must have lastSeenAt updated.
    const refreshed = result.queue.find((q) => q.id === expectedId);
    expect(refreshed).toBeDefined();
    expect(refreshed?.lastSeenAt).toBe(now);
    // queuedAt must not be changed.
    expect(refreshed?.queuedAt).toBe(seenAt);
  });

  it("already-seen URL with no matching queue entry does not crash", async () => {
    const existing: SeenEntry[] = [
      { url: POSTING_URL, firstSeen: "2026-06-01", source: "fake", status: "live" },
    ];
    // queue is empty — no entry to refresh
    const result = await runScan({
      targets: [{ company: "Acme", provider: "fake" }],
      providers: { fake: fakeProvider([LIVE_POSTING]) },
      ctx: fakeCtx(),
      archetypes: ARCHETYPES,
      synonymMap: new Map(),
      seen: existing,
      queue: [],
      now: "2026-08-01T12:00:00.000Z",
    });
    expect(result.stats.alreadySeen).toBe(1);
    expect(result.queue).toHaveLength(0);
  });

  it("new posting gets queuedAt set to now", async () => {
    const now = "2026-08-01T12:00:00.000Z";
    const result = await runScan({
      targets: [{ company: "Acme", provider: "fake" }],
      providers: { fake: fakeProvider([LIVE_POSTING]) },
      ctx: fakeCtx(),
      archetypes: ARCHETYPES,
      synonymMap: new Map(),
      seen: [],
      queue: [],
      now,
    });
    expect(result.stats.queued).toBe(1);
    expect(result.queue[0]?.queuedAt).toBe(now);
  });

  it("does not mutate the input queue when refreshing lastSeenAt", async () => {
    const expectedId = `SCAN-${hashUrl(POSTING_URL)}`;
    const inputQueue: QueueEntry[] = [
      { id: expectedId, company: "Acme", queuedAt: "2026-06-01T00:00:00.000Z" },
    ];
    const seen: SeenEntry[] = [
      { url: POSTING_URL, firstSeen: "2026-06-01", source: "fake", status: "live" },
    ];
    await runScan({
      targets: [{ company: "Acme", provider: "fake" }],
      providers: { fake: fakeProvider([LIVE_POSTING]) },
      ctx: fakeCtx(),
      archetypes: ARCHETYPES,
      synonymMap: new Map(),
      seen,
      queue: inputQueue,
      now: "2026-08-01T12:00:00.000Z",
    });
    // The original input array must not have been mutated.
    expect(inputQueue[0]?.lastSeenAt).toBeUndefined();
  });
});

// ── config window honored ─────────────────────────────────────────────────────

describe("isStaleEntry — custom window", () => {
  it("10-day window: 11-day-old entry is stale", () => {
    expect(isStaleEntry(entry({ queuedAt: daysAgo(11) }), 10, AS_OF)).toBe(true);
  });

  it("10-day window: 9-day-old entry is not stale", () => {
    expect(isStaleEntry(entry({ queuedAt: daysAgo(9) }), 10, AS_OF)).toBe(false);
  });
});

// ── runScan — MAN- entry refresh (MAJOR 1 fix) ───────────────────────────────

describe("runScan — MAN- entry refresh", () => {
  it("re-encountered URL with MAN-<hash> queue entry refreshes lastSeenAt", async () => {
    const manId = `MAN-${hashUrl(POSTING_URL)}`;
    const queuedAt = "2026-06-01T00:00:00.000Z";
    const existingSeen: SeenEntry[] = [
      { url: POSTING_URL, firstSeen: queuedAt, source: "manual", status: "live" },
    ];
    const existingQueue: QueueEntry[] = [
      {
        id: manId,
        company: "Acme",
        derived_role: "Director of Architecture",
        fit_score: 4.0,
        source: "manual",
        queuedAt,
      },
    ];

    const now = "2026-08-01T12:00:00.000Z";
    const result = await runScan({
      targets: [{ company: "Acme", provider: "fake" }],
      providers: { fake: fakeProvider([LIVE_POSTING]) },
      ctx: fakeCtx(),
      archetypes: ARCHETYPES,
      synonymMap: new Map(),
      seen: existingSeen,
      queue: existingQueue,
      now,
    });

    // Posting was already seen → not re-queued.
    expect(result.stats.alreadySeen).toBe(1);
    expect(result.stats.queued).toBe(0);
    // The MAN- entry must have lastSeenAt updated.
    const refreshed = result.queue.find((q) => q.id === manId);
    expect(refreshed).toBeDefined();
    expect(refreshed?.lastSeenAt).toBe(now);
    // queuedAt and source must be unchanged.
    expect(refreshed?.queuedAt).toBe(queuedAt);
    expect(refreshed?.source).toBe("manual");
  });
});

// ── backfillQueuedAt (MAJOR 3) ───────────────────────────────────────────────

describe("backfillQueuedAt", () => {
  const BACKFILL_NOW = "2026-08-01T00:00:00.000Z";
  const FIRST_SEEN = "2026-05-01T00:00:00.000Z";

  it("stamps missing queuedAt from seen-ledger firstSeen when URL matches", () => {
    const q: QueueEntry[] = [
      { id: `SCAN-${hashUrl(POSTING_URL)}`, company: "Acme" },
    ];
    const s: SeenEntry[] = [
      { url: POSTING_URL, firstSeen: FIRST_SEEN, source: "fake", status: "live" },
    ];
    const result = backfillQueuedAt(q, s, BACKFILL_NOW);
    expect(result[0]?.queuedAt).toBe(FIRST_SEEN);
  });

  it("falls back to now when no seen entry matches", () => {
    const q: QueueEntry[] = [
      { id: `SCAN-${hashUrl(POSTING_URL)}`, company: "Acme" },
    ];
    const result = backfillQueuedAt(q, [], BACKFILL_NOW);
    expect(result[0]?.queuedAt).toBe(BACKFILL_NOW);
  });

  it("does not overwrite an existing queuedAt", () => {
    const original = "2026-04-01T00:00:00.000Z";
    const q: QueueEntry[] = [
      { id: `SCAN-${hashUrl(POSTING_URL)}`, company: "Acme", queuedAt: original },
    ];
    const s: SeenEntry[] = [
      { url: POSTING_URL, firstSeen: FIRST_SEEN, source: "fake", status: "live" },
    ];
    const result = backfillQueuedAt(q, s, BACKFILL_NOW);
    expect(result[0]?.queuedAt).toBe(original);
  });

  it("works for MAN- entries: uses seen firstSeen when URL matches", () => {
    const manUrl = "https://acme.example/jobs/manual";
    const q: QueueEntry[] = [
      { id: `MAN-${hashUrl(manUrl)}`, company: "Acme", source: "manual" },
    ];
    const s: SeenEntry[] = [
      { url: manUrl, firstSeen: FIRST_SEEN, source: "manual", status: "live" },
    ];
    const result = backfillQueuedAt(q, s, BACKFILL_NOW);
    expect(result[0]?.queuedAt).toBe(FIRST_SEEN);
  });

  it("returns original array reference when all entries already have queuedAt", () => {
    const q: QueueEntry[] = [
      { id: "SCAN-abc", company: "Acme", queuedAt: FIRST_SEEN },
    ];
    const result = backfillQueuedAt(q, [], BACKFILL_NOW);
    // Same reference — no allocation when nothing needs backfilling.
    expect(result).toBe(q);
  });

  it("does not mutate the input queue", () => {
    const q: QueueEntry[] = [
      { id: `SCAN-${hashUrl(POSTING_URL)}`, company: "Acme" },
    ];
    backfillQueuedAt(q, [], BACKFILL_NOW);
    expect(q[0]?.queuedAt).toBeUndefined();
  });

  it("mixed: stamps legacy entries, leaves stamped entries unchanged", () => {
    const url2 = "https://acme.example/jobs/2";
    const q: QueueEntry[] = [
      { id: `SCAN-${hashUrl(POSTING_URL)}`, company: "Acme", queuedAt: "2026-07-01T00:00:00.000Z" },
      { id: `SCAN-${hashUrl(url2)}`, company: "Beta" },
    ];
    const s: SeenEntry[] = [
      { url: url2, firstSeen: FIRST_SEEN, source: "fake", status: "live" },
    ];
    const result = backfillQueuedAt(q, s, BACKFILL_NOW);
    expect(result[0]?.queuedAt).toBe("2026-07-01T00:00:00.000Z");
    expect(result[1]?.queuedAt).toBe(FIRST_SEEN);
  });
});
