import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { Context } from "hono";
import { inboxService } from "@selfwright/core";
import { loadSettings } from "@selfwright/shared-config";
import type { ApplicationRecord, QueueEntry, InboxData, DriftEntry } from "@selfwright/core";
import { TruthLoader } from "@selfwright/adapter-storage-git";
import { InboxResponseSchema } from "@selfwright/api-contract";
import { tryReadFile, filterValidApplications } from "../utils.js";
import { apiOk } from "./shared.js";

/**
 * GET /api/inbox — the three-tier signal digest with item-level detail for
 * the cockpit's Inbox page (the deleted SSR /inbox page's equivalent; GET
 * /api/overview only ever exposes tier counts). Read-only.
 */
export async function getInboxRoute(c: Context, dataDir: string): Promise<Response> {
  const appsRaw = await tryReadFile(join(dataDir, "applications", "applications.yml"));
  let applications: ApplicationRecord[] = [];
  if (appsRaw !== null) {
    try {
      const parsed: unknown = parseYaml(appsRaw);
      if (Array.isArray(parsed)) applications = filterValidApplications(parsed);
    } catch {
      // graceful empty
    }
  }

  const queueRaw = await tryReadFile(join(dataDir, "pipeline", "queue.yml"));
  let queue: QueueEntry[] = [];
  if (queueRaw !== null) {
    try {
      const parsed: unknown = parseYaml(queueRaw);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "queue" in parsed &&
        Array.isArray((parsed as Record<string, unknown>)["queue"])
      ) {
        queue = (parsed as { queue: QueueEntry[] }).queue;
      }
    } catch {
      // graceful empty
    }
  }

  const truth = new TruthLoader(dataDir);
  let drifts: DriftEntry[] = [];
  const driftsResult = await truth.loadDrifts();
  if (driftsResult.ok) drifts = driftsResult.value;

  const contentDigests = await readdir(join(dataDir, "content", "digests")).catch(() => null);
  let lastDigestAt: string | undefined;
  if (contentDigests !== null) {
    const dates = contentDigests
      .filter((f) => /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse();
    if (dates.length > 0) lastDigestAt = dates[0];
  }

  const inboxData: InboxData = {
    applications,
    queue,
    drifts,
    ...(lastDigestAt !== undefined ? { content: { lastDigestAt } } : {}),
  };

  const settings = loadSettings(join(dataDir, "settings.yml"));
  const report = inboxService(inboxData, undefined, {
    agingWindowDays: settings.agingWindowDays,
    interviewStaleDays: settings.interviewStaleDays,
    appliedReviewDays: settings.appliedReviewDays,
    appliedDecideDays: settings.appliedDecideDays,
    fitScoreCutoffReviewSoon: settings.fitScoreCutoffReviewSoon,
    debriefNudgeDays: settings.debriefNudgeDays,
    drillCadenceDays: settings.drillCadenceDays,
  });

  const body = InboxResponseSchema.parse({
    asOf: report.asOf,
    decideNow: report.decideNow,
    reviewSoon: report.reviewSoon,
    fyi: report.fyi,
  });
  return apiOk(c, body);
}
