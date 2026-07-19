#!/usr/bin/env node
// Inbox CLI — prints the 3-tier signal digest to stdout.
// Usage: node tools/dist/inbox.js [--format json|text]
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { TruthLoader } from "@selfwright/adapter-storage-git";
import { inboxService } from "@selfwright/core";
import type { ApplicationRecord, QueueEntry, InboxData, DriftEntry } from "@selfwright/core";

// ── Arg parsing ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let format = "text";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--format" && args[i + 1]) {
    format = args[++i] ?? "text";
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

const dataDir = process.env["SELFWRIGHT_DATA_DIR"];
if (!dataDir) {
  process.stderr.write("Error: SELFWRIGHT_DATA_DIR environment variable is not set\n");
  process.exit(1);
}

async function tryReadYaml<T>(path: string): Promise<T | null> {
  try {
    const text = await readFile(path, "utf-8");
    return parse(text) as T;
  } catch {
    return null;
  }
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
  const truth = new TruthLoader(dataDir);
  const result = await truth.loadDrifts();
  if (result.ok) drifts = result.value;
} catch {
  // treat as empty
}

const data: InboxData = { applications, queue, drifts };
const report = inboxService(data);

if (format === "json") {
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
