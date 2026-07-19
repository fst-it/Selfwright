#!/usr/bin/env node
// SessionStart hook — prints a compact status digest (≤10 lines) and exits 0 always.
// Advisory only — never blocks a session start.
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { TruthLoader } from "@selfwright/adapter-storage-git";
import { notifyNtfy } from "./ntfy.js";
import { inboxService } from "@selfwright/core";
import type { ApplicationRecord, QueueEntry, InboxData, DriftEntry } from "@selfwright/core";

const dataDir = process.env["SELFWRIGHT_DATA_DIR"];

if (!dataDir) {
  process.stdout.write("⚠ SELFWRIGHT_DATA_DIR not set — Selfwright status unavailable.\n");
  process.exit(0);
}

async function tryReadYaml<T>(path: string): Promise<T | null> {
  try {
    return parse(await readFile(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

async function doctor(dir: string): Promise<string[]> {
  const issues: string[] = [];

  try {
    await access(dir);
  } catch {
    issues.push(`data dir not accessible: ${dir}`);
    return issues;
  }

  const truthFiles = ["truth/identity.yml", "truth/evidence/registry.yml"];
  for (const f of truthFiles) {
    try {
      await readFile(join(dir, f), "utf-8");
    } catch {
      issues.push(`missing truth file: ${f}`);
    }
  }

  if (!process.env["LITELLM_BASE_URL"]) {
    issues.push("LITELLM_BASE_URL not set — LLM calls will fail");
  }

  return issues;
}

const applicationsRaw = await tryReadYaml<ApplicationRecord[]>(
  join(dataDir, "applications", "applications.yml"),
);
const applications: ApplicationRecord[] = Array.isArray(applicationsRaw) ? applicationsRaw : [];

const queueRaw = await tryReadYaml<{ queue?: QueueEntry[] }>(
  join(dataDir, "pipeline", "queue.yml"),
);
const queue: QueueEntry[] =
  queueRaw !== null && Array.isArray(queueRaw.queue) ? queueRaw.queue : [];

let drifts: DriftEntry[] = [];
try {
  const loader = new TruthLoader(dataDir);
  const result = await loader.loadDrifts();
  if (result.ok) drifts = result.value;
} catch {
  // treat as empty
}

const data: InboxData = { applications, queue, drifts };
const report = inboxService(data);

const doctorIssues = await doctor(dataDir);

const lines: string[] = [];
lines.push(
  `Selfwright: ${report.decideNow.length} decide-now · ${report.reviewSoon.length} review-soon · ${report.fyi.length} fyi`,
);
if (doctorIssues.length > 0) {
  for (const issue of doctorIssues.slice(0, 3)) {
    lines.push(`  ⚠ ${issue}`);
  }
}
if (report.decideNow.length > 0) {
  const item = report.decideNow[0];
  if (item) lines.push(`  🔴 ${item.title}: ${item.detail}`);
}

process.stdout.write(lines.join("\n") + "\n");

// B-3: push notification sends the item ID only (per ANCHOR §7.3 "IDs-only" spec).
// Sending item.title would leak PII to the ntfy topic.
if (report.decideNow.length > 0) {
  const item = report.decideNow[0];
  void notifyNtfy(
    `${report.decideNow.length} decide-now item(s)${item ? `: ${item.id}` : ""}`,
    { title: "Selfwright inbox", priority: "default" },
  );
}

process.exit(0);
