import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Context } from "hono";
import { computeNorthStar, computeChannelOutcomes } from "@selfwright/core";
import type { ApplicationRecord } from "@selfwright/core";
import { ReportingResponseSchema } from "@selfwright/api-contract";
import { tryReadFile, filterValidApplications, loadFitnessHistory } from "../utils.js";
import { apiOk } from "./shared.js";

/** GET /api/reporting — the cockpit's Reporting page data: north-star detail, channel outcomes, fitness trend. */
export async function getReportingApiRoute(c: Context, dataDir: string): Promise<Response> {
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

  const northStar = computeNorthStar(applications);
  const channelOutcomes = computeChannelOutcomes(applications);
  const fitnessHistory = await loadFitnessHistory(repoRoot);

  const byStatus: Record<string, number> = {};
  for (const app of applications) {
    byStatus[app.status] = (byStatus[app.status] ?? 0) + 1;
  }

  const body = ReportingResponseSchema.parse({ northStar, channelOutcomes, byStatus, fitnessHistory });
  return apiOk(c, body);
}
