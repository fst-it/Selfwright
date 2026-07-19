#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import postgres from "postgres";
import {
  migrate,
  upsertEvidence,
  upsertArchetype,
  pruneEvidence,
  pruneArchetypes,
  upsertApplication,
  upsertFitnessRun,
} from "@selfwright/adapter-storage-postgres";
import type { ApplicationRow, FitnessRunRow } from "@selfwright/adapter-storage-postgres";
import { TruthLoader } from "@selfwright/adapter-storage-git";
import { tagLevels } from "@selfwright/core";
import type { EvidenceEntry, Archetype, ApplicationRecord } from "@selfwright/core";
import { parse as parseYaml } from "yaml";
import { isValidApplicationEntry, isValidFitnessRecord, isEmbedConnectionError } from "./src/sync-db-helpers.js";

const OLLAMA_BASE_URL = process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";
const EMBED_MODEL = "nomic-embed-text";

type OllamaEmbedResponse = { embeddings: number[][] };

async function embed(text: string): Promise<number[]> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!response.ok) {
    throw new Error(`Ollama embeddings request failed: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as OllamaEmbedResponse;
  const vector = data.embeddings[0];
  if (vector === undefined) throw new Error("Ollama returned no embedding vectors");
  return vector;
}

function evidenceEmbeddingText(entry: EvidenceEntry): string {
  return [entry.claim, entry.detail ?? "", entry.keywords.join(" ")].join(" ").trim();
}

function applicationToRow(app: ApplicationRecord): ApplicationRow {
  return {
    id: app.id,
    company: app.company,
    role: app.role,
    status: app.status,
    discovered: app.dates.discovered ?? null,
    promoted: app.dates.promoted ?? null,
    applied: app.dates.applied ?? null,
    last_update: app.dates.last_update ?? null,
    fit_score: app.fit_score ?? null,
    ats_overall: app.ats_score?.overall ?? null,
  };
}

type FitnessHistoryRecord = {
  runAt: string;
  results: { name: string; passed: boolean; skipped: boolean }[];
};

async function readJsonlLines(filePath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (trimmed) lines.push(trimmed);
    });
    rl.on("close", () => { resolve(lines); });
    rl.on("error", reject);
  });
}

function archetypeEmbeddingText(archetype: Archetype): string {
  return [archetype.label ?? archetype.id, archetype.related_titles.join(" "), archetype.match_keywords.join(" ")]
    .join(" ")
    .trim();
}

async function main(): Promise<void> {
  const dataDir = process.env["SELFWRIGHT_DATA_DIR"];
  const postgresUrl = process.env["SELFWRIGHT_POSTGRES_URL"];
  if (!dataDir) {
    process.stderr.write("Error: SELFWRIGHT_DATA_DIR environment variable is not set\n");
    process.exit(1);
  }
  if (!postgresUrl) {
    process.stderr.write("Error: SELFWRIGHT_POSTGRES_URL environment variable is not set\n");
    process.exit(1);
  }

  const sql = postgres(postgresUrl);
  await migrate(sql);

  const truth = new TruthLoader(dataDir);

  const evidenceResult = await truth.loadEvidenceRegistry();
  if (!evidenceResult.ok) {
    process.stderr.write(`Error loading evidence registry: ${evidenceResult.error.message}\n`);
    process.exit(1);
  }
  // --- vector sync (evidence + archetypes): degrades gracefully when Ollama is down ---
  // A connection/fetch error on the first embed call logs ONE warning and skips the entire
  // vector section.  Reporting tables (applications, fitness_runs) still sync afterward.
  try {
    let evidenceCount = 0;
    for (const entry of evidenceResult.value) {
      const vector = await embed(evidenceEmbeddingText(entry));
      await upsertEvidence(
        sql,
        { id: entry.id, title: entry.claim, kind: tagLevels(entry.tag).join("+"), signals: entry.keywords },
        vector,
      );
      evidenceCount += 1;
    }
    process.stderr.write(`Synced ${evidenceCount} evidence record(s)\n`);
    const prunedEvidence = await pruneEvidence(sql, evidenceResult.value.map((e) => e.id));
    process.stderr.write(`Pruned ${prunedEvidence} evidence record(s) no longer in git\n`);

    const archetypesResult = await truth.loadArchetypes();
    if (!archetypesResult.ok) {
      process.stderr.write(`Error loading archetypes: ${archetypesResult.error.message}\n`);
      process.exit(1);
    }
    let archetypeCount = 0;
    for (const archetype of archetypesResult.value) {
      const vector = await embed(archetypeEmbeddingText(archetype));
      await upsertArchetype(
        sql,
        { id: archetype.id, label: archetype.label ?? archetype.id, keywords: archetype.match_keywords },
        vector,
      );
      archetypeCount += 1;
    }
    process.stderr.write(`Synced ${archetypeCount} archetype record(s)\n`);
    const prunedArchetypes = await pruneArchetypes(sql, archetypesResult.value.map((a) => a.id));
    process.stderr.write(`Pruned ${prunedArchetypes} archetype record(s) no longer in git\n`);
  } catch (err) {
    if (isEmbedConnectionError(err)) {
      process.stderr.write(
        `[sync-db] warn: embedding service unavailable at ${OLLAMA_BASE_URL} — skipping evidence/archetype vector sync; reporting tables will still sync\n`,
      );
    } else {
      throw err;
    }
  }

  // Sync applications from <dataDir>/applications/applications.yml (skip gracefully if absent)
  const applicationsPath = `${dataDir}/applications/applications.yml`;
  let applicationsYaml: string | null = null;
  try {
    applicationsYaml = await readFile(applicationsPath, "utf-8");
  } catch {
    process.stderr.write(`Note: applications.yml not found at ${applicationsPath}, skipping applications sync\n`);
  }
  if (applicationsYaml !== null) {
    const parsed: unknown = parseYaml(applicationsYaml);
    if (Array.isArray(parsed)) {
      const applications: unknown[] = parsed;
      let appCount = 0;
      let appSkipped = 0;
      for (const app of applications) {
        try {
          if (!isValidApplicationEntry(app)) {
            process.stderr.write(`[sync-db] warn: skipping null/non-object application entry\n`);
            appSkipped += 1;
            continue;
          }
          await upsertApplication(sql, applicationToRow(app as ApplicationRecord));
          appCount += 1;
        } catch (err) {
          process.stderr.write(`[sync-db] warn: skipping application ${(app as { id?: string } | null)?.id ?? "<unknown>"} — ${String(err)}\n`);
          appSkipped += 1;
        }
      }
      process.stderr.write(`Synced ${appCount} application record(s)${appSkipped > 0 ? ` (${appSkipped} skipped)` : ""}\n`);
    }
  }

  // Sync fitness_runs from <dataDir>/telemetry/fitness-history.jsonl (skip gracefully if absent).
  // dataDir is already required and validated above; the telemetry/ subdir may not exist yet.
  const fitnessHistoryPath = `${dataDir}/telemetry/fitness-history.jsonl`;
  let historyLines: string[] = [];
  try {
    historyLines = await readJsonlLines(fitnessHistoryPath);
  } catch {
    process.stderr.write(`Note: fitness-history.jsonl not found at ${fitnessHistoryPath}, skipping fitness_runs sync\n`);
  }
  if (historyLines.length > 0) {
    let fitnessRunCount = 0;
    for (const line of historyLines) {
      let record: unknown;
      try {
        record = JSON.parse(line);
      } catch {
        process.stderr.write(`[sync-db] warn: skipping malformed fitness-history line\n`);
        continue;
      }
      if (!isValidFitnessRecord(record)) {
        process.stderr.write(`[sync-db] warn: skipping fitness-history line — no results array\n`);
        continue;
      }
      try {
        for (const result of (record as FitnessHistoryRecord).results) {
          const row: FitnessRunRow = {
            run_at: record.runAt,
            name: result.name,
            passed: result.passed,
            skipped: result.skipped,
          };
          await upsertFitnessRun(sql, row);
          fitnessRunCount += 1;
        }
      } catch (err) {
        process.stderr.write(`[sync-db] warn: skipping fitness-history record — ${String(err)}\n`);
      }
    }
    process.stderr.write(`Synced ${fitnessRunCount} fitness_run record(s)\n`);
  }

  await sql.end();
}

main().catch((err: unknown) => {
  process.stderr.write(`sync-db failed: ${String(err)}\n`);
  process.exit(1);
});
