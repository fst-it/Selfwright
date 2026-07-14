#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { createLogger } from "@selfwright/shared-logger";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { CallToolRequest, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  TruthLoader,
  migrateCareerPlanOverlay,
  loadScoringVocabularyFile,
  appendDebrief,
  loadDebriefs,
} from "@selfwright/adapter-storage-git";
import { Mem0Adapter } from "@selfwright/adapter-memory-mem0";
import { loadScanTargets } from "@selfwright/shared-config";
import {
  createHttpScanContext,
  adzunaProvider,
  arbeitnowProvider,
  ashbyProvider,
  bambooHrProvider,
  breezyProvider,
  genericProvider,
  greenhouseProvider,
  himalayasProvider,
  leverProvider,
  oracleProvider,
  personioProvider,
  recruiteeProvider,
  remoteokProvider,
  remotiveProvider,
  smartrecruitersProvider,
  weworkremotelyProvider,
  workableProvider,
  workdayProvider,
} from "@selfwright/adapter-scan-http";
import { createBrowserVerifyContext } from "@selfwright/adapter-scan-browser";
import {
  scoreService,
  atsService,
  tailorService,
  inboxService,
  buildCoverSystemPrompt,
  buildCoverUserPrompt,
  buildResearchPrompt,
  validateCoverArtifact,
  validateResearchArtifact,
  buildSynonymMap,
  runScan,
  buildManualEntry,
  computeCoverageGaps,
  selectEvidenceForTopic,
  selectNextDrillTopic,
  gapScanService,
  buildDrillSystemPrompt,
  buildDrillUserPrompt,
  buildPrepPackSystemPrompt,
  buildPrepPackUserPrompt,
  validateGapArtifact,
  validateDrillArtifact,
  validatePrepPackArtifact,
  selectContentTopics,
  selectContentTopicsForApplication,
  deriveJdTopicKeywords,
  buildTopicsSystemPrompt,
  buildTopicsUserPrompt,
  validateTopicsArtifact,
  DebriefSchema,
  deriveGapHintsFromDebriefs,
} from "@selfwright/core";
import type {
  CvContent,
  CvOverlay,
  EvidenceMap,
  TailoredCvContent,
  ApplicationRecord,
  QueueEntry,
  InboxData,
  ScanFetchContext,
  ScanProvider,
  SeenEntry,
  EvidenceEntry,
  Archetype,
  DriftEntry,
  DrillHistoryEntry,
  DrillSelection,
  PrepPackKind,
  DrillContext,
  PrepPackContext,
  ContentTopicCandidate,
  ContentHistoryEntry,
  TopicsContext,
  Debrief,
  GapHint,
  ScoreInput,
} from "@selfwright/core";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const mcpErrorsPath = join(moduleDir, "../../../reports/mcp-errors.jsonl");
const logger = createLogger("mcp", { filePath: mcpErrorsPath });

/**
 * Redact absolute filesystem paths from an error message before persisting or
 * returning it — prevents company/role directory names (PII) from leaking into
 * reports/mcp-errors.jsonl.  Windows (C:\...) and POSIX (/abs/path) patterns
 * are both covered.
 */
export function redactAbsolutePaths(message: string): string {
  return message
    .replace(/[A-Za-z]:[/\\][^\s'"]+/g, "<path>")
    .replace(/\/[^\s'"]{3,}/g, "<path>");
}

// NOTE: workday-browser is intentionally absent from this map. It requires a
// Playwright listing-browser context (createWorkdayBrowserProvider) that the
// MCP server does not provide — the CLI wires it dynamically with a per-scan
// browser lifecycle (open + finally-close). Attempting to use workday-browser
// via the MCP scan tool is caught below and returned as a clear error rather
// than silently producing 0 results (the behaviour runScan produces for an
// unknown provider key via its providerErrors path). Use the CLI `scan` command
// for workday-browser targets.
const SCAN_PROVIDERS: Record<string, ScanProvider> = {
  adzuna: adzunaProvider,
  arbeitnow: arbeitnowProvider,
  breezy: breezyProvider,
  greenhouse: greenhouseProvider,
  himalayas: himalayasProvider,
  lever: leverProvider,
  ashby: ashbyProvider,
  oracle: oracleProvider,
  personio: personioProvider,
  recruitee: recruiteeProvider,
  workable: workableProvider,
  remotive: remotiveProvider,
  remoteok: remoteokProvider,
  workday: workdayProvider,
  smartrecruiters: smartrecruitersProvider,
  bamboohr: bambooHrProvider,
  weworkremotely: weworkremotelyProvider,
  generic: genericProvider,
};

// ── Helpers ──────────────────────────────────────────────────────────────────
// No default LLM adapter is instantiated anywhere in this file (D-1): cover/
// research return grounded prompts for the co-pilot session to fill in, and
// check_cover/check_research validate whatever text comes back.

function getTruth(): TruthLoader {
  const dir = process.env["SELFWRIGHT_DATA_DIR"];
  if (!dir) throw new Error("SELFWRIGHT_DATA_DIR is not set");
  return new TruthLoader(dir);
}

/**
 * Resolve a caller-supplied path (e.g. prep_pack/topics's `appDir`) and
 * assert it stays under the sanctioned SELFWRIGHT_DATA_DIR — a `../` or
 * absolute `appDir` could otherwise escape the data dir and have this
 * process read arbitrary files elsewhere on disk. Throws (caught by
 * handleCallTool's try/catch, same as every other tool error) if the
 * resolved path is not the data dir itself or a descendant of it.
 */
function resolveWithinDataDir(dataDir: string, rawPath: string): string {
  const root = resolve(dataDir);
  const target = resolve(rawPath);
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (target !== root && !target.startsWith(rootWithSep)) {
    throw new Error(`Path escapes the sanctioned data directory: ${rawPath}`);
  }
  return target;
}

function mustOk<T>(
  result: { ok: true; value: T } | { ok: false; error: { message: string } },
  label: string,
): T {
  if (result.ok) return result.value;
  throw new Error(`Failed to load ${label}: ${result.error.message}`);
}

// memory_add/memory_search degrade gracefully when SELFWRIGHT_MEMORY_URL is unset (T2.8):
// the other tools must keep working whether or not the optional mem0 service is running.
function getMemoryAdapter(): Mem0Adapter | null {
  const url = process.env["SELFWRIGHT_MEMORY_URL"];
  if (!url) return null;
  const token = process.env["SELFWRIGHT_MEMORY_TOKEN"];
  return new Mem0Adapter(url, token);
}

// ── Server ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-deprecated -- low-level Server supports multi-tool routing without per-tool Zod schemas
const server = new Server(
  { name: "selfwright", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: [
    {
      name: "score",
      description: "Score a job description against your archetypes and return a fit assessment",
      inputSchema: {
        type: "object",
        properties: {
          jd_text: { type: "string", description: "Full job description text" },
        },
        required: ["jd_text"],
      },
    },
    {
      name: "ats",
      description: "Run ATS pass-through analysis on a CV against a job description",
      inputSchema: {
        type: "object",
        properties: {
          jd_text: { type: "string", description: "Full job description text" },
          cv: { type: "object", description: "CV content as JSON object" },
          threshold: { type: "number", description: "Pass threshold 0-1 (optional)" },
        },
        required: ["jd_text", "cv"],
      },
    },
    {
      name: "tailor",
      description: "Apply a tailoring overlay to a CV",
      inputSchema: {
        type: "object",
        properties: {
          cv: { type: "object", description: "Base CV content as JSON object" },
          overlay: { type: "object", description: "Overlay instructions as JSON object" },
          evidence_map: { type: "object", description: "Evidence map as JSON object" },
        },
        required: ["cv", "overlay", "evidence_map"],
      },
    },
    {
      name: "cover",
      description:
        "Assemble a truth-grounded cover-letter prompt for co-piloted generation (no LLM call — write the letter yourself from the returned prompt, then call check_cover on it)",
      inputSchema: {
        type: "object",
        properties: {
          jd_text: { type: "string", description: "Full job description text" },
          tailored_cv: { type: "object", description: "Tailored CV as JSON object" },
          company_research: { type: "string", description: "Optional company research markdown" },
        },
        required: ["jd_text", "tailored_cv"],
      },
    },
    {
      name: "check_cover",
      description:
        "Validate a cover-letter artifact: truth-trace, honesty walls, and format rules (350-400 words, no banned opening)",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "The cover-letter markdown text to validate" },
        },
        required: ["text"],
      },
    },
    {
      name: "research",
      description:
        "Assemble a truth-grounded company-research prompt for co-piloted generation (no LLM call — write the document yourself from the returned prompt, then call check_research on it)",
      inputSchema: {
        type: "object",
        properties: {
          company: { type: "string", description: "Company name" },
          role_title: { type: "string", description: "Role title" },
          jd_text: { type: "string", description: "Full job description text" },
        },
        required: ["company", "role_title", "jd_text"],
      },
    },
    {
      name: "check_research",
      description: "Validate a company-research artifact: truth-trace and honesty walls",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "The company-research markdown text to validate" },
        },
        required: ["text"],
      },
    },
    {
      name: "inbox",
      description: "Get the 3-tier signal digest from your application pipeline",
      inputSchema: {
        type: "object",
        properties: {
          archetype: { type: "string", description: "Optional archetype id to add coaching signals (gap scan + next drill)" },
        },
      },
    },
    {
      name: "scan",
      description:
        "Scan configured job sources (config/scan-targets.yml), dedupe, check liveness, score, and update the pipeline queue",
      inputSchema: {
        type: "object",
        properties: {
          targets_path: { type: "string", description: "Path to scan-targets config (default: config/scan-targets.yml)" },
          dry_run: { type: "boolean", description: "Fetch and score but do not write queue.yml/scan-history.yml" },
          verify: {
            type: "boolean",
            description:
              "Re-verify 'uncertain' postings with a headless browser (ADR 0012; requires `npx playwright install chromium` once)",
          },
        },
      },
    },
    {
      name: "memory_add",
      description:
        "Store a durable memory note via mem0 (requires SELFWRIGHT_MEMORY_URL to be set; returns an error string, not a crash, if it isn't)",
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string", description: "The memory content to store" },
          metadata: { type: "object", description: "Optional string-valued metadata to attach" },
        },
        required: ["content"],
      },
    },
    {
      name: "memory_search",
      description:
        "Search stored memories via mem0 (requires SELFWRIGHT_MEMORY_URL to be set; returns an error string, not a crash, if it isn't)",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          top_k: { type: "number", description: "Max results to return (default: 10)" },
        },
        required: ["query"],
      },
    },
    {
      name: "gap_scan",
      description:
        "Compute skill-gap coverage for an archetype against the evidence registry (no LLM) and return a report",
      inputSchema: {
        type: "object",
        properties: {
          archetypeId: { type: "string", description: "Archetype id to scan" },
        },
        required: ["archetypeId"],
      },
    },
    {
      name: "check_gap_scan",
      description: "Validate gaps.yml rows: evidence id existence, honesty boundary, and truth-trace on frames",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "drill",
      description:
        "Select the next drill topic and return a truth-grounded system+user prompt for a co-piloted drill session (no LLM call — write the drill from this prompt, then call check_drill on the completed transcript)",
      inputSchema: {
        type: "object",
        properties: {
          archetypeId: { type: "string", description: "Archetype id to drill against" },
        },
        required: ["archetypeId"],
      },
    },
    {
      name: "check_drill",
      description: "Validate a completed drill transcript: required headings, grounding line, honesty boundary, and truth-trace on the coach slice only",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "The completed drill transcript text to validate" },
        },
        required: ["text"],
      },
    },
    {
      name: "prep_pack",
      description:
        "Assemble a truth-grounded prep-pack prompt for co-piloted generation (no LLM call — write the prep-pack from this prompt, then call check_prep_pack on it)",
      inputSchema: {
        type: "object",
        properties: {
          appDir: { type: "string", description: "Application directory path" },
          kind: {
            type: "string",
            description: "Prep-pack kind: interview, networking, or event (default: interview)",
          },
          archetypeId: { type: "string", description: "Optional archetype id for coverage gap analysis" },
        },
        required: ["appDir"],
      },
    },
    {
      name: "check_prep_pack",
      description: "Validate a prep-pack artifact: honesty boundary, truth-trace, EVD-* citation, gaps section, and id integrity",
      inputSchema: {
        type: "object",
        properties: {
          appDir: { type: "string", description: "Application directory path containing prep-pack.md" },
          kind: {
            type: "string",
            description: "Prep-pack kind: interview, networking, or event (default: interview)",
          },
        },
        required: ["appDir"],
      },
    },
    {
      name: "topics",
      description:
        "Select ranked content topic candidates and return a truth-grounded system+user prompt for co-piloted digest generation (no LLM call — write the digest from this prompt, then call check_topics on it)",
      inputSchema: {
        type: "object",
        properties: {
          archetypeId: {
            type: "string",
            description: "Archetype id for digest mode (one of archetypeId or appDir required)",
          },
          appDir: {
            type: "string",
            description: "Application directory path for application mode — job-description.md is read from here",
          },
        },
      },
    },
    {
      name: "check_topics",
      description: "Validate a content-topics digest artifact: required headings, topic count, URL citations, EVD-*/GAP-* id integrity, Grounding: line, honesty boundary, and truth-trace",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "The topics digest markdown text to validate" },
        },
        required: ["text"],
      },
    },
    {
      name: "add_debrief",
      description: "Record an interview debrief for an application. Person names must not be used — reference contacts by their contacts-entry id only.",
      inputSchema: {
        type: "object",
        properties: {
          application_id: { type: "string", description: "Application id (e.g. acme-eng-2025)" },
          date: { type: "string", description: "Interview date (YYYY-MM-DD)" },
          round: { type: "string", description: "Interview round label (optional, e.g. technical-1)" },
          asked: { type: "array", items: { type: "string" }, description: "Topics asked in the interview" },
          wobbled: { type: "array", items: { type: "string" }, description: "Topics where you wobbled or felt uncertain" },
          went_well: { type: "array", items: { type: "string" }, description: "Topics that went well" },
          notes: { type: "string", description: "Free-form notes (no person names)" },
        },
        required: ["application_id", "date"],
      },
    },
    {
      name: "list_debriefs",
      description: "List logged interview debriefs, optionally filtered by application id",
      inputSchema: {
        type: "object",
        properties: {
          application_id: { type: "string", description: "Optional: filter to a specific application id" },
        },
      },
    },
    {
      name: "queue_add",
      description:
        "Manually add a job posting to the pipeline queue (LinkedIn-safe: the URL is not fetched). " +
        "Provide company and role from the pasted job description text — never scrape LinkedIn. " +
        "Dedup-checked against the existing queue and applications. " +
        "Pass jd_text to score the posting (same rubric as the `score` tool).",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Posting URL (dedup key only; not fetched)" },
          company: { type: "string", description: "Company name (extract from the pasted JD text)" },
          role: { type: "string", description: "Role title (extract from the pasted JD text)" },
          jd_text: { type: "string", description: "Optional job description text to score" },
        },
        required: ["url", "company", "role"],
      },
    },
  ],
}));

// Extracted from the server.setRequestHandler registration below so it's
// unit-testable without a live MCP transport (R7): tests call this directly
// with a fake CallToolRequest and assert on the returned CallToolResult,
// including the redacted-error path in the catch block at the bottom.
export async function handleCallTool(request: CallToolRequest): Promise<CallToolResult> {
  const { name, arguments: args } = request.params;
  const input: Record<string, unknown> = args ?? {};

  try {
    if (name === "score") {
      const truth = getTruth();
      const archetypes = mustOk(await truth.loadArchetypes(), "archetypes");
      const ontology = mustOk(await truth.loadOntology(), "ontology");
      const registry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
      const vocabulary = await loadScoringVocabularyFile(process.env["SELFWRIGHT_DATA_DIR"] as string);
      const result = scoreService({
        jdText: input["jd_text"] as string,
        archetypes,
        ontology,
        registry,
        vocabulary,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }

    if (name === "ats") {
      const truth = getTruth();
      const ontology = mustOk(await truth.loadOntology(), "ontology");
      const evidenceRegistry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
      const atsOpts: { threshold?: number } = {};
      if (typeof input["threshold"] === "number") atsOpts.threshold = input["threshold"];
      const result = atsService({
        jdText: input["jd_text"] as string,
        cv: input["cv"] as CvContent,
        evidenceRegistry,
        ontology,
        opts: atsOpts,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }

    if (name === "tailor") {
      const rawOverlay = input["overlay"];
      const rawObj = typeof rawOverlay === "object" && rawOverlay !== null ? (rawOverlay as Record<string, unknown>) : {};
      if ("inject_drifts" in rawObj && !("drift_applications" in rawObj)) {
        process.stderr.write(`[tailor] warn: legacy inject_drifts field detected — auto-migrated to drift_applications\n`);
      }
      let overlay: CvOverlay;
      try {
        overlay = migrateCareerPlanOverlay(rawOverlay);
      } catch (e) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: invalid overlay — ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
          isError: true,
        };
      }
      const truth = getTruth();
      const evidenceRegistry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
      const registryIds = new Set(evidenceRegistry.map((e) => e.id));
      const identity = mustOk(await truth.loadIdentity(), "identity");
      const driftsResult = await truth.loadDrifts();
      const drifts = driftsResult.ok ? driftsResult.value : [];
      const result = tailorService(
        input["cv"] as CvContent,
        overlay,
        input["evidence_map"] as EvidenceMap,
        registryIds,
        { registry: evidenceRegistry, identity, drifts },
      );
      if (!result.ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${result.error.kind} — ${result.error.message}`,
            },
          ],
          isError: true,
        };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
    }

    if (name === "cover") {
      const truth = getTruth();
      const identity = mustOk(await truth.loadIdentity(), "identity");
      const coverCtx: Parameters<typeof buildCoverUserPrompt>[0] = {
        jdText: input["jd_text"] as string,
        tailoredCv: input["tailored_cv"] as TailoredCvContent,
        identity,
      };
      if (typeof input["company_research"] === "string") {
        coverCtx.companyResearch = input["company_research"];
      }
      const systemPrompt = buildCoverSystemPrompt(identity, coverCtx.styleGuide);
      const userPrompt = buildCoverUserPrompt(coverCtx);
      return { content: [{ type: "text" as const, text: `${systemPrompt}\n\n---\n\n${userPrompt}` }] };
    }

    if (name === "check_cover") {
      const truth = getTruth();
      const registry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
      const identity = mustOk(await truth.loadIdentity(), "identity");
      const driftsResult = await truth.loadDrifts();
      const drifts = driftsResult.ok ? driftsResult.value : [];
      const result = validateCoverArtifact(input["text"] as string, { registry, identity, drifts });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    }

    if (name === "research") {
      const truth = getTruth();
      const identity = mustOk(await truth.loadIdentity(), "identity");
      const researchCtx: Parameters<typeof buildResearchPrompt>[0] = {
        company: input["company"] as string,
        roleTitle: input["role_title"] as string,
        jdText: input["jd_text"] as string,
        identity,
      };
      return { content: [{ type: "text" as const, text: buildResearchPrompt(researchCtx) }] };
    }

    if (name === "check_research") {
      const truth = getTruth();
      const registry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
      const identity = mustOk(await truth.loadIdentity(), "identity");
      const result = validateResearchArtifact(input["text"] as string, { registry, identity });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    }

    if (name === "inbox") {
      const dir = process.env["SELFWRIGHT_DATA_DIR"];
      if (!dir) throw new Error("SELFWRIGHT_DATA_DIR is not set");

      let applications: ApplicationRecord[] = [];
      let queue: QueueEntry[] = [];

      const appsRaw = await readFile(join(dir, "applications", "applications.yml"), "utf-8").catch(
        () => null,
      );
      if (appsRaw !== null) {
        const parsed: unknown = parseYaml(appsRaw);
        if (Array.isArray(parsed)) applications = parsed as ApplicationRecord[];
      }

      const queueRaw = await readFile(join(dir, "pipeline", "queue.yml"), "utf-8").catch(
        () => null,
      );
      if (queueRaw !== null) {
        const parsed: unknown = parseYaml(queueRaw);
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          "queue" in parsed &&
          Array.isArray((parsed as Record<string, unknown>)["queue"])
        ) {
          queue = (parsed as { queue: QueueEntry[] }).queue;
        }
      }

      const truth = getTruth();
      const driftsResult = await truth.loadDrifts();
      const drifts = driftsResult.ok ? driftsResult.value : [];

      const inboxDebriefs: Debrief[] = await loadDebriefs(dir);
      const data: InboxData = {
        applications,
        queue,
        drifts,
        ...(inboxDebriefs.length > 0 ? { debriefs: inboxDebriefs } : {}),
      };

      const archetypeInput = typeof input["archetype"] === "string" ? input["archetype"] : undefined;
      if (archetypeInput !== undefined) {
        const archetypes = mustOk(await truth.loadArchetypes(), "archetypes");
        const inboxArchetype = archetypes.find((a) => a.id === archetypeInput);
        if (!inboxArchetype) throw new Error(`archetype "${archetypeInput}" not found`);
        const inboxRegistry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
        const inboxOntology = mustOk(await truth.loadOntology(), "ontology");
        const inboxGaps = mustOk(await truth.loadGaps(), "gaps");
        const candidateGaps = computeCoverageGaps(inboxArchetype, inboxRegistry, inboxOntology, inboxGaps);
        const inboxHistoryRaw = await readFile(join(dir, "coaching", "drill-history.yml"), "utf-8").catch(() => null);
        let inboxHistory: DrillHistoryEntry[] = [];
        if (inboxHistoryRaw !== null) {
          const parsed: unknown = parseYaml(inboxHistoryRaw);
          if (
            parsed !== null &&
            typeof parsed === "object" &&
            "history" in parsed &&
            Array.isArray((parsed as Record<string, unknown>)["history"])
          ) {
            inboxHistory = (parsed as { history: DrillHistoryEntry[] }).history;
          }
        }
        let nextDrill: DrillSelection | undefined;
        try {
          nextDrill = selectNextDrillTopic(inboxHistory, inboxGaps, inboxArchetype, inboxRegistry, inboxOntology);
        } catch {
          // No drill candidates available — omit coaching.nextDrill.
        }
        data.coaching = nextDrill !== undefined
          ? { candidateGaps, nextDrill }
          : { candidateGaps };
      }

      const report = inboxService(data);
      return { content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }] };
    }

    if (name === "gap_scan") {
      const archetypeId = input["archetypeId"] as string;
      const dir = process.env["SELFWRIGHT_DATA_DIR"];
      if (!dir) throw new Error("SELFWRIGHT_DATA_DIR is not set");
      const truth = getTruth();
      const registry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
      const ontology = mustOk(await truth.loadOntology(), "ontology");
      const gaps = mustOk(await truth.loadGaps(), "gaps");
      const archetypes = mustOk(await truth.loadArchetypes(), "archetypes");
      const archetype = archetypes.find((a: Archetype) => a.id === archetypeId);
      if (!archetype) throw new Error(`archetype "${archetypeId}" not found`);
      const candidates = computeCoverageGaps(archetype, registry, ontology, gaps);
      const gapDebriefs: Debrief[] = await loadDebriefs(dir);
      const debriefHints: GapHint[] =
        gapDebriefs.length > 0 ? deriveGapHintsFromDebriefs(gapDebriefs, registry) : [];
      return {
        content: [{
          type: "text" as const,
          text: gapScanService(candidates, debriefHints.length > 0 ? debriefHints : undefined),
        }],
      };
    }

    if (name === "check_gap_scan") {
      const truth = getTruth();
      const gaps = mustOk(await truth.loadGaps(), "gaps");
      const registry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
      const driftsResult = await truth.loadDrifts();
      const drifts: DriftEntry[] = driftsResult.ok ? driftsResult.value : [];
      const result = validateGapArtifact(gaps, { registry, drifts });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    }

    if (name === "drill") {
      const archetypeId = input["archetypeId"] as string;
      const dir = process.env["SELFWRIGHT_DATA_DIR"];
      if (!dir) throw new Error("SELFWRIGHT_DATA_DIR is not set");
      const truth = getTruth();
      const registry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
      const ontology = mustOk(await truth.loadOntology(), "ontology");
      const gaps = mustOk(await truth.loadGaps(), "gaps");
      const archetypes = mustOk(await truth.loadArchetypes(), "archetypes");
      const archetype = archetypes.find((a: Archetype) => a.id === archetypeId);
      if (!archetype) throw new Error(`archetype "${archetypeId}" not found`);
      const identity = mustOk(await truth.loadIdentity(), "identity");

      const drillHistoryPath = join(dir, "coaching", "drill-history.yml");
      const historyRaw = await readFile(drillHistoryPath, "utf-8").catch(() => null);
      let history: DrillHistoryEntry[] = [];
      if (historyRaw !== null) {
        const parsed: unknown = parseYaml(historyRaw);
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          "history" in parsed &&
          Array.isArray((parsed as Record<string, unknown>)["history"])
        ) {
          history = (parsed as { history: DrillHistoryEntry[] }).history;
        }
      }

      const selection = selectNextDrillTopic(history, gaps, archetype, registry, ontology);
      const evidenceDetails: EvidenceEntry[] = selection.evidenceBundle
        .map((re) => registry.find((e) => e.id === re.id))
        .filter((e): e is EvidenceEntry => e !== undefined);

      const ctx: DrillContext = { selection, identity, archetypeId, evidenceDetails };
      const systemPrompt = buildDrillSystemPrompt();
      const userPrompt = buildDrillUserPrompt(ctx);

      // Append to drill history as a side effect (same path convention as CLI).
      history.push({ topicId: selection.topicId, kind: selection.kind, at: new Date().toISOString() });
      await mkdir(dirname(drillHistoryPath), { recursive: true });
      await writeFile(drillHistoryPath, stringifyYaml({ history }), "utf-8");

      return { content: [{ type: "text" as const, text: `${systemPrompt}\n\n---\n\n${userPrompt}` }] };
    }

    if (name === "check_drill") {
      const truth = getTruth();
      const registry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
      const identity = mustOk(await truth.loadIdentity(), "identity");
      const driftsResult = await truth.loadDrifts();
      const drifts: DriftEntry[] = driftsResult.ok ? driftsResult.value : [];
      const gaps = mustOk(await truth.loadGaps(), "gaps");
      const result = validateDrillArtifact(input["text"] as string, { registry, identity, drifts, gaps });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    }

    if (name === "prep_pack") {
      const appDir = input["appDir"] as string;
      const kind = (typeof input["kind"] === "string" ? input["kind"] : "interview") as PrepPackKind;
      const archetypeId = typeof input["archetypeId"] === "string" ? input["archetypeId"] : undefined;
      const dir = process.env["SELFWRIGHT_DATA_DIR"];
      if (!dir) throw new Error("SELFWRIGHT_DATA_DIR is not set");
      const absAppDir = resolveWithinDataDir(dir, appDir);

      const truth = getTruth();
      const identity = mustOk(await truth.loadIdentity(), "identity");
      const registry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
      const ontology = mustOk(await truth.loadOntology(), "ontology");
      const gaps = mustOk(await truth.loadGaps(), "gaps");

      let archetypeFound: Archetype | undefined;
      if (archetypeId !== undefined) {
        const archetypes = mustOk(await truth.loadArchetypes(), "archetypes");
        archetypeFound = archetypes.find((a: Archetype) => a.id === archetypeId);
        if (!archetypeFound) throw new Error(`archetype "${archetypeId}" not found`);
      }

      let jdText: string | undefined;
      let contextText: string | undefined;
      if (kind === "interview") {
        jdText = await readFile(join(absAppDir, "job-description.md"), "utf-8").catch(() => undefined);
      } else {
        contextText = await readFile(join(absAppDir, "context.md"), "utf-8").catch(() => undefined);
      }

      const candidateGaps = archetypeFound !== undefined
        ? computeCoverageGaps(archetypeFound, registry, ontology, gaps)
        : [];

      const topics: string[] =
        archetypeFound !== undefined
          ? archetypeFound.match_keywords
          : jdText !== undefined
            ? [jdText]
            : [];

      const topEvidence = selectEvidenceForTopic(topics, registry, ontology);
      const evidenceDetails: EvidenceEntry[] = topEvidence
        .map((re) => registry.find((e) => e.id === re.id))
        .filter((e): e is EvidenceEntry => e !== undefined);

      const ctx: PrepPackContext = {
        kind,
        identity,
        ...(archetypeId !== undefined ? { archetypeId } : {}),
        ...(jdText !== undefined ? { jdText } : {}),
        ...(contextText !== undefined ? { contextText } : {}),
        candidateGaps,
        gaps,
        topEvidence,
        evidenceDetails,
      };

      const systemPrompt = buildPrepPackSystemPrompt(kind);
      const userPrompt = buildPrepPackUserPrompt(ctx);
      return { content: [{ type: "text" as const, text: `${systemPrompt}\n\n---\n\n${userPrompt}` }] };
    }

    if (name === "check_prep_pack") {
      const appDir = input["appDir"] as string;
      const kind = (typeof input["kind"] === "string" ? input["kind"] : "interview") as PrepPackKind;
      const dir = process.env["SELFWRIGHT_DATA_DIR"];
      if (!dir) throw new Error("SELFWRIGHT_DATA_DIR is not set");
      const absAppDir = resolveWithinDataDir(dir, appDir);
      const packPath = join(absAppDir, "prep-pack.md");
      const text = await readFile(packPath, "utf-8").catch(() => {
        throw new Error("prep-pack.md not found in the specified application directory");
      });
      const truth = getTruth();
      const registry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
      const identity = mustOk(await truth.loadIdentity(), "identity");
      const driftsResult = await truth.loadDrifts();
      const drifts: DriftEntry[] = driftsResult.ok ? driftsResult.value : [];
      const gaps = mustOk(await truth.loadGaps(), "gaps");
      const result = validatePrepPackArtifact(text, { registry, identity, drifts, gaps, kind });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    }

    if (name === "topics") {
      const archetypeId = typeof input["archetypeId"] === "string" ? input["archetypeId"] : undefined;
      const appDir = typeof input["appDir"] === "string" ? input["appDir"] : undefined;
      if (archetypeId === undefined && appDir === undefined) {
        throw new Error("Either archetypeId or appDir is required");
      }

      const dir = process.env["SELFWRIGHT_DATA_DIR"];
      if (!dir) throw new Error("SELFWRIGHT_DATA_DIR is not set");

      const truth = getTruth();
      const registry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
      const identity = mustOk(await truth.loadIdentity(), "identity");
      const gaps = mustOk(await truth.loadGaps(), "gaps");
      const ontology = mustOk(await truth.loadOntology(), "ontology");

      let candidates: ContentTopicCandidate[] = [];
      let jdText: string | undefined;
      let contentHistory: ContentHistoryEntry[] = [];
      const contentHistoryPath = join(dir, "content", "content-history.yml");

      if (archetypeId !== undefined) {
        const archetypes = mustOk(await truth.loadArchetypes(), "archetypes");
        const archetype = archetypes.find((a: Archetype) => a.id === archetypeId);
        if (!archetype) throw new Error(`archetype "${archetypeId}" not found`);
        const historyRaw = await readFile(contentHistoryPath, "utf-8").catch(() => null);
        if (historyRaw !== null) {
          const parsed: unknown = parseYaml(historyRaw);
          if (
            parsed !== null &&
            typeof parsed === "object" &&
            "history" in parsed &&
            Array.isArray((parsed as Record<string, unknown>)["history"])
          ) {
            contentHistory = (parsed as { history: ContentHistoryEntry[] }).history;
          }
        }
        candidates = selectContentTopics(archetype, registry, gaps, contentHistory, ontology);
      } else {
        // Application mode (appDir is guaranteed defined: guard above throws if both are missing)
        const absAppDir = resolveWithinDataDir(dir, appDir as string);
        jdText = await readFile(join(absAppDir, "job-description.md"), "utf-8").catch(() => undefined);
        if (jdText === undefined) {
          throw new Error(`No job-description.md found in ${absAppDir}`);
        }
        const archetypes = mustOk(await truth.loadArchetypes(), "archetypes");
        const jdKeywords = deriveJdTopicKeywords(jdText, archetypes);
        candidates = selectContentTopicsForApplication(jdKeywords, registry, gaps, ontology);
      }

      const evidenceDetails: EvidenceEntry[] = candidates
        .flatMap((c) => c.evidenceBundle.map((e) => e.id))
        .filter((id, i, arr) => arr.indexOf(id) === i)
        .map((id) => registry.find((e) => e.id === id))
        .filter((e): e is EvidenceEntry => e !== undefined);

      const topicsCtx: TopicsContext = {
        mode: archetypeId !== undefined ? "digest" : "application",
        identity,
        ...(archetypeId !== undefined ? { archetypeId } : {}),
        ...(jdText !== undefined ? { jdText } : {}),
        ...(appDir !== undefined ? { appRef: appDir } : {}),
        candidates,
        evidenceDetails,
        gaps,
      };

      const systemPrompt = buildTopicsSystemPrompt(topicsCtx.mode);
      const userPrompt = buildTopicsUserPrompt(topicsCtx);

      // Append candidates to content history as a side effect (digest mode only; same pattern as drill MCP).
      if (archetypeId !== undefined) {
        for (const c of candidates) {
          contentHistory.push({ topic: c.topic, direction: c.direction, at: new Date().toISOString() });
        }
        await mkdir(dirname(contentHistoryPath), { recursive: true });
        await writeFile(contentHistoryPath, stringifyYaml({ history: contentHistory }), "utf-8");
      }

      return { content: [{ type: "text" as const, text: `${systemPrompt}\n\n---\n\n${userPrompt}` }] };
    }

    if (name === "check_topics") {
      const text = input["text"] as string;

      // Id existence, not offered-set membership — matches drill/prep-pack semantics.
      // No candidate recomputation needed here (T3.3 finding 6).
      const truth = getTruth();
      const registry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
      const identity = mustOk(await truth.loadIdentity(), "identity");
      const driftsResult = await truth.loadDrifts();
      const drifts: DriftEntry[] = driftsResult.ok ? driftsResult.value : [];
      const gaps = mustOk(await truth.loadGaps(), "gaps");

      const result = validateTopicsArtifact(text, { registry, identity, drifts, gaps });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    }

    if (name === "scan") {
      const dir = process.env["SELFWRIGHT_DATA_DIR"];
      if (!dir) throw new Error("SELFWRIGHT_DATA_DIR is not set");
      const targetsPath = typeof input["targets_path"] === "string" ? input["targets_path"] : "config/scan-targets.yml";
      const dryRun = input["dry_run"] === true;
      const targetsConfig = loadScanTargets(resolve(targetsPath));

      // workday-browser is CLI-only — see the SCAN_PROVIDERS comment above.
      const wbTargets = targetsConfig.targets.filter((t) => t.provider === "workday-browser");
      if (wbTargets.length > 0) {
        const companies = wbTargets.map((t) => t.company).join(", ");
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Error: workday-browser provider is not supported in the MCP server — ` +
                `it requires a Playwright listing browser that the MCP server does not provide. ` +
                `Use the CLI \`scan\` command instead. Affected targets: ${companies}`,
            },
          ],
          isError: true,
        };
      }

      const truth = getTruth();
      const archetypes = mustOk(await truth.loadArchetypes(), "archetypes");
      const ontology = mustOk(await truth.loadOntology(), "ontology");
      const synonymMap = buildSynonymMap(ontology);
      const vocabulary = await loadScoringVocabularyFile(dir);

      const scanHistoryPath = join(dir, "pipeline", "scan-history.yml");
      const queuePath = join(dir, "pipeline", "queue.yml");

      let seen: SeenEntry[] = [];
      const seenRaw = await readFile(scanHistoryPath, "utf-8").catch(() => null);
      if (seenRaw !== null) {
        const parsed: unknown = parseYaml(seenRaw);
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          "seen" in parsed &&
          Array.isArray((parsed as Record<string, unknown>)["seen"])
        ) {
          seen = (parsed as { seen: SeenEntry[] }).seen;
        }
      }

      let queue: QueueEntry[] = [];
      const queueRaw = await readFile(queuePath, "utf-8").catch(() => null);
      if (queueRaw !== null) {
        const parsed: unknown = parseYaml(queueRaw);
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          "queue" in parsed &&
          Array.isArray((parsed as Record<string, unknown>)["queue"])
        ) {
          queue = (parsed as { queue: QueueEntry[] }).queue;
        }
      }

      // Load existing applications best-effort for cross-dedup (never crashes scan).
      let existingApplications: { company: string; role: string }[] = [];
      const existingAppsRaw = await readFile(join(dir, "applications", "applications.yml"), "utf-8").catch(() => null);
      if (existingAppsRaw !== null) {
        try {
          const parsedApps: unknown = parseYaml(existingAppsRaw);
          if (Array.isArray(parsedApps)) {
            existingApplications = parsedApps
              .filter((a): a is { company: string; role: string } =>
                a !== null && typeof a === "object" &&
                typeof (a as Record<string, unknown>)["company"] === "string" &&
                typeof (a as Record<string, unknown>)["role"] === "string",
              )
              .map((a) => ({ company: a.company, role: a.role }));
          }
        } catch {
          // malformed — skip, don't crash
        }
      }

      const httpCtx = createHttpScanContext();
      const browserCtx = input["verify"] === true ? createBrowserVerifyContext() : undefined;
      const scanCtx: ScanFetchContext = browserCtx
        ? { ...httpCtx, fetchRendered: (url: string) => browserCtx.fetchRendered(url) }
        : httpCtx;

      try {
        const result = await runScan({
          targets: targetsConfig.targets,
          providers: SCAN_PROVIDERS,
          ctx: scanCtx,
          archetypes,
          synonymMap,
          seen,
          queue,
          now: new Date().toISOString(),
          vocabulary,
          existingApplications,
        });

        if (!dryRun) {
          await writeFile(scanHistoryPath, stringifyYaml({ seen: result.seen }), "utf-8");
          await writeFile(queuePath, stringifyYaml({ queue: result.queue }), "utf-8");
        }

        return { content: [{ type: "text" as const, text: JSON.stringify(result.stats, null, 2) }] };
      } finally {
        await browserCtx?.close();
      }
    }

    if (name === "memory_add") {
      const adapter = getMemoryAdapter();
      if (!adapter) {
        return {
          content: [
            { type: "text" as const, text: "Error: SELFWRIGHT_MEMORY_URL is not set — memory is unavailable" },
          ],
          isError: true,
        };
      }
      const metadata =
        typeof input["metadata"] === "object" && input["metadata"] !== null
          ? (input["metadata"] as Record<string, string>)
          : undefined;
      const entry = await adapter.add(input["content"] as string, metadata);
      return { content: [{ type: "text" as const, text: JSON.stringify(entry, null, 2) }] };
    }

    if (name === "memory_search") {
      const adapter = getMemoryAdapter();
      if (!adapter) {
        return {
          content: [
            { type: "text" as const, text: "Error: SELFWRIGHT_MEMORY_URL is not set — memory is unavailable" },
          ],
          isError: true,
        };
      }
      const topK = typeof input["top_k"] === "number" ? input["top_k"] : undefined;
      const results = await adapter.search(input["query"] as string, topK);
      return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
    }

    if (name === "add_debrief") {
      const dir = process.env["SELFWRIGHT_DATA_DIR"];
      if (!dir) throw new Error("SELFWRIGHT_DATA_DIR is not set");
      const entry = DebriefSchema.parse({
        application_id: input["application_id"],
        date: input["date"],
        ...(typeof input["round"] === "string" ? { round: input["round"] } : {}),
        ...(Array.isArray(input["asked"]) ? { asked: input["asked"] } : {}),
        ...(Array.isArray(input["wobbled"]) ? { wobbled: input["wobbled"] } : {}),
        ...(Array.isArray(input["went_well"]) ? { went_well: input["went_well"] } : {}),
        ...(typeof input["notes"] === "string" ? { notes: input["notes"] } : {}),
      });
      await appendDebrief(dir, entry);
      return { content: [{ type: "text" as const, text: JSON.stringify(entry, null, 2) }] };
    }

    if (name === "list_debriefs") {
      const dir = process.env["SELFWRIGHT_DATA_DIR"];
      if (!dir) throw new Error("SELFWRIGHT_DATA_DIR is not set");
      let debriefs: Debrief[] = await loadDebriefs(dir);
      const filterApp = typeof input["application_id"] === "string" ? input["application_id"] : undefined;
      if (filterApp !== undefined) {
        debriefs = debriefs.filter((d) => d.application_id === filterApp);
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(debriefs, null, 2) }] };
    }

    if (name === "queue_add") {
      const dir = process.env["SELFWRIGHT_DATA_DIR"];
      if (!dir) throw new Error("SELFWRIGHT_DATA_DIR is not set");

      const url = input["url"] as string;
      const company = input["company"] as string;
      const role = input["role"] as string;

      const scanHistoryPath = join(dir, "pipeline", "scan-history.yml");
      const queuePath = join(dir, "pipeline", "queue.yml");

      let seen: SeenEntry[] = [];
      const seenRaw = await readFile(scanHistoryPath, "utf-8").catch(() => null);
      if (seenRaw !== null) {
        const parsed: unknown = parseYaml(seenRaw);
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          "seen" in parsed &&
          Array.isArray((parsed as Record<string, unknown>)["seen"])
        ) {
          seen = (parsed as { seen: SeenEntry[] }).seen;
        }
      }

      let queue: QueueEntry[] = [];
      const queueRaw = await readFile(queuePath, "utf-8").catch(() => null);
      if (queueRaw !== null) {
        const parsed: unknown = parseYaml(queueRaw);
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          "queue" in parsed &&
          Array.isArray((parsed as Record<string, unknown>)["queue"])
        ) {
          queue = (parsed as { queue: QueueEntry[] }).queue;
        }
      }

      let existingApplications: { id: string; company: string; role: string }[] = [];
      const appsRaw = await readFile(join(dir, "applications", "applications.yml"), "utf-8").catch(() => null);
      if (appsRaw !== null) {
        try {
          const parsedApps: unknown = parseYaml(appsRaw);
          if (Array.isArray(parsedApps)) {
            existingApplications = parsedApps.filter(
              (a): a is { id: string; company: string; role: string } =>
                a !== null &&
                typeof a === "object" &&
                typeof (a as Record<string, unknown>)["id"] === "string" &&
                typeof (a as Record<string, unknown>)["company"] === "string" &&
                typeof (a as Record<string, unknown>)["role"] === "string",
            );
          }
        } catch {
          // malformed — skip
        }
      }

      // Optional scoring pass when jd_text is provided.
      let fitScore: number | null = null;
      let scoreReport: string | undefined;
      if (typeof input["jd_text"] === "string" && input["jd_text"].length > 0) {
        const truth = getTruth();
        const archetypes = mustOk(await truth.loadArchetypes(), "archetypes");
        const ontology = mustOk(await truth.loadOntology(), "ontology");
        const registry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
        const vocabulary = await loadScoringVocabularyFile(dir);
        const scoreInput: ScoreInput = {
          jdText: input["jd_text"],
          archetypes,
          ontology,
          registry,
          vocabulary,
        };
        const scored = scoreService(scoreInput);
        fitScore = scored.fit_score;
        scoreReport = JSON.stringify(scored, null, 2);
      }

      const manualResult = buildManualEntry(
        { url, company, role, now: new Date().toISOString(), fitScore },
        seen,
        queue,
        existingApplications,
      );

      if (!manualResult.ok) {
        let msg: string;
        switch (manualResult.reason) {
          case "url-seen":
            msg = `Skipped: URL already in scan-history — ${url}`;
            break;
          case "queue-duplicate":
            msg =
              `Skipped: queue already has a matching entry — ` +
              `${manualResult.existingId} (${manualResult.existingCompany} / ${manualResult.existingRole})`;
            break;
          case "application-duplicate":
            msg =
              `Skipped: already applied — ` +
              `${manualResult.existingId} (${manualResult.existingCompany} / ${manualResult.existingRole})`;
            break;
        }
        return {
          content: [{ type: "text" as const, text: msg }],
          isError: true,
        };
      }

      const newQueue = [...queue, manualResult.entry];
      const newSeen = [...seen, manualResult.seenEntry];
      await mkdir(dirname(queuePath), { recursive: true });
      await writeFile(queuePath, stringifyYaml({ queue: newQueue }), "utf-8");
      await writeFile(scanHistoryPath, stringifyYaml({ seen: newSeen }), "utf-8");

      const summary =
        `Added ${manualResult.entry.id} — ${company} / ${role}` +
        (fitScore !== null ? ` (fit_score=${fitScore})` : "");
      const resultText = scoreReport !== undefined
        ? `${summary}\n\nScore details:\n${scoreReport}\n\nEntry:\n${JSON.stringify(manualResult.entry, null, 2)}`
        : `${summary}\n\nEntry:\n${JSON.stringify(manualResult.entry, null, 2)}`;

      return { content: [{ type: "text" as const, text: resultText }] };
    }

    return {
      content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    const safeMessage = redactAbsolutePaths(rawMessage);
    // err.stack's first line reproduces the raw, unredacted error message
    // (including absolute app-dir paths), and every subsequent frame is an
    // absolute filesystem path — redact it the same way as the message
    // before it reaches the logger, or it defeats safeMessage's redaction by
    // persisting the same paths verbatim into reports/mcp-errors.jsonl.
    const safeStack = err instanceof Error && err.stack ? redactAbsolutePaths(err.stack) : undefined;
    logger.error(safeMessage, { tool: name, stack: safeStack });
    return {
      content: [{ type: "text" as const, text: `Error: ${safeMessage}` }],
      isError: true,
    };
  }
}

server.setRequestHandler(CallToolRequestSchema, handleCallTool);

// True only when this file is the process entry point (`node dist/index.js`
// via the `selfwright-mcp` bin) — not when it's imported by a test. Guards
// the server.connect() side effect (R7) so importing this module for its
// exports (handleCallTool, redactAbsolutePaths) never opens a stdio
// transport or blocks waiting on it.
function isMainModule(): boolean {
  const invoked = process.argv[1];
  if (invoked === undefined) return false;
  return fileURLToPath(import.meta.url) === resolve(invoked);
}

export async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/* v8 ignore start -- exercised only by the real stdio bootstrap, never by tests */
if (isMainModule()) {
  await main();
}
/* v8 ignore stop */
