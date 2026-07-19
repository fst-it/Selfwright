import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { Context } from "hono";
import { computeNorthStar, inboxService } from "@selfwright/core";
import type { ApplicationRecord, QueueEntry, InboxData, DriftEntry } from "@selfwright/core";
import { TruthLoader } from "@selfwright/adapter-storage-git";
import { OverviewResponseSchema } from "@selfwright/api-contract";
import { tryReadFile, filterValidApplications, loadFitnessHistory } from "../utils.js";
import { apiOk } from "./shared.js";

/** GET /api/overview — the cockpit's Overview page data (north-star, fitness history, inbox summary counts, digest count). */
export async function getOverviewApiRoute(c: Context, dataDir: string): Promise<Response> {
  const repoRoot = process.cwd();

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

  const inboxData: InboxData = { applications, queue, drifts };
  const inboxReport = inboxService(inboxData);

  const northStar = computeNorthStar(applications);
  const fitnessHistory = await loadFitnessHistory(repoRoot);

  const digestFiles = await readdir(join(dataDir, "content", "digests")).catch(() => null);
  const digestCount = digestFiles !== null ? digestFiles.filter((f) => f.endsWith(".md")).length : 0;

  const body = OverviewResponseSchema.parse({
    northStar,
    fitnessHistory,
    inbox: {
      decideNow: inboxReport.decideNow.length,
      reviewSoon: inboxReport.reviewSoon.length,
      fyi: inboxReport.fyi.length,
    },
    digestCount,
  });
  return apiOk(c, body);
}
