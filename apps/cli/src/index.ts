#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { Command } from "commander";
import {
  TruthLoader,
  migrateCareerPlanOverlay,
  loadScoringVocabularyFile,
  loadDebriefs,
  appendDebrief,
  DEBRIEFS_REL,
} from "@selfwright/adapter-storage-git";
import type { UsageRecord } from "@selfwright/tools";
import { LiteLlmAdapter } from "@selfwright/adapter-llm-litellm";
import { ClaudeCliAdapter } from "@selfwright/adapter-llm-claude-cli";
import { OllamaAdapter } from "@selfwright/adapter-llm-ollama";
import { loadModelsConfig, loadScanTargets, loadSettings } from "@selfwright/shared-config";
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
import { createBrowserVerifyContext, createWorkdayBrowserProvider } from "@selfwright/adapter-scan-browser";
import {
  computeNorthStar,
  computeChannelOutcomes,
  scoreService,
  atsService,
  tailorService,
  coverService,
  researchService,
  inboxService,
  buildCoverSystemPrompt,
  buildCoverUserPrompt,
  buildResearchPrompt,
  validateCoverArtifact,
  validateResearchArtifact,
  buildSynonymMap,
  runScan,
  backfillQueuedAt,
  buildManualEntry,
  computeCoverageGaps,
  selectEvidenceForTopic,
  selectNextDrillTopic,
  gapScanService,
  drillService,
  prepPackService,
  buildDrillSystemPrompt,
  buildDrillUserPrompt,
  buildPrepPackSystemPrompt,
  buildPrepPackUserPrompt,
  validateGapArtifact,
  validateDrillArtifact,
  validatePrepPackArtifact,
  topicsService,
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
  DriftEntry,
  TruthError,
  LlmPort,
  ScanFetchContext,
  ScanProvider,
  SeenEntry,
  EvidenceEntry,
  Archetype,
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
import { notify, notifyCoaching } from "@selfwright/shared-notify";
import { buildScanNotifyPayload, buildInboxNotifyPayload } from "./notify-helpers.js";
import { loadDotEnv } from "./load-dotenv.js";

// Auto-load repo-root .env so `SELFWRIGHT_DATA_DIR` set by `setup.mjs` is
// available immediately — no manual export required.  Keys already in the
// environment (explicit export, CI secrets) are never overwritten.
loadDotEnv();

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
  weworkremotely: weworkremotelyProvider,
  workday: workdayProvider,
  smartrecruiters: smartrecruitersProvider,
  bamboohr: bambooHrProvider,
  generic: genericProvider,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function getDataDir(): string {
  const dir = process.env["SELFWRIGHT_DATA_DIR"];
  if (!dir) {
    process.stderr.write("Error: SELFWRIGHT_DATA_DIR environment variable is not set\n");
    process.exit(1);
  }
  return dir;
}

function loadTruth(): TruthLoader {
  return new TruthLoader(getDataDir());
}

// Headless generation is opt-in only (--adapter) — the default co-pilot path
// never instantiates an LLM adapter (D-1: no default gateway).
function loadAdapter(name: string): LlmPort {
  const modelsConfig = loadModelsConfig("config/models.yml");
  if (name === "cli") {
    return new ClaudeCliAdapter(modelsConfig.roles, undefined, {
      defaultModel: modelsConfig.default,
    });
  }
  if (name === "litellm") {
    const baseUrl = process.env["LITELLM_BASE_URL"] ?? "http://localhost:4000";
    return new LiteLlmAdapter(baseUrl, modelsConfig);
  }
  if (name === "ollama") return new OllamaAdapter("llama3.2:3b");
  process.stderr.write(
    `Error: unknown --adapter "${name}" (expected "cli", "litellm", or "ollama")\n`,
  );
  process.exit(1);
}

async function loadJson<T>(path: string): Promise<T> {
  try {
    const text = await readFile(resolve(path), "utf-8");
    return JSON.parse(text) as T;
  } catch {
    process.stderr.write(`Error: could not read or parse JSON from ${path}\n`);
    process.exit(1);
  }
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(resolve(path), "utf-8");
  } catch {
    process.stderr.write(`Error: could not read file ${path}\n`);
    process.exit(1);
  }
}

async function tryReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

function mustOk<T>(
  result: { ok: true; value: T } | { ok: false; error: TruthError },
  label: string,
): T {
  if (result.ok) return result.value;
  process.stderr.write(`Error loading ${label}: ${result.error.message}\n`);
  process.exit(1);
}

// Debrief read/append helpers moved to @selfwright/adapter-storage-git
// (debrief-store.ts) so apps/web can reuse them without duplicating the YAML
// read-modify-write convention (ADR 0019). tryLoadDebriefs is aliased here to
// minimize call-site churn.
const tryLoadDebriefs = loadDebriefs;

function printGuardReport(path: string, violations: string[]): void {
  if (violations.length === 0) {
    process.stdout.write(`OK — ${path} passes all checks.\n`);
    return;
  }
  process.stdout.write(`FAILED — ${path}:\n`);
  for (const v of violations) process.stdout.write(`  - ${v}\n`);
}

async function runCoverCheck(absAppDir: string): Promise<void> {
  const letterPath = join(absAppDir, "cover-letter.md");
  const text = await readText(letterPath);
  const truth = loadTruth();
  const registry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
  const identity = mustOk(await truth.loadIdentity(), "identity");
  let drifts: DriftEntry[] = [];
  const driftsResult = await truth.loadDrifts();
  if (driftsResult.ok) drifts = driftsResult.value;
  const result = validateCoverArtifact(text, { registry, identity, drifts });
  printGuardReport(letterPath, result.violations);
  if (!result.ok) process.exit(1);
}

async function runResearchCheck(outPath: string): Promise<void> {
  const text = await readText(outPath);
  const truth = loadTruth();
  const registry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
  const identity = mustOk(await truth.loadIdentity(), "identity");
  const result = validateResearchArtifact(text, { registry, identity });
  printGuardReport(outPath, result.violations);
  if (!result.ok) process.exit(1);
}

async function runPrepPackCheck(absAppDir: string, kind: PrepPackKind): Promise<void> {
  const packPath = join(absAppDir, "prep-pack.md");
  const text = await readText(packPath);
  const truth = loadTruth();
  const registry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
  const identity = mustOk(await truth.loadIdentity(), "identity");
  let drifts: DriftEntry[] = [];
  const driftsResult = await truth.loadDrifts();
  if (driftsResult.ok) drifts = driftsResult.value;
  const gaps = mustOk(await truth.loadGaps(), "gaps");
  const result = validatePrepPackArtifact(text, { registry, identity, drifts, gaps, kind });
  printGuardReport(packPath, result.violations);
  if (!result.ok) process.exit(1);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export const program = new Command();
program.name("selfwright").description("Selfwright career-management CLI").version("0.0.1");

// ── score ─────────────────────────────────────────────────────────────────────
program
  .command("score <jd-path>")
  .description("Score a job description against your archetypes")
  .action(async (jdPath: string) => {
    const jdText = await readText(jdPath);
    const truth = loadTruth();
    const archetypes = mustOk(await truth.loadArchetypes(), "archetypes");
    const ontology = mustOk(await truth.loadOntology(), "ontology");
    const registry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
    const vocabulary = await loadScoringVocabularyFile(getDataDir());
    const result = scoreService({ jdText, archetypes, ontology, registry, vocabulary });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  });

// ── ats ───────────────────────────────────────────────────────────────────────
program
  .command("ats <jd-path> <cv-path>")
  .description("Run ATS pass-through analysis")
  .option("--threshold <n>", "Pass threshold (0–1)", parseFloat)
  .option("--weight-a <n>", "Pass-A weight", parseFloat)
  .option("--weight-b <n>", "Pass-B weight", parseFloat)
  .option("--out <file>", "Write result JSON to file instead of stdout")
  .action(
    async (
      jdPath: string,
      cvPath: string,
      opts: { threshold?: number; weightA?: number; weightB?: number; out?: string },
    ) => {
      const jdText = await readText(jdPath);
      const cv = await loadJson<CvContent>(cvPath);
      const truth = loadTruth();
      const ontology = mustOk(await truth.loadOntology(), "ontology");
      const evidenceRegistry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
      const atsOpts: { threshold?: number; weightA?: number; weightB?: number } = {};
      if (opts.threshold !== undefined) atsOpts.threshold = opts.threshold;
      if (opts.weightA !== undefined) atsOpts.weightA = opts.weightA;
      if (opts.weightB !== undefined) atsOpts.weightB = opts.weightB;
      const result = atsService({
        jdText,
        cv,
        evidenceRegistry,
        ontology,
        opts: atsOpts,
      });
      const json = JSON.stringify(result, null, 2) + "\n";
      if (opts.out) {
        await writeFile(resolve(opts.out), json, "utf-8");
        process.stderr.write(`Wrote ${opts.out}\n`);
      } else {
        process.stdout.write(json);
      }
    },
  );

// ── tailor ────────────────────────────────────────────────────────────────────
program
  .command("tailor <cv-content-path>")
  .description("Apply a tailoring overlay to a CV")
  .requiredOption("--overlay <overlay-path>", "Path to overlay JSON")
  .option("--map <ev-map-path>", "Path to evidence map JSON")
  .requiredOption("--out <out-path>", "Output path for tailored CV JSON")
  .action(
    async (
      cvPath: string,
      opts: { overlay: string; map?: string; out: string },
    ) => {
      const cv = await loadJson<CvContent>(cvPath);
      const rawOverlay = await loadJson<unknown>(opts.overlay);
      const rawObj = typeof rawOverlay === "object" && rawOverlay !== null ? (rawOverlay as Record<string, unknown>) : {};
      if ("inject_drifts" in rawObj && !("drift_applications" in rawObj)) {
        process.stderr.write(`[tailor] warn: legacy inject_drifts field detected — auto-migrated to drift_applications\n`);
      }
      let overlay: CvOverlay;
      try {
        overlay = migrateCareerPlanOverlay(rawOverlay);
      } catch (e) {
        process.stderr.write(
          `Error: invalid overlay at ${opts.overlay}: ${e instanceof Error ? e.message : String(e)}\n`,
        );
        process.exit(1);
      }
      const mapPath = opts.map ?? join(dirname(resolve(cvPath)), "cv-evidence-map.json");
      const evidenceMap = await loadJson<EvidenceMap>(mapPath);
      const truth = loadTruth();
      const evidenceRegistry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
      const registryIds = new Set(evidenceRegistry.map((e) => e.id));
      const identity = mustOk(await truth.loadIdentity(), "identity");
      let drifts: DriftEntry[] = [];
      const driftsResult = await truth.loadDrifts();
      if (driftsResult.ok) drifts = driftsResult.value;
      const result = tailorService(cv, overlay, evidenceMap, registryIds, {
        registry: evidenceRegistry,
        identity,
        drifts,
      });
      if (!result.ok) {
        process.stderr.write(`Tailor error: ${result.error.kind} — ${result.error.message}\n`);
        process.exit(1);
      }
      const json = JSON.stringify(result.value, null, 2) + "\n";
      await writeFile(resolve(opts.out), json, "utf-8");
      process.stderr.write(`Wrote tailored CV to ${opts.out}\n`);
    },
  );

// ── cover ─────────────────────────────────────────────────────────────────────
// Co-pilot by default: assembles a grounded prompt and stops (no LLM call).
// --check validates an existing cover-letter.md. --adapter is the optional
// headless escape hatch (calls the chosen LlmPort adapter, then auto-checks).
program
  .command("cover <app-dir>")
  .description("Cover letter: write a co-piloted prompt (default), --check a letter, or --adapter headlessly")
  .option("--check", "Validate <app-dir>/cover-letter.md instead of writing a prompt")
  .option("--adapter <name>", "Headless generation via an LlmPort adapter: cli, litellm, or ollama")
  .action(async (appDir: string, opts: { check?: boolean; adapter?: string }) => {
    const absAppDir = resolve(appDir);

    if (opts.check) {
      await runCoverCheck(absAppDir);
      return;
    }

    const jdText = await readText(join(absAppDir, "job-description.md"));
    const tailoredCv = await loadJson<TailoredCvContent>(join(absAppDir, "cv-tailored.json"));
    const companyResearchRaw = await tryReadFile(join(absAppDir, "company-research.md"));
    const truth = loadTruth();
    const identity = mustOk(await truth.loadIdentity(), "identity");
    const coverCtx: Parameters<typeof coverService>[0] = { jdText, tailoredCv, identity };
    if (companyResearchRaw !== null) coverCtx.companyResearch = companyResearchRaw;

    if (opts.adapter) {
      const llm = loadAdapter(opts.adapter);
      const result = await coverService(coverCtx, llm);
      const outPath = join(absAppDir, "cover-letter.md");
      await writeFile(outPath, result.markdown, "utf-8");
      process.stderr.write(`Wrote cover letter (${result.wordCount} words) to ${outPath}\n`);
      await runCoverCheck(absAppDir);
      return;
    }

    const systemPrompt = buildCoverSystemPrompt(identity, coverCtx.styleGuide);
    const userPrompt = buildCoverUserPrompt(coverCtx);
    const promptPath = join(absAppDir, "cover-prompt.md");
    await writeFile(promptPath, `${systemPrompt}\n\n---\n\n${userPrompt}`, "utf-8");
    process.stderr.write(
      `Wrote ${promptPath}\n` +
        `Generate the letter from this prompt into cover-letter.md, then run ` +
        `\`selfwright cover ${appDir} --check\`.\n`,
    );
  });

// ── research ──────────────────────────────────────────────────────────────────
// Co-pilot by default: assembles a grounded prompt and stops (no LLM call).
// --check validates an existing research artifact. --adapter is the optional
// headless escape hatch (calls the chosen LlmPort adapter, then auto-checks).
program
  .command("research <company> <role-title> <jd-path>")
  .description("Company research: write a co-piloted prompt (default), --check an artifact, or --adapter headlessly")
  .option("--out <out-path>", "Output path (default: <jd-dir>/company-research.md)")
  .option("--check", "Validate the research artifact instead of writing a prompt")
  .option("--adapter <name>", "Headless generation via an LlmPort adapter: cli, litellm, or ollama")
  .action(
    async (
      company: string,
      roleTitle: string,
      jdPath: string,
      opts: { out?: string; check?: boolean; adapter?: string },
    ) => {
      const outPath = resolve(opts.out ?? join(dirname(resolve(jdPath)), "company-research.md"));

      if (opts.check) {
        await runResearchCheck(outPath);
        return;
      }

      const jdText = await readText(jdPath);
      const truth = loadTruth();
      const identity = mustOk(await truth.loadIdentity(), "identity");
      const researchCtx: Parameters<typeof researchService>[0] = { company, roleTitle, jdText, identity };

      if (opts.adapter) {
        const llm = loadAdapter(opts.adapter);
        const result = await researchService(researchCtx, llm);
        await writeFile(outPath, result.markdown, "utf-8");
        process.stderr.write(`Wrote research to ${outPath}\n`);
        await runResearchCheck(outPath);
        return;
      }

      const promptPath = join(dirname(outPath), "research-prompt.md");
      await writeFile(promptPath, buildResearchPrompt(researchCtx), "utf-8");
      process.stderr.write(
        `Wrote ${promptPath}\n` +
          `Generate the research from this prompt into ${outPath}, then re-run this command with --check.\n`,
      );
    },
  );

// ── gap-scan ──────────────────────────────────────────────────────────────────
// No LLM involved. Computes coverage gaps for an archetype against the evidence
// registry and prints a report. --check validates the gaps.yml ledger itself.
program
  .command("gap-scan <archetype-id>")
  .description("Scan skill-gap coverage for an archetype (no LLM), or --check gaps.yml")
  .option("--out <path>", "Write report to file instead of stdout")
  .option("--check", "Validate gaps.yml against evidence registry and honesty rules")
  .action(async (archetypeId: string, opts: { out?: string; check?: boolean }) => {
    const truth = loadTruth();

    if (opts.check) {
      const gaps = mustOk(await truth.loadGaps(), "gaps");
      const registry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
      let drifts: DriftEntry[] = [];
      const driftsResult = await truth.loadDrifts();
      if (driftsResult.ok) drifts = driftsResult.value;
      const result = validateGapArtifact(gaps, { registry, drifts });
      printGuardReport(join(getDataDir(), "truth", "gaps.yml"), result.violations);
      if (!result.ok) process.exit(1);
      return;
    }

    const registry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
    const ontology = mustOk(await truth.loadOntology(), "ontology");
    const gaps = mustOk(await truth.loadGaps(), "gaps");
    const archetypes = mustOk(await truth.loadArchetypes(), "archetypes");
    const archetype = archetypes.find((a) => a.id === archetypeId);
    if (!archetype) {
      process.stderr.write(`Error: archetype "${archetypeId}" not found\n`);
      process.exit(1);
    }

    const candidates = computeCoverageGaps(archetype, registry, ontology, gaps);

    // Load debriefs best-effort for derived hints (never-crash convention)
    let debriefHints: GapHint[] | undefined;
    const debriefs = await tryLoadDebriefs(getDataDir());
    if (debriefs.length > 0) {
      debriefHints = deriveGapHintsFromDebriefs(debriefs, registry, ontology);
    }

    const report = gapScanService(candidates, debriefHints);

    if (opts.out) {
      await writeFile(resolve(opts.out), report, "utf-8");
      process.stderr.write(`Wrote ${opts.out}\n`);
    } else {
      process.stdout.write(report);
    }

    // Notify with uncovered candidate ids; cap at 10 to keep the notification short.
    // IDs only, never free text: skip (rather than leak the raw topic string)
    // any candidate with neither an existing nor a suggested gap id.
    const uncoveredIds = candidates
      .filter((c) => c.coverage === "uncovered")
      .slice(0, 10)
      .map((c) => c.existingGapId ?? c.suggestedGapId)
      .filter((id): id is string => id !== undefined);
    if (uncoveredIds.length > 0) {
      await notifyCoaching(uncoveredIds, "Skill-gap scan");
    }
  });

// ── drill ─────────────────────────────────────────────────────────────────────
// Co-pilot by default: selects the next drill topic and writes a grounded prompt.
// --check validates a completed drill transcript. --adapter is the headless path
// (writes the question only — does NOT auto-check, since the human must still
// answer and a co-pilot must critique before the transcript is checkable).
program
  .command("drill <archetype-id>")
  .description("Drill: write a co-piloted prompt (default), --check a transcript, or --adapter headlessly")
  .option("--out <path>", "Output path for the prompt file (default: <cwd>/drill-prompt.md)")
  .option("--check <transcript-path>", "Validate a completed drill transcript file")
  .option("--adapter <name>", "Headless generation via an LlmPort adapter: cli, litellm, or ollama")
  .action(async (archetypeId: string, opts: { out?: string; check?: string; adapter?: string }) => {
    if (opts.check !== undefined) {
      const text = await readText(opts.check);
      const truth = loadTruth();
      const registry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
      const identity = mustOk(await truth.loadIdentity(), "identity");
      let drifts: DriftEntry[] = [];
      const driftsResult = await truth.loadDrifts();
      if (driftsResult.ok) drifts = driftsResult.value;
      const gaps = mustOk(await truth.loadGaps(), "gaps");
      const result = validateDrillArtifact(text, { registry, identity, drifts, gaps });
      printGuardReport(opts.check, result.violations);
      if (!result.ok) process.exit(1);
      return;
    }

    const truth = loadTruth();
    const registry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
    const ontology = mustOk(await truth.loadOntology(), "ontology");
    const gaps = mustOk(await truth.loadGaps(), "gaps");
    const archetypes = mustOk(await truth.loadArchetypes(), "archetypes");
    const archetype = archetypes.find((a) => a.id === archetypeId);
    if (!archetype) {
      process.stderr.write(`Error: archetype "${archetypeId}" not found\n`);
      process.exit(1);
    }
    const identity = mustOk(await truth.loadIdentity(), "identity");

    const dataDir = getDataDir();
    const drillHistoryPath = join(dataDir, "coaching", "drill-history.yml");

    // Load drill history — treat missing file as empty history (same ENOENT-tolerance as scan).
    const historyRaw = await tryReadFile(drillHistoryPath);
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

    // Resolve full EvidenceEntry objects for each item in the evidence bundle.
    const evidenceDetails: EvidenceEntry[] = selection.evidenceBundle
      .map((re) => registry.find((e) => e.id === re.id))
      .filter((e): e is EvidenceEntry => e !== undefined);

    const ctx: DrillContext = { selection, identity, archetypeId, evidenceDetails };
    const outPath = resolve(opts.out ?? "drill-prompt.md");

    if (opts.adapter) {
      const llm = loadAdapter(opts.adapter);
      const result = await drillService(ctx, llm);
      await writeFile(outPath, result.markdown, "utf-8");
      process.stderr.write(`Wrote drill output to ${outPath}\n`);
      // No auto-check here: a headless drill produces the question + model answer, but
      // validateDrillArtifact expects a transcript where the human has supplied their own
      // answer. The check belongs after the human responds, not immediately after generation.
    } else {
      const systemPrompt = buildDrillSystemPrompt();
      const userPrompt = buildDrillUserPrompt(ctx);
      await writeFile(outPath, `${systemPrompt}\n\n---\n\n${userPrompt}`, "utf-8");
      process.stderr.write(
        `Wrote ${outPath}\n` +
          `Use this prompt in a co-piloted chat, then save the transcript and run ` +
          `\`selfwright drill ${archetypeId} --check <transcript-path>\`.\n`,
      );
    }

    // Append new entry to drill history (read-modify-write).
    history.push({ topicId: selection.topicId, kind: selection.kind, at: new Date().toISOString() });
    await mkdir(dirname(drillHistoryPath), { recursive: true });
    await writeFile(drillHistoryPath, stringifyYaml({ history }), "utf-8");

    // IDs only, never free text: selection.topicId is a raw archetype keyword
    // for "stretch"/"strength" selections, not an id — never send it. Use the
    // evidence bundle's EVD-* ids instead (already capped at 5 by
    // selectEvidenceForTopic); only kind === "gap" has a real id to send directly.
    const drillNotifyIds =
      selection.kind === "gap" && selection.gap !== undefined
        ? [selection.gap.id]
        : selection.evidenceBundle.map((e) => e.id);
    if (drillNotifyIds.length > 0) {
      await notifyCoaching(drillNotifyIds, "Next drill");
    }
  });

// ── prep-pack ─────────────────────────────────────────────────────────────────
// Co-pilot by default: assembles a grounded prompt and stops (no LLM call).
// --check validates an existing prep-pack.md. --adapter is the headless path
// (calls the chosen LlmPort adapter, then auto-checks — mirrors cover --adapter exactly,
// since a headless prep-pack produces a complete, checkable artifact).
program
  .command("prep-pack <app-dir>")
  .description("Prep-pack: write a co-piloted prompt (default), --check a pack, or --adapter headlessly")
  .option("--kind <interview|networking|event>", "Prep-pack kind", "interview")
  .option("--archetype <id>", "Archetype id for coverage gap analysis")
  .option("--context-file <path>", "Networking/event background text file")
  .option("--check", "Validate <app-dir>/prep-pack.md instead of writing a prompt")
  .option("--adapter <name>", "Headless generation via an LlmPort adapter: cli, litellm, or ollama")
  .action(
    async (
      appDir: string,
      opts: {
        kind: string;
        archetype?: string;
        contextFile?: string;
        check?: boolean;
        adapter?: string;
      },
    ) => {
      const absAppDir = resolve(appDir);
      const kind = opts.kind as PrepPackKind;

      if (opts.check) {
        await runPrepPackCheck(absAppDir, kind);
        return;
      }

      const truth = loadTruth();
      const identity = mustOk(await truth.loadIdentity(), "identity");
      const registry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
      const ontology = mustOk(await truth.loadOntology(), "ontology");
      const gaps = mustOk(await truth.loadGaps(), "gaps");

      let archetypeFound: Archetype | undefined = undefined;
      if (opts.archetype !== undefined) {
        const archetypes = mustOk(await truth.loadArchetypes(), "archetypes");
        archetypeFound = archetypes.find((a) => a.id === opts.archetype);
        if (!archetypeFound) {
          process.stderr.write(`Error: archetype "${opts.archetype}" not found\n`);
          process.exit(1);
        }
      }

      // Read job description or context text.
      let jdText: string | undefined;
      let contextText: string | undefined;
      if (kind === "interview") {
        // Mirror cover command's exact path/read logic.
        jdText = await readText(join(absAppDir, "job-description.md"));
      } else {
        // Networking/event: --context-file flag or <app-dir>/context.md (best-effort).
        if (opts.contextFile !== undefined) {
          contextText = await readText(opts.contextFile);
        } else {
          contextText = await tryReadFile(join(absAppDir, "context.md")) ?? undefined;
        }
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
        ...(opts.archetype !== undefined ? { archetypeId: opts.archetype } : {}),
        ...(jdText !== undefined ? { jdText } : {}),
        ...(contextText !== undefined ? { contextText } : {}),
        candidateGaps,
        gaps,
        topEvidence,
        evidenceDetails,
      };

      if (opts.adapter) {
        const llm = loadAdapter(opts.adapter);
        const result = await prepPackService(ctx, llm);
        const packPath = join(absAppDir, "prep-pack.md");
        await writeFile(packPath, result.markdown, "utf-8");
        process.stderr.write(`Wrote prep-pack to ${packPath}\n`);
        await runPrepPackCheck(absAppDir, kind);
      } else {
        const systemPrompt = buildPrepPackSystemPrompt(kind);
        const userPrompt = buildPrepPackUserPrompt(ctx);
        const promptPath = join(absAppDir, "prep-pack-prompt.md");
        await writeFile(promptPath, `${systemPrompt}\n\n---\n\n${userPrompt}`, "utf-8");
        process.stderr.write(
          `Wrote ${promptPath}\n` +
            `Generate the prep-pack from this prompt into ${join(absAppDir, "prep-pack.md")}, ` +
            `then run \`selfwright prep-pack ${appDir} --check\`.\n`,
        );
      }

      // Notify with EVD-*/GAP-* ids from candidateGaps and loaded gaps; cap at 10.
      const notifyIds = [
        ...candidateGaps.flatMap((c) => [
          ...c.evidenceIds,
          ...(c.existingGapId !== undefined ? [c.existingGapId] : []),
        ]),
        ...gaps.map((g) => g.id),
      ]
        .filter((id, i, arr) => arr.indexOf(id) === i) // dedupe
        .slice(0, 10);
      if (notifyIds.length > 0) {
        await notifyCoaching(notifyIds, "Prep-pack ready");
      }
    },
  );

// ── topics ────────────────────────────────────────────────────────────────────
// Co-pilot by default: selects ranked topic candidates and writes a grounded prompt.
// --check validates an existing digest. --app drives application-specific topics.
// --adapter is the headless escape hatch (calls the chosen LlmPort adapter, then auto-checks).
program
  .command("topics [archetype-id]")
  .description(
    "Content topics: write a co-piloted prompt (default), --check a digest, or --app for application mode",
  )
  .option("--app <dir>", "Application mode: use this directory's job-description.md")
  .option("--check <path>", "Validate a completed topics digest file")
  .option("--adapter <name>", "Headless generation via an LlmPort adapter: cli, litellm, or ollama")
  .action(
    async (
      archetypeId: string | undefined,
      opts: { app?: string; check?: string; adapter?: string },
    ) => {
      const dataDir = getDataDir();

      if (archetypeId === undefined && opts.app === undefined) {
        process.stderr.write("Error: either <archetype-id> or --app <dir> is required\n");
        process.exit(1);
      }

      const truth = loadTruth();
      const registry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
      const identity = mustOk(await truth.loadIdentity(), "identity");
      const gaps = mustOk(await truth.loadGaps(), "gaps");

      if (opts.check !== undefined) {
        // Check mode: validate the artifact at the given path. The validator only needs
        // registry/identity/drifts/gaps (id existence + honesty/trace) — no candidate
        // recomputation, matching drill/prep-pack semantics (id existence, not
        // offered-set membership).
        const text = await readText(opts.check);
        let drifts: DriftEntry[] = [];
        const driftsResult = await truth.loadDrifts();
        if (driftsResult.ok) drifts = driftsResult.value;
        const result = validateTopicsArtifact(text, { registry, identity, drifts, gaps });
        printGuardReport(opts.check, result.violations);
        if (!result.ok) process.exit(1);
        return;
      }

      // Generate path: resolve candidates for the archetype/JD context.
      const ontology = mustOk(await truth.loadOntology(), "ontology");
      let candidates: ContentTopicCandidate[] = [];
      let jdText: string | undefined;
      let contentHistory: ContentHistoryEntry[] = [];
      const contentHistoryPath = join(dataDir, "content", "content-history.yml");

      if (archetypeId !== undefined) {
        const archetypes = mustOk(await truth.loadArchetypes(), "archetypes");
        const archetype = archetypes.find((a) => a.id === archetypeId);
        if (!archetype) {
          process.stderr.write(`Error: archetype "${archetypeId}" not found\n`);
          process.exit(1);
        }
        const historyRaw = await tryReadFile(contentHistoryPath);
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
        // Application mode (opts.app is guaranteed defined: guard above exits if both are missing)
        const absAppDir = resolve(opts.app as string);
        jdText = await readText(join(absAppDir, "job-description.md"));
        const archetypes = mustOk(await truth.loadArchetypes(), "archetypes");
        const jdKeywords = deriveJdTopicKeywords(jdText, archetypes);
        candidates = selectContentTopicsForApplication(jdKeywords, registry, gaps, ontology);
      }

      // Generate path: build TopicsContext and write prompt (or run headless).
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
        ...(opts.app !== undefined ? { appRef: opts.app } : {}),
        candidates,
        evidenceDetails,
        gaps,
      };

      if (opts.adapter) {
        let drifts: DriftEntry[] = [];
        const driftsResult = await truth.loadDrifts();
        if (driftsResult.ok) drifts = driftsResult.value;
        const llm = loadAdapter(opts.adapter);
        const genResult = await topicsService(topicsCtx, llm);
        const date = new Date().toISOString().slice(0, 10);
        const digestPath = archetypeId !== undefined
          ? join(dataDir, "content", "digests", `${date}-${archetypeId}.md`)
          : join(resolve(opts.app as string), "topics.md");
        await mkdir(dirname(digestPath), { recursive: true });
        await writeFile(digestPath, genResult.markdown, "utf-8");
        process.stderr.write(`Wrote topics digest to ${digestPath}\n`);
        const checkResult = validateTopicsArtifact(genResult.markdown, {
          registry,
          identity,
          drifts,
          gaps,
        });
        printGuardReport(digestPath, checkResult.violations);
        if (!checkResult.ok) process.exit(1);
      } else {
        const systemPrompt = buildTopicsSystemPrompt(topicsCtx.mode);
        const userPrompt = buildTopicsUserPrompt(topicsCtx);
        const promptPath = archetypeId !== undefined
          ? join(dataDir, "content", "topics-prompt.md")
          : join(resolve(opts.app as string), "topics-prompt.md");
        const date = new Date().toISOString().slice(0, 10);
        const digestPath = archetypeId !== undefined
          ? join(dataDir, "content", "digests", `${date}-${archetypeId}.md`)
          : join(resolve(opts.app as string), "topics.md");
        await mkdir(dirname(promptPath), { recursive: true });
        await writeFile(promptPath, `${systemPrompt}\n\n---\n\n${userPrompt}`, "utf-8");
        process.stderr.write(
          `Wrote ${promptPath}\n` +
            `Generate the topics digest from this prompt into ${digestPath}, then run ` +
            `\`selfwright topics ${archetypeId ?? `--app ${opts.app}`} --check ${digestPath}\`.\n`,
        );
      }

      // Append candidates to content history (digest mode only; read-modify-write).
      if (archetypeId !== undefined) {
        for (const c of candidates) {
          contentHistory.push({ topic: c.topic, direction: c.direction, at: new Date().toISOString() });
        }
        await mkdir(join(dataDir, "content"), { recursive: true });
        await writeFile(contentHistoryPath, stringifyYaml({ history: contentHistory }), "utf-8");
      }

      // Print summary table of candidates.
      process.stdout.write(`\nTopic candidates${archetypeId !== undefined ? ` for ${archetypeId}` : ""}:\n`);
      for (const c of candidates) {
        const evdIds = c.evidenceBundle.map((e) => e.id).join(", ");
        const gapRef = c.gapId !== undefined ? ` [${c.gapId}]` : "";
        process.stdout.write(
          `  [${c.direction}/${c.kind}] ${c.topic}${gapRef}${evdIds.length > 0 ? ` — ${evdIds}` : ""}\n`,
        );
      }

      // Notify with EVD-*/GAP-* ids from candidates' evidence bundles and gapIds.
      // IDs only, never free text (same discipline as drill/prep-pack post b3430a5).
      const notifyIds = [
        ...candidates.flatMap((c) => [
          ...c.evidenceBundle.map((e) => e.id),
          ...(c.gapId !== undefined ? [c.gapId] : []),
        ]),
      ]
        .filter((id, i, arr) => arr.indexOf(id) === i) // dedupe
        .slice(0, 10);
      const notifyTitle = archetypeId !== undefined ? "Weekly topics ready" : "Application topics ready";
      if (notifyIds.length > 0) {
        await notifyCoaching(notifyIds, notifyTitle);
      }
    },
  );

// ── debrief ───────────────────────────────────────────────────────────────────
// Non-interactive, flags only. Reads/writes <dataDir>/coaching/debriefs.yml.
//
// IMPORTANT: interviewer/person NAMES must never go in debriefs.yml.
// The data repo's PII hook blocks names outside contacts/ and truth/.
// Reference people via contacts entries instead.
const debriefCmd = program
  .command("debrief")
  .description("Interview debrief management (add a record, list records)");

debriefCmd
  .command("add")
  .description("Add an interview debrief record (non-interactive, flags only)")
  .requiredOption("--app <id>", "Application id (matches applications.yml id)")
  .requiredOption("--date <YYYY-MM-DD>", "Interview date")
  .option("--round <label>", 'Round label, e.g. "HR screen", "hiring manager", "panel"')
  .option(
    "--asked <topics>",
    "Semicolon-separated topics/questions that were asked. No person names.",
  )
  .option(
    "--wobbled <topics>",
    "Semicolon-separated topics that went badly — feed the gap/drill machinery.",
  )
  .option("--went-well <topics>", "Semicolon-separated topics that went well")
  .option("--notes <text>", "Free-form notes. No person/interviewer names — use contacts/ for that.")
  .action(
    async (opts: {
      app: string;
      date: string;
      round?: string;
      asked?: string;
      wobbled?: string;
      wentWell?: string;
      notes?: string;
    }) => {
      const dataDir = getDataDir();

      function splitSemi(s: string | undefined): string[] | undefined {
        if (s === undefined || s.trim() === "") return undefined;
        const parts = s.split(";").map((p) => p.trim()).filter(Boolean);
        return parts.length > 0 ? parts : undefined;
      }

      const askedArr = splitSemi(opts.asked);
      const wobbledArr = splitSemi(opts.wobbled);
      const wentWellArr = splitSemi(opts.wentWell);

      const rawEntry = {
        application_id: opts.app,
        date: opts.date,
        ...(opts.round !== undefined ? { round: opts.round } : {}),
        ...(askedArr !== undefined ? { asked: askedArr } : {}),
        ...(wobbledArr !== undefined ? { wobbled: wobbledArr } : {}),
        ...(wentWellArr !== undefined ? { went_well: wentWellArr } : {}),
        ...(opts.notes !== undefined ? { notes: opts.notes } : {}),
      };

      // Validate with schema before writing
      let entry: Debrief;
      try {
        entry = DebriefSchema.parse(rawEntry);
      } catch (e) {
        process.stderr.write(
          `Error: invalid debrief data: ${e instanceof Error ? e.message : String(e)}\n`,
        );
        process.exit(1);
      }

      await appendDebrief(dataDir, entry);
      process.stderr.write(
        `Debrief for ${opts.app} (${opts.date}) appended to ${DEBRIEFS_REL}\n`,
      );

      // Suggest next step if wobbled topics were recorded
      if (entry.wobbled !== undefined && entry.wobbled.length > 0) {
        process.stderr.write(
          `Wobbled topics recorded: ${entry.wobbled.join(", ")}\n` +
            `Run \`selfwright gap-scan <archetype-id>\` to see debrief-derived hints.\n`,
        );
      }
    },
  );

debriefCmd
  .command("list")
  .description("List debrief records")
  .option("--app <id>", "Filter by application id")
  .action(async (opts: { app?: string }) => {
    const dataDir = getDataDir();
    const debriefs = await tryLoadDebriefs(dataDir);
    const filtered = opts.app !== undefined
      ? debriefs.filter((d) => d.application_id === opts.app)
      : debriefs;

    if (filtered.length === 0) {
      process.stdout.write(
        opts.app !== undefined
          ? `No debriefs found for application ${opts.app}\n`
          : "No debriefs recorded yet\n",
      );
      return;
    }

    for (const d of filtered) {
      process.stdout.write(`\n--- ${d.application_id} (${d.date})${d.round !== undefined ? ` — ${d.round}` : ""} ---\n`);
      if (d.wobbled !== undefined && d.wobbled.length > 0) {
        process.stdout.write(`  Wobbled: ${d.wobbled.join("; ")}\n`);
      }
      if (d.asked !== undefined && d.asked.length > 0) {
        process.stdout.write(`  Asked:   ${d.asked.join("; ")}\n`);
      }
      if (d.went_well !== undefined && d.went_well.length > 0) {
        process.stdout.write(`  Well:    ${d.went_well.join("; ")}\n`);
      }
      if (d.notes !== undefined) {
        process.stdout.write(`  Notes:   ${d.notes}\n`);
      }
    }
    process.stdout.write("\n");
  });

// ── inbox ─────────────────────────────────────────────────────────────────────
program
  .command("inbox")
  .description("Print the 3-tier signal digest")
  .option("--format <format>", "Output format: json or text", "text")
  .option("--archetype <id>", "Archetype id to add coaching signals (gap scan + next drill)")
  .option("--notify", "Push ntfy notification with tier counts and item IDs (requires NTFY_URL)")
  .action(async (opts: { format: string; archetype?: string; notify?: boolean }) => {
    const dataDir = getDataDir();
    const settings = loadSettings(join(dataDir, "settings.yml"));
    const effectiveArchetype = opts.archetype ?? settings.coachingDefaultArchetype;

    let applications: ApplicationRecord[] = [];
    const applicationsRaw = await tryReadFile(join(dataDir, "applications", "applications.yml"));
    if (applicationsRaw !== null) {
      const parsed: unknown = parseYaml(applicationsRaw);
      if (Array.isArray(parsed)) {
        applications = parsed.filter(
          (a): a is ApplicationRecord => a !== null && typeof a === "object",
        );
      }
    }

    let queue: QueueEntry[] = [];
    const queueRaw = await tryReadFile(join(dataDir, "pipeline", "queue.yml"));
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

    const truth = loadTruth();
    let drifts: DriftEntry[] = [];
    const driftsResult = await truth.loadDrifts();
    if (driftsResult.ok) drifts = driftsResult.value;

    // Load debriefs best-effort (never-crash convention)
    const inboxDebriefs = await tryLoadDebriefs(dataDir);

    const data: InboxData = { applications, queue, drifts, debriefs: inboxDebriefs };

    if (effectiveArchetype !== undefined) {
      const archetypes = mustOk(await truth.loadArchetypes(), "archetypes");
      const inboxArchetype = archetypes.find((a) => a.id === effectiveArchetype);
      if (!inboxArchetype) {
        process.stderr.write(`Error: archetype "${effectiveArchetype}" not found\n`);
        process.exit(1);
      }
      const inboxRegistry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
      const inboxOntology = mustOk(await truth.loadOntology(), "ontology");
      const inboxGaps = mustOk(await truth.loadGaps(), "gaps");
      const candidateGaps = computeCoverageGaps(inboxArchetype, inboxRegistry, inboxOntology, inboxGaps);

      const inboxHistoryPath = join(dataDir, "coaching", "drill-history.yml");
      const inboxHistoryRaw = await tryReadFile(inboxHistoryPath);
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

      // Best-effort: selectNextDrillTopic throws only when there is truly nothing to drill.
      let nextDrill: DrillSelection | undefined;
      try {
        nextDrill = selectNextDrillTopic(inboxHistory, inboxGaps, inboxArchetype, inboxRegistry, inboxOntology);
      } catch {
        // No drill candidates available — omit the coaching.nextDrill field.
      }

      // lastDrillAt: most recent drill timestamp, for drillCadenceDays suppression in inboxService.
      const lastDrillAt = inboxHistory.length > 0
        ? [...inboxHistory].sort((a, b) => b.at.localeCompare(a.at))[0]?.at
        : undefined;
      data.coaching = nextDrill !== undefined
        ? { candidateGaps, nextDrill, ...(lastDrillAt !== undefined ? { lastDrillAt } : {}) }
        : { candidateGaps, ...(lastDrillAt !== undefined ? { lastDrillAt } : {}) };

      // candidateCount for the content tier (reuse already-loaded truth data — don't reload).
      const contentHistoryForInboxPath = join(dataDir, "content", "content-history.yml");
      const contentHistoryForInboxRaw = await tryReadFile(contentHistoryForInboxPath);
      let contentHistoryForInbox: ContentHistoryEntry[] = [];
      if (contentHistoryForInboxRaw !== null) {
        const parsed: unknown = parseYaml(contentHistoryForInboxRaw);
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          "history" in parsed &&
          Array.isArray((parsed as Record<string, unknown>)["history"])
        ) {
          contentHistoryForInbox = (parsed as { history: ContentHistoryEntry[] }).history;
        }
      }
      const contentCandidateCount = selectContentTopics(
        inboxArchetype,
        inboxRegistry,
        inboxGaps,
        contentHistoryForInbox,
        inboxOntology,
      ).length;
      // Set later alongside lastDigestAt.
      data.content = { ...data.content, candidateCount: contentCandidateCount };
    }

    // Content signals: scan for newest digest by filename date (always, independent of --archetype).
    {
      const digestFiles = await readdir(join(dataDir, "content", "digests")).catch(() => null);
      let lastDigestAt: string | undefined;
      if (digestFiles !== null) {
        // Files are named <YYYY-MM-DD>-<archetype>.md — extract date from filename (deterministic).
        const dates = digestFiles
          .filter((f) => /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(f))
          .map((f) => f.slice(0, 10))
          .sort()
          .reverse();
        if (dates.length > 0 && dates[0] !== undefined) {
          lastDigestAt = dates[0];
        }
      }
      data.content = {
        ...(lastDigestAt !== undefined ? { lastDigestAt } : {}),
        ...(data.content !== undefined ? { candidateCount: data.content.candidateCount } : {}),
      };
    }

    const report = inboxService(data, undefined, {
      agingWindowDays: settings.agingWindowDays,
      interviewStaleDays: settings.interviewStaleDays,
      appliedReviewDays: settings.appliedReviewDays,
      appliedDecideDays: settings.appliedDecideDays,
      fitScoreCutoffReviewSoon: settings.fitScoreCutoffReviewSoon,
      debriefNudgeDays: settings.debriefNudgeDays,
      drillCadenceDays: settings.drillCadenceDays,
    });

    if (opts.format === "json") {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    } else {
      const lines: string[] = [];
      lines.push(`Selfwright Inbox — ${report.asOf}`);
      lines.push("");

      lines.push("🔴 Decide-now");
      if (report.decideNow.length === 0) {
        lines.push("  (none)");
      } else {
        for (const item of report.decideNow) {
          lines.push(`  ${item.id}: ${item.title} — ${item.detail}`);
        }
      }
      lines.push("");

      lines.push("🟡 Review-soon");
      if (report.reviewSoon.length === 0) {
        lines.push("  (none)");
      } else {
        for (const item of report.reviewSoon) {
          lines.push(`  ${item.id}: ${item.title} — ${item.detail}`);
        }
      }
      lines.push("");

      lines.push("ℹ️  FYI");
      if (report.fyi.length === 0) {
        lines.push("  (none)");
      } else {
        for (const item of report.fyi) {
          lines.push(`  ${item.id}: ${item.title} — ${item.detail}`);
        }
      }
      lines.push("");
      process.stdout.write(lines.join("\n") + "\n");
    }

    if (opts.notify) {
      const payload = buildInboxNotifyPayload(report);
      if (payload !== null) {
        await notify(payload.message, { title: payload.title, digestKind: "inbox" }, {
          ...(settings.ntfyTopic !== undefined ? { urlOverride: settings.ntfyTopic } : {}),
          ...(settings.quietHours !== undefined ? { quietHours: settings.quietHours } : {}),
          ...(settings.enabledDigests !== undefined ? { enabledDigests: settings.enabledDigests } : {}),
        });
      }
    }
  });

// ── scan ──────────────────────────────────────────────────────────────────────
program
  .command("scan")
  .description("Scan configured job sources, dedupe, check liveness, score, and update the pipeline queue")
  .option("--targets <path>", "Path to scan-targets config", "config/scan-targets.yml")
  .option("--dry-run", "Fetch and score but do not write queue.yml/scan-history.yml")
  .option(
    "--verify",
    "Re-verify 'uncertain' postings with a headless browser (ADR 0012; requires `npx playwright install chromium` once)",
  )
  .option("--notify", "Push ntfy notification for new queue entries (IDs only; requires NTFY_URL)")
  .action(async (opts: { targets: string; dryRun?: boolean; verify?: boolean; notify?: boolean }) => {
    const targetsConfig = loadScanTargets(resolve(opts.targets));
    const dataDir = getDataDir();
    const settings = loadSettings(join(dataDir, "settings.yml"));
    // Apply settings defaults to each target; skip disabled targets with a stderr note.
    const activeTargets = targetsConfig.targets.flatMap((t) => {
      if (t.disabled === true) {
        process.stderr.write(`[scan] skip: ${t.company} (disabled in scan-targets.yml)\n`);
        return [];
      }
      return [
        {
          ...t,
          titleFilter: t.titleFilter ?? settings.aggregatorTitleFilter,
          locationFilter: t.locationFilter ?? settings.aggregatorLocationFilter,
        },
      ];
    });
    const truth = loadTruth();
    const archetypes = mustOk(await truth.loadArchetypes(), "archetypes");
    const ontology = mustOk(await truth.loadOntology(), "ontology");
    const synonymMap = buildSynonymMap(ontology);
    const vocabulary = await loadScoringVocabularyFile(dataDir);

    const scanHistoryPath = join(dataDir, "pipeline", "scan-history.yml");
    const queuePath = join(dataDir, "pipeline", "queue.yml");

    let seen: SeenEntry[] = [];
    const seenRaw = await tryReadFile(scanHistoryPath);
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
    const queueRaw = await tryReadFile(queuePath);
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
    const existingAppsRaw = await tryReadFile(join(dataDir, "applications", "applications.yml"));
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

    const queueLengthBefore = queue.length;
    const httpCtx = createHttpScanContext();
    const shouldVerify = opts.verify === true || settings.scanVerify;
    const browserCtx = shouldVerify ? createBrowserVerifyContext() : undefined;
    const ctx: ScanFetchContext = browserCtx
      ? { ...httpCtx, fetchRendered: (url: string) => browserCtx.fetchRendered(url) }
      : httpCtx;

    // workday-browser provider: lazily launches its own Chromium instance on
    // first use; closed in the finally block below regardless of outcome.
    const workdayBrowserProv = createWorkdayBrowserProvider();
    const scanProviders: Record<string, ScanProvider> = {
      ...SCAN_PROVIDERS,
      "workday-browser": workdayBrowserProv,
    };

    try {
      const scanNow = new Date().toISOString();
      const result = await runScan({
        targets: activeTargets,
        providers: scanProviders,
        ctx,
        archetypes,
        synonymMap,
        seen,
        queue,
        now: scanNow,
        vocabulary,
        existingApplications,
      });

      if (!opts.dryRun) {
        await writeFile(scanHistoryPath, stringifyYaml({ seen: result.seen }), "utf-8");
        // Backfill queuedAt for legacy entries (T5.5 fix): entries written before
        // T5.5 have no queuedAt so the aging window never clears them. Stamp each
        // missing entry with firstSeen from the seen ledger when available, else now.
        const queueToWrite = backfillQueuedAt(result.queue, result.seen, scanNow);
        await writeFile(queuePath, stringifyYaml({ queue: queueToWrite }), "utf-8");
      }

      for (const err of result.stats.providerErrors) {
        process.stderr.write(`[scan] warn: ${err}\n`);
      }
      process.stderr.write(
        `[scan] fetched ${result.stats.fetched}, deduped to ${result.stats.deduped}, ` +
          `${result.stats.alreadySeen} already seen, ${result.stats.expired} expired, ` +
          `${result.stats.browserVerified} browser-verified, ` +
          `${result.stats.queued} queued${opts.dryRun ? " (dry run — not written)" : ""}\n`,
      );

      if (opts.notify && !opts.dryRun && result.stats.queued > 0) {
        const newEntries = result.queue.slice(queueLengthBefore);
        const payload = buildScanNotifyPayload(newEntries);
        if (payload !== null) {
          await notify(payload.message, { title: payload.title, digestKind: "scan" }, {
            ...(settings.ntfyTopic !== undefined ? { urlOverride: settings.ntfyTopic } : {}),
            ...(settings.quietHours !== undefined ? { quietHours: settings.quietHours } : {}),
            ...(settings.enabledDigests !== undefined ? { enabledDigests: settings.enabledDigests } : {}),
          });
        }
      }
    } finally {
      await browserCtx?.close();
      await workdayBrowserProv.close();
    }
  });

// ── queue-add ─────────────────────────────────────────────────────────────────
// LinkedIn-safe manual capture lane. Never fetches the URL; the owner pastes
// JD text separately. Dedup-checked against the existing queue and applications
// before writing. Source is recorded as "manual" in both queue.yml and
// scan-history.yml so a future scan doesn't re-surface the same posting.
program
  .command("queue-add")
  .description(
    "Manually add a job posting to the pipeline queue (LinkedIn-safe: URL is not fetched)",
  )
  .requiredOption("--url <url>", "Posting URL (used as dedup key only; not fetched)")
  .requiredOption("--company <name>", "Company name")
  .requiredOption("--role <title>", "Role title")
  .option("--jd-file <path>", "Path to a job description text file to score")
  .option("--jd-stdin", "Read job description text from stdin to score")
  .option("--location <loc>", "Location (informational; not stored in queue schema)")
  .action(
    async (opts: {
      url: string;
      company: string;
      role: string;
      jdFile?: string;
      jdStdin?: boolean;
      location?: string;
    }) => {
      const dataDir = getDataDir();

      // ── Load existing data (best-effort; never crash on missing files) ─────
      const scanHistoryPath = join(dataDir, "pipeline", "scan-history.yml");
      const queuePath = join(dataDir, "pipeline", "queue.yml");

      let seen: SeenEntry[] = [];
      const seenRaw = await tryReadFile(scanHistoryPath);
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
      const queueRaw = await tryReadFile(queuePath);
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
      const appsRaw = await tryReadFile(join(dataDir, "applications", "applications.yml"));
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

      // ── Optional JD scoring ────────────────────────────────────────────────
      let fitScore: number | null = null;
      let jdText: string | undefined;

      if (opts.jdFile !== undefined) {
        jdText = await readText(opts.jdFile);
      } else if (opts.jdStdin) {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk as Buffer);
        }
        jdText = Buffer.concat(chunks).toString("utf-8");
      }

      if (jdText !== undefined) {
        const truth = loadTruth();
        const archetypes = mustOk(await truth.loadArchetypes(), "archetypes");
        const ontology = mustOk(await truth.loadOntology(), "ontology");
        const registry = mustOk(await truth.loadEvidenceRegistry(), "evidence registry");
        const vocabulary = await loadScoringVocabularyFile(dataDir);
        const scoreInput: ScoreInput = { jdText, archetypes, ontology, registry, vocabulary };
        const scored = scoreService(scoreInput);
        fitScore = scored.fit_score;
        process.stderr.write(
          `[queue-add] scored: archetype=${scored.archetype ?? "none"} fit_score=${fitScore} grade=${scored.grade}\n`,
        );
      }

      // ── Dedup + entry construction (pure core) ────────────────────────────
      const manualResult = buildManualEntry(
        {
          url: opts.url,
          company: opts.company,
          role: opts.role,
          now: new Date().toISOString(),
          fitScore,
        },
        seen,
        queue,
        existingApplications,
      );

      if (!manualResult.ok) {
        switch (manualResult.reason) {
          case "url-seen":
            process.stderr.write(
              `[queue-add] skipped: URL already in scan-history — ${opts.url}\n`,
            );
            break;
          case "queue-duplicate":
            process.stderr.write(
              `[queue-add] skipped: queue already has a matching entry — ` +
                `${manualResult.existingId} (${manualResult.existingCompany} / ${manualResult.existingRole})\n`,
            );
            break;
          case "application-duplicate":
            process.stderr.write(
              `[queue-add] skipped: already applied — ` +
                `${manualResult.existingId} (${manualResult.existingCompany} / ${manualResult.existingRole})\n`,
            );
            break;
        }
        process.exit(1);
      }

      // ── Write queue.yml and scan-history.yml ──────────────────────────────
      const newQueue = [...queue, manualResult.entry];
      const newSeen = [...seen, manualResult.seenEntry];

      await mkdir(join(dataDir, "pipeline"), { recursive: true });
      await writeFile(queuePath, stringifyYaml({ queue: newQueue }), "utf-8");
      await writeFile(scanHistoryPath, stringifyYaml({ seen: newSeen }), "utf-8");

      process.stderr.write(
        `[queue-add] added ${manualResult.entry.id} — ` +
          `${opts.company} / ${opts.role}` +
          (fitScore !== null ? ` (fit_score=${fitScore})` : "") +
          "\n",
      );
      process.stdout.write(JSON.stringify(manualResult.entry, null, 2) + "\n");
    },
  );

// ── metrics ───────────────────────────────────────────────────────────────────
program
  .command("metrics")
  .description("Print a cost and token usage report from <dataDir>/telemetry/usage.jsonl")
  .option("--file <path>", "Path to usage.jsonl (default: <dataDir>/telemetry/usage.jsonl)")
  .option("--format <format>", "Output format: text or json", "text")
  .action(async (opts: { file?: string; format: string }) => {
    // North-star + channel-outcome computation: best-effort, requires SELFWRIGHT_DATA_DIR + applications.yml
    let northStar: { submitted: number; interviews: number; ratePerTen: number | null } | null =
      null;
    let channelOutcomes: { channel: string; submitted: number; interviews: number; rate: number | null }[] = [];
    const nsDataDir = process.env["SELFWRIGHT_DATA_DIR"];
    if (nsDataDir) {
      const appsRaw = await tryReadFile(join(nsDataDir, "applications", "applications.yml"));
      if (appsRaw !== null) {
        try {
          const parsed: unknown = parseYaml(appsRaw);
          if (Array.isArray(parsed)) {
            northStar = computeNorthStar(parsed);
            channelOutcomes = computeChannelOutcomes(parsed);
          }
        } catch {
          process.stderr.write("warn: applications.yml could not be parsed — skipping north-star\n");
        }
      }
    }

    const resolvedUsageDataDir =
      nsDataDir ??
      (existsSync(resolve(process.cwd(), "..", "Selfwright-data"))
        ? resolve(process.cwd(), "..", "Selfwright-data")
        : null);
    const filePath = opts.file
      ? resolve(opts.file)
      : resolvedUsageDataDir
        ? resolve(resolvedUsageDataDir, "telemetry", "usage.jsonl")
        : null;
    const raw = filePath !== null ? await tryReadFile(filePath) : null;
    if (raw === null) {
      const location = filePath ?? "<data dir not found — set SELFWRIGHT_DATA_DIR>";
      process.stderr.write(`No usage data found at ${location}\n`);
      process.stderr.write("Usage is recorded when running headless --adapter commands.\n");
      if (northStar !== null) {
        if (opts.format === "json") {
          process.stdout.write(
            JSON.stringify(
              {
                totalRecords: 0,
                byRole: {},
                totals: { inputTokens: 0, outputTokens: 0, costUsd: 0, wallTimeMs: 0 },
                northStar,
                channelOutcomes,
              },
              null,
              2,
            ) + "\n",
          );
        } else {
          if (northStar.submitted === 0) {
            process.stdout.write("North-star: no submitted applications yet\n");
          } else {
            const rate = northStar.ratePerTen !== null ? northStar.ratePerTen.toFixed(2) : "0.00";
            process.stdout.write(
              `North-star: ${northStar.interviews} interviews / ${northStar.submitted} submitted → ${rate} per 10 applications\n`,
            );
            if (channelOutcomes.length > 0) {
              process.stdout.write("Channel breakdown:\n");
              for (const co of channelOutcomes) {
                const r = co.rate !== null ? (co.rate * 100).toFixed(0) + "%" : "—";
                process.stdout.write(`  ${co.channel.padEnd(14)} ${co.submitted} submitted, ${co.interviews} interview${co.interviews === 1 ? "" : "s"} (${r})\n`);
              }
            }
          }
        }
      }
      process.exit(0);
    }

    const records: UsageRecord[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed) as UsageRecord);
      } catch {
        // skip malformed lines
      }
    }

    if (records.length === 0) {
      process.stderr.write("No valid usage records found.\n");
      process.exit(0);
    }

    const byRole = new Map<string, UsageRecord[]>();
    for (const r of records) {
      const list = byRole.get(r.role) ?? [];
      list.push(r);
      byRole.set(r.role, list);
    }

    if (opts.format === "json") {
      const rolesSummary: Record<string, unknown> = {};
      for (const [role, roleRecords] of byRole) {
        rolesSummary[role] = {
          calls: roleRecords.length,
          inputTokens: roleRecords.reduce((s, r) => s + r.inputTokens, 0),
          outputTokens: roleRecords.reduce((s, r) => s + r.outputTokens, 0),
          costUsd: roleRecords.reduce((s, r) => s + (r.costUsd ?? 0), 0),
          wallTimeMs: roleRecords.reduce((s, r) => s + r.wallTimeMs, 0),
        };
      }
      const jsonOutput: Record<string, unknown> = {
        totalRecords: records.length,
        byRole: rolesSummary,
        totals: {
          inputTokens: records.reduce((s, r) => s + r.inputTokens, 0),
          outputTokens: records.reduce((s, r) => s + r.outputTokens, 0),
          costUsd: records.reduce((s, r) => s + (r.costUsd ?? 0), 0),
          wallTimeMs: records.reduce((s, r) => s + r.wallTimeMs, 0),
        },
      };
      if (northStar !== null) {
        jsonOutput["northStar"] = northStar;
        jsonOutput["channelOutcomes"] = channelOutcomes;
      }
      process.stdout.write(JSON.stringify(jsonOutput, null, 2) + "\n");
      return;
    }

    const fmtNum = (n: number) => n.toLocaleString("en-US");
    const fmtSec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
    const fmtUsd = (usd: number) => (usd > 0 ? `$${usd.toFixed(4)}` : "—");

    const lines: string[] = [];
    lines.push(`Selfwright Usage Report  (${records.length} record${records.length === 1 ? "" : "s"})\n`);

    for (const [role, roleRecords] of [...byRole.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const inp = roleRecords.reduce((s, r) => s + r.inputTokens, 0);
      const out = roleRecords.reduce((s, r) => s + r.outputTokens, 0);
      const cost = roleRecords.reduce((s, r) => s + (r.costUsd ?? 0), 0);
      const wall = roleRecords.reduce((s, r) => s + r.wallTimeMs, 0);
      lines.push(`Role: ${role}`);
      lines.push(`  Calls:         ${roleRecords.length}`);
      lines.push(`  Input tokens:  ${fmtNum(inp)}`);
      lines.push(`  Output tokens: ${fmtNum(out)}`);
      lines.push(`  Cost:          ${fmtUsd(cost)}`);
      lines.push(`  Wall time:     ${fmtSec(wall)}`);
      lines.push("");
    }

    const totalInp = records.reduce((s, r) => s + r.inputTokens, 0);
    const totalOut = records.reduce((s, r) => s + r.outputTokens, 0);
    const totalCost = records.reduce((s, r) => s + (r.costUsd ?? 0), 0);
    const totalWall = records.reduce((s, r) => s + r.wallTimeMs, 0);
    lines.push("Grand total");
    lines.push(`  Input tokens:  ${fmtNum(totalInp)}`);
    lines.push(`  Output tokens: ${fmtNum(totalOut)}`);
    lines.push(`  Cost:          ${fmtUsd(totalCost)}`);
    lines.push(`  Wall time:     ${fmtSec(totalWall)}`);

    if (northStar !== null) {
      lines.push("");
      if (northStar.submitted === 0) {
        lines.push("North-star: no submitted applications yet");
      } else {
        const rate = northStar.ratePerTen !== null ? northStar.ratePerTen.toFixed(2) : "0.00";
        lines.push(
          `North-star: ${northStar.interviews} interviews / ${northStar.submitted} submitted → ${rate} per 10 applications`,
        );
        if (channelOutcomes.length > 0) {
          lines.push("Channel breakdown:");
          for (const co of channelOutcomes) {
            const r = co.rate !== null ? (co.rate * 100).toFixed(0) + "%" : "—";
            lines.push(`  ${co.channel.padEnd(14)} ${co.submitted} submitted, ${co.interviews} interview${co.interviews === 1 ? "" : "s"} (${r})`);
          }
        }
      }
    }

    process.stdout.write(lines.join("\n") + "\n");
  });

// Main module guard: only parse argv when this file is the entry point.
// When imported in tests, program.parse() is NOT called so tests can invoke
// program.parseAsync() directly without re-entrant parsing.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  program.parse();
}
