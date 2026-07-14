import { join } from "node:path";
import { readdir, writeFile, rm } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { Context } from "hono";
import { selectNextDrillTopic, DebriefSchema } from "@selfwright/core";
import type { DrillHistoryEntry, DrillSelection, Gap, Debrief } from "@selfwright/core";
import {
  TruthLoader,
  loadDebriefs,
  appendDebrief,
  readDebriefsRaw,
  commitDataDirFile,
  DEBRIEFS_REL,
} from "@selfwright/adapter-storage-git";
import {
  CoachingResponseSchema,
  DebriefCreateRequestSchema,
  DebriefCreateResponseSchema,
} from "@selfwright/api-contract";
import { createLogger } from "@selfwright/shared-logger";
import { checkOrigin, checkWriteThrottle, getSessionId, verifyCsrfToken } from "../auth.js";
import { tryReadFile } from "../utils.js";
import { withWriteLock } from "../write-lock.js";
import { apiError, apiOk, getCsrfHeaderToken, handleCommitFailure } from "./shared.js";

const logger = createLogger("web-api-coaching");

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** GET /api/coaching — the cockpit's Coaching page data: debriefs/next-drill/drill-files/prep-packs. */
export async function getCoachingApiRoute(c: Context, dataDir: string): Promise<Response> {
  const truth = new TruthLoader(dataDir);

  const archetypesResult = await truth.loadArchetypes();
  const archetypes = archetypesResult.ok ? archetypesResult.value : [];
  const archetype = archetypes[0] ?? null;

  let nextDrill: DrillSelection | null = null;
  if (archetype !== null) {
    const registryResult = await truth.loadEvidenceRegistry();
    const ontologyResult = await truth.loadOntology();
    const gapsResult = await truth.loadGaps();
    const registry = registryResult.ok ? registryResult.value : [];
    const ontology = ontologyResult.ok ? ontologyResult.value : undefined;
    const gaps: Gap[] = gapsResult.ok ? gapsResult.value : [];

    const historyPath = join(dataDir, "coaching", "drill-history.yml");
    const historyRaw = await tryReadFile(historyPath);
    let history: DrillHistoryEntry[] = [];
    if (historyRaw !== null) {
      try {
        const parsed: unknown = parseYaml(historyRaw);
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          "history" in parsed &&
          Array.isArray((parsed as Record<string, unknown>)["history"])
        ) {
          history = (parsed as { history: DrillHistoryEntry[] }).history;
        }
      } catch {
        // graceful empty
      }
    }

    try {
      nextDrill = selectNextDrillTopic(history, gaps, archetype, registry, ontology);
    } catch {
      nextDrill = null;
    }
  }

  const drillFiles = await readdir(join(dataDir, "coaching", "drills")).catch(() => null);
  const drillMdFiles = drillFiles !== null ? drillFiles.filter((f) => f.endsWith(".md")).sort().reverse() : [];

  const coachingDir = join(dataDir, "coaching");
  const coachingEntries = await readdir(coachingDir).catch(() => null);
  const prepPacks: string[] = [];
  if (coachingEntries !== null) {
    for (const entry of coachingEntries) {
      const packRaw = await tryReadFile(join(coachingDir, entry, "prep-pack.md"));
      if (packRaw !== null) prepPacks.push(entry);
    }
  }

  const debriefs: Debrief[] = await loadDebriefs(dataDir);

  const body = CoachingResponseSchema.parse({
    debriefs,
    hasArchetype: archetype !== null,
    nextDrill,
    drillFiles: drillMdFiles,
    prepPacks,
  });
  return apiOk(c, body);
}

/**
 * POST /api/debriefs — debrief-capture write for the cockpit's Coaching
 * page. Same schema, same field limits (enforced by
 * DebriefCreateRequestSchema, including control-char rejection), same
 * throttle/audited-commit/fail-closed-revert semantics ADR 0019 established
 * (originally alongside an SSR form write route deleted in the T5.10 clean
 * cutover); list fields arrive as JSON arrays instead of newline-separated
 * textarea strings (the natural JSON shape — same <=20 items x <=200 chars
 * cap either way).
 */
export async function addDebriefApiRoute(c: Context, dataDir: string): Promise<Response> {
  if (!checkOrigin(c)) return apiError(c, "FORBIDDEN_ORIGIN", "Forbidden", 403);

  const sessionId = getSessionId(c.req.header("cookie") ?? null);
  if (sessionId === null) return apiError(c, "UNAUTHORIZED", "Unauthorized", 401);

  if (!verifyCsrfToken(sessionId, getCsrfHeaderToken(c))) {
    return apiError(c, "FORBIDDEN_CSRF", "Forbidden: invalid CSRF token", 403);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return apiError(c, "VALIDATION_ERROR", "Invalid request: malformed JSON body", 400);
  }

  const parsed = DebriefCreateRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(c, "VALIDATION_ERROR", "Invalid request: malformed debrief", 400);
  }

  if (!checkWriteThrottle(sessionId)) {
    return apiError(c, "RATE_LIMITED", "Too many write requests -- slow down and try again", 429);
  }

  let entry: Debrief;
  try {
    entry = DebriefSchema.parse(parsed.data);
  } catch {
    return apiError(c, "VALIDATION_ERROR", "Invalid request: debrief data failed schema validation", 400);
  }

  return withWriteLock(async () => {
    const originalRaw = await readDebriefsRaw(dataDir);
    await appendDebrief(dataDir, entry);

    const message = `web: debrief ${entry.date} ${today()}`;
    const commit = await commitDataDirFile(dataDir, DEBRIEFS_REL, message);
    if (!commit.ok) {
      // Fail-closed: restore the pre-write state (write back the original
      // file, or remove it if this was the very first debrief ever recorded).
      const debriefPath = join(dataDir, DEBRIEFS_REL);
      if (originalRaw !== null) {
        await writeFile(debriefPath, originalRaw, "utf-8");
      } else {
        await rm(debriefPath, { force: true });
      }
      return handleCommitFailure(c, logger, "Debrief write", commit);
    }

    const body = DebriefCreateResponseSchema.parse({ debrief: entry });
    return apiOk(c, body, 201);
  });
}
