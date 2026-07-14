import type { Archetype } from "../truth/index.js";
import type { ScanFetchContext, ScanProvider } from "../ports/scan-provider.js";
import type { QueueEntry } from "./types.js";
import type { ScoringVocabulary } from "../scoring/index.js";
import { evaluatePosting } from "./scan.js";
import { checkLiveness } from "./liveness.js";
import { areSimilarTitles, dedupeByCompanyRoleFuzzy, isSeen } from "./dedup.js";
import { toQueueEntry, hashUrl } from "./queue-entry.js";
import type { RawPosting, ScanTarget, SeenEntry } from "./types.js";

export interface RunScanInput {
  targets: ScanTarget[];
  // Concrete providers are constructed in the app layer (CLI/MCP) using the
  // scan-http adapter and injected here as plain objects satisfying the
  // ScanProvider port — core never imports the adapter package (FF-PORT-1).
  providers: Record<string, ScanProvider>;
  ctx: ScanFetchContext;
  archetypes: Archetype[];
  synonymMap: Map<string, string>;
  seen: SeenEntry[];
  queue: QueueEntry[];
  // Caller supplies the timestamp (no Date.now() inside core) — keeps this a
  // pure, trivially-testable function.
  now: string;
  // Data-layer scoring vocabulary (industry tiers, anchors, commodity company
  // names) — falls back to the synthetic default (vocabulary.ts) when omitted.
  vocabulary?: ScoringVocabulary;
  // Existing applications to cross-deduplicate against: any posting whose
  // company matches and whose role fuzzy-matches (Jaccard ≥ 0.5 on stopword-
  // filtered tokens, same semantics as dedupeByCompanyRoleFuzzy) an entry here
  // is excluded from the queue — recorded in seen with its liveness status but
  // never queued (owner has already applied). Optional; omitting it disables
  // the cross-dedup. Malformed entries are ignored gracefully.
  existingApplications?: { company: string; role: string }[];
}

export interface RunScanStats {
  fetched: number;
  deduped: number;
  alreadySeen: number;
  expired: number;
  queued: number;
  // Count of postings for which ctx.fetchRendered was attempted (ADR 0012) —
  // counts the attempt, not just successes, since it reflects the cost paid
  // (a browser launch/page load), not the re-check's outcome. 0 whenever no
  // browser-capable context was supplied, regardless of how many postings
  // came back "uncertain".
  browserVerified: number;
  providerErrors: string[];
}

export interface RunScanResult {
  seen: SeenEntry[];
  queue: QueueEntry[];
  stats: RunScanStats;
}

/**
 * Run one scan pass: fetch every target via its provider, dedupe, skip
 * already-seen URLs, classify liveness + scan-time fit for the rest, and
 * append to the seen ledger (always) and the queue (only live/uncertain
 * postings that clear the FF-FIT-1 non-degeneracy floor — D-4). Never
 * mutates the input arrays; returns new seen/queue arrays for the caller to
 * persist.
 */
export async function runScan(input: RunScanInput): Promise<RunScanResult> {
  const { targets, providers, ctx, archetypes, synonymMap, now, vocabulary } = input;
  const seen = [...input.seen];
  const queue = [...input.queue];

  // Build a normalised list of existing applications for cross-dedup. Callers
  // (CLI/MCP) filter malformed entries before passing — the type guarantees
  // company and role are strings here.
  const existingApps: { company: string; role: string }[] = input.existingApplications ?? [];

  // hash→index map for refreshing lastSeenAt on already-queued URLs (T5.5).
  // Keyed by the hash portion of the entry id (stripping the SCAN-/MAN- prefix)
  // so both scan-derived and manual entries are refreshed when their URL
  // re-appears in a scan pass.
  const queueIdxByHash = new Map<string, number>();
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]?.id;
    if (id !== undefined) {
      const hash = id.replace(/^(?:SCAN|MAN)-/, "");
      queueIdxByHash.set(hash, i);
    }
  }

  const providerErrors: string[] = [];
  const allFetched: RawPosting[] = [];

  for (const target of targets) {
    const provider = providers[target.provider];
    if (!provider) {
      providerErrors.push(`unknown provider "${target.provider}" for ${target.company}`);
      continue;
    }
    try {
      const postings = await provider.fetch(target, ctx);
      allFetched.push(...postings);
    } catch (e) {
      providerErrors.push(`${target.company} (${target.provider}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const deduped = dedupeByCompanyRoleFuzzy(allFetched);
  const newPostings = deduped.filter((p) => !isSeen(p.url, seen));

  // Refresh lastSeenAt on already-queued entries whose URL re-appeared in this
  // scan pass (T5.5). Keeps active postings from going stale while the provider
  // keeps listing them. Both SCAN-<hash> and MAN-<hash> entries are refreshed —
  // a URL match by hash is sufficient regardless of how the entry was added.
  // The seen-ledger dedup purpose (ADR 0007) is unchanged: the URL is still
  // "seen forever" — we only touch the queue-entry timestamp.
  for (const posting of deduped) {
    if (!isSeen(posting.url, seen)) continue; // new posting handled in newPostings loop below
    const hash = hashUrl(posting.url);
    const idx = queueIdxByHash.get(hash);
    if (idx !== undefined) {
      const existing = queue[idx];
      if (existing !== undefined) {
        queue[idx] = { ...existing, lastSeenAt: now };
      }
    }
  }

  let expired = 0;
  let queued = 0;
  let browserVerified = 0;
  for (const posting of newPostings) {
    let result = evaluatePosting(posting, archetypes, synonymMap, {}, vocabulary);
    // Browser re-verification only ever targets the "uncertain" bucket — the
    // one liveness.ts explicitly can't resolve with a plain fetch (anti-bot
    // walls, JS-hydrated content). Re-checking "live"/"expired" would add
    // cost for no benefit and risks a browser-rendering quirk flipping an
    // already-confident verdict.
    if (result.liveness.status === "uncertain" && ctx.fetchRendered) {
      // Counted as an attempt regardless of outcome — this is the cost
      // (a browser launch/page load) the run paid, not a success count.
      browserVerified++;
      try {
        const rendered = await ctx.fetchRendered(posting.url);
        const browserLiveness = checkLiveness(rendered.text, {
          httpStatus: rendered.status,
          finalUrl: rendered.finalUrl,
        });
        result = { ...result, liveness: browserLiveness };
      } catch (e) {
        // A failed re-verify keeps the original "uncertain" verdict — never
        // lets a browser-side failure (crashed launch, nav timeout, missing
        // Chromium install) abort the whole scan pass.
        providerErrors.push(
          `browser-verify ${posting.url}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    seen.push({ url: posting.url, firstSeen: now, source: posting.source, status: result.liveness.status });
    if (result.liveness.status === "expired") {
      expired++;
      continue;
    }
    if (result.archetype === null || result.grade === "F") continue;
    // Cross-dedup against existing applications: same company (normalised) + fuzzy
    // role match (Jaccard ≥ 0.5, reusing areSimilarTitles). Already recorded in
    // seen above — just skip queueing.
    if (existingApps.length > 0) {
      const co = posting.company.trim().toLowerCase().replace(/\s+/g, " ");
      const alreadyApplied = existingApps.some(
        (a) =>
          a.company.trim().toLowerCase().replace(/\s+/g, " ") === co &&
          areSimilarTitles(a.role, posting.title),
      );
      if (alreadyApplied) continue;
    }
    queue.push(toQueueEntry(result, now));
    queued++;
  }

  return {
    seen,
    queue,
    stats: {
      fetched: allFetched.length,
      deduped: deduped.length,
      alreadySeen: deduped.length - newPostings.length,
      expired,
      queued,
      browserVerified,
      providerErrors,
    },
  };
}
