#!/usr/bin/env node
/**
 * Selfwright bootstrap script — dependency-free, runs right after `git clone`.
 *
 * Usage:
 *   node scripts/setup.mjs [options]
 *
 * Options:
 *   --data-dir <path>            Absolute path for the data directory
 *   --clone-data <git-url>       Clone the private data repo into the data dir
 *   --init-template              Copy examples/data-template into the data dir and git init it
 *   --with-playwright            Install Chromium via the scan-browser package after pnpm install
 *   --with-reporting-metabase    Start the reporting-metabase Docker profile (Metabase BI)
 *   --with-reporting-evidence    Start the reporting-evidence Docker profile (Evidence.dev)
 *   --with-memory                Start the memory Docker profile (mem0 + ollama)
 *   --with-embeddings            Start the embeddings Docker profile (ollama for pgvector)
 *   --with-llm-gateway           Start the llm-gateway Docker profile (LiteLLM proxy)
 *   --non-interactive            Never prompt; fail if required info is missing
 *
 * Steps (in order):
 *   1. Verify runtime prerequisites (node version, pnpm, git; docker is optional)
 *   2. Resolve or create the data directory
 *   3. Write/update root .env (SELFWRIGHT_DATA_DIR=...; preserve existing lines)
 *   4. Run pnpm install
 *   5. Install git hooks (lefthook install or setup-hooks via pnpm prepare)
 *   6. Optional: install Playwright Chromium
 *   7. Doctor pass: pnpm fitness, named-entity probe — print a PASS/attention summary
 *
 * Idempotent: safe to re-run.
 */

import { createInterface } from "node:readline";
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Parse process.argv into a flat flags object. */
export function parseArgs(argv) {
  const args = {
    nonInteractive: false,
    withPlaywright: false,
    withReportingMetabase: false,
    withReportingEvidence: false,
    withMemory: false,
    withEmbeddings: false,
    withLlmGateway: false,
    dataDir: null,
    cloneData: null,
    initTemplate: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--non-interactive") args.nonInteractive = true;
    else if (a === "--with-playwright") args.withPlaywright = true;
    else if (a === "--with-reporting-metabase") args.withReportingMetabase = true;
    else if (a === "--with-reporting-evidence") args.withReportingEvidence = true;
    else if (a === "--with-memory") args.withMemory = true;
    else if (a === "--with-embeddings") args.withEmbeddings = true;
    else if (a === "--with-llm-gateway") args.withLlmGateway = true;
    else if (a === "--data-dir" && argv[i + 1]) { args.dataDir = argv[++i]; }
    else if (a === "--clone-data" && argv[i + 1]) { args.cloneData = argv[++i]; }
    else if (a === "--init-template") args.initTemplate = true;
  }
  return args;
}

/**
 * Merge new key=value pairs into an existing .env file string.
 * - Existing lines are preserved in order.
 * - If a key already exists in the existing content, its line is replaced.
 * - New keys are appended at the end.
 * Returns the updated .env string.
 */
export function mergeEnvFile(existing, newVars) {
  const lines = existing ? existing.split(/\r?\n/) : [];
  const added = new Set();

  // Replace existing keys in-place.
  const updated = lines.map((line) => {
    if (line.startsWith("#") || !line.includes("=")) return line;
    const key = line.slice(0, line.indexOf("=")).trim();
    if (key in newVars) {
      added.add(key);
      return `${key}=${newVars[key]}`;
    }
    return line;
  });

  // Drop trailing empty lines before appending so there is no blank line gap.
  while (updated.length > 0 && updated[updated.length - 1] === "") {
    updated.pop();
  }

  // Append keys that were not already present.
  for (const [k, v] of Object.entries(newVars)) {
    if (!added.has(k)) {
      updated.push(`${k}=${v}`);
    }
  }

  // Normalize: trim trailing blank lines, then add one.
  const trimmed = updated.join("\n").replace(/\n+$/, "");
  return trimmed + "\n";
}

function run(cmd, opts = {}) {
  return spawnSync(cmd, { shell: true, stdio: "inherit", cwd: REPO_ROOT, ...opts });
}

function runCapture(cmd) {
  return spawnSync(cmd, { shell: true, encoding: "utf-8", cwd: REPO_ROOT });
}

function checkCommand(name, verifyFlag = "--version") {
  const r = runCapture(`${name} ${verifyFlag}`);
  return r.status === 0;
}

function step(label) {
  process.stdout.write(`\n>> ${label}\n`);
}

function ok(msg) {
  process.stdout.write(`   ok  ${msg}\n`);
}

function warn(msg) {
  process.stdout.write(`   warn  ${msg}\n`);
}

function fail(msg) {
  process.stderr.write(`   FAIL  ${msg}\n`);
}

async function prompt(question, defaultValue) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const display = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    rl.question(display, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

// ── Step 1: Prerequisites ──────────────────────────────────────────────────────

function checkPrerequisites() {
  step("Checking prerequisites");

  // Node version
  const majorStr = process.versions.node.split(".")[0];
  const major = parseInt(majorStr, 10);
  if (major < 22) {
    fail(`Node ${process.versions.node} found but >= 22 is required. See .nvmrc.`);
    process.exit(1);
  }
  ok(`node ${process.versions.node}`);

  // pnpm
  if (!checkCommand("pnpm")) {
    fail("pnpm not found on PATH. Install pnpm >= 9: https://pnpm.io/installation");
    process.exit(1);
  }
  const pnpmVer = runCapture("pnpm --version").stdout?.trim() ?? "unknown";
  ok(`pnpm ${pnpmVer}`);

  // git
  if (!checkCommand("git")) {
    fail("git not found on PATH.");
    process.exit(1);
  }
  ok("git found");

  // docker (optional)
  if (!checkCommand("docker")) {
    warn("docker not found — optional services (Postgres, Ollama, mem0) will not start");
  } else {
    ok("docker found (optional services available)");
  }
}

// ── Step 2: Resolve / create the data directory ────────────────────────────────

async function resolveDataDir(args) {
  step("Resolving data directory");

  // 1. Explicit flag
  if (args.dataDir) {
    const d = resolve(args.dataDir);
    ok(`--data-dir ${d}`);
    return d;
  }

  // 2. Existing SELFWRIGHT_DATA_DIR in environment
  if (process.env.SELFWRIGHT_DATA_DIR?.trim()) {
    const d = resolve(process.env.SELFWRIGHT_DATA_DIR.trim());
    ok(`SELFWRIGHT_DATA_DIR=${d} (from environment)`);
    return d;
  }

  // 3. Existing SELFWRIGHT_DATA_DIR in .env file
  const envPath = join(REPO_ROOT, ".env");
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf-8");
    const match = content.match(/^SELFWRIGHT_DATA_DIR=(.+)$/m);
    if (match?.[1]?.trim()) {
      const d = resolve(match[1].trim());
      ok(`SELFWRIGHT_DATA_DIR=${d} (from .env)`);
      return d;
    }
  }

  // 4. Conventional sibling
  const sibling = resolve(REPO_ROOT, "..", "Selfwright-data");
  if (existsSync(sibling)) {
    if (args.nonInteractive) {
      ok(`Using conventional sibling: ${sibling}`);
      return sibling;
    }
    const answer = await prompt(`Use sibling data directory (${sibling})?`, "y");
    if (/^y/i.test(answer)) {
      ok(`Using ${sibling}`);
      return sibling;
    }
  }

  // 5. Interactive prompt
  if (args.nonInteractive) {
    fail("--data-dir is required in --non-interactive mode when SELFWRIGHT_DATA_DIR is not set.");
    process.exit(1);
  }
  const raw = await prompt("Enter the path for the data directory (will be created if missing)");
  if (!raw) {
    fail("Data directory path is required.");
    process.exit(1);
  }
  return resolve(raw);
}

// ── Step 3: Create or populate the data directory ─────────────────────────────

function populateDataDir(dataDir, args) {
  step("Configuring data directory");

  if (args.cloneData) {
    if (existsSync(dataDir)) {
      warn(`${dataDir} already exists — skipping clone`);
    } else {
      ok(`Cloning ${args.cloneData} into ${dataDir}`);
      const r = run(`git clone "${args.cloneData}" "${dataDir}"`);
      if (r.status !== 0) {
        fail("git clone failed");
        process.exit(1);
      }
    }
    return;
  }

  if (args.initTemplate) {
    const templateDir = join(REPO_ROOT, "examples", "data-template");
    if (!existsSync(templateDir)) {
      fail(`Template not found at ${templateDir}`);
      process.exit(1);
    }
    if (existsSync(dataDir)) {
      warn(`${dataDir} already exists — skipping template copy`);
    } else {
      mkdirSync(dataDir, { recursive: true });
      cpSync(templateDir, dataDir, { recursive: true });
      ok(`Copied template to ${dataDir}`);
      const r = run(`git -C "${dataDir}" init && git -C "${dataDir}" add -A && git -C "${dataDir}" commit -m "chore: init from template"`);
      if (r.status !== 0) {
        warn("git init/commit in data dir failed — the directory was created but is not a git repo");
      } else {
        ok("Initialized as a git repository");
      }
    }
    return;
  }

  if (!existsSync(dataDir)) {
    warn(`${dataDir} does not exist. Creating empty directory.`);
    mkdirSync(dataDir, { recursive: true });
  } else {
    ok(`${dataDir} already exists`);
  }
}

// ── Step 4: Write / update .env ───────────────────────────────────────────────

function writeEnv(dataDir) {
  step("Updating .env");
  const envPath = join(REPO_ROOT, ".env");
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
  const updated = mergeEnvFile(existing, { SELFWRIGHT_DATA_DIR: dataDir });
  writeFileSync(envPath, updated, "utf-8");
  ok(`${envPath} updated (SELFWRIGHT_DATA_DIR=${dataDir})`);
  ok(".env is gitignored — this file is private and stays on your machine");
}

// ── Step 5: pnpm install ─────────────────────────────────────────────────────

function pnpmInstall() {
  step("Running pnpm install");
  const r = run("pnpm install");
  if (r.status !== 0) {
    fail("pnpm install failed");
    process.exit(1);
  }
  ok("pnpm install complete");
}

// ── Step 6: Install git hooks ─────────────────────────────────────────────────

function installHooks() {
  step("Installing git hooks");
  // Try lefthook first (already in devDependencies).
  const lh = runCapture("pnpm exec lefthook install");
  if (lh.status === 0) {
    ok("lefthook install complete");
    return;
  }
  // Fallback: the tools package's prepare script.
  const r = run("pnpm --filter @selfwright/tools run prepare");
  if (r.status !== 0) {
    warn("Hook installation failed — run `pnpm exec lefthook install` manually");
  } else {
    ok("Git hooks installed via @selfwright/tools prepare");
  }
}

// ── Step 7: Optional Playwright ───────────────────────────────────────────────

function installPlaywright() {
  step("Installing Playwright Chromium");
  const r = run("pnpm --filter @selfwright/adapter-scan-browser exec playwright install chromium");
  if (r.status !== 0) {
    warn("Playwright Chromium install failed — `selfwright scan --verify` will not be available");
  } else {
    ok("Chromium installed");
  }
}

// ── Step 7b: Start optional Docker profiles ───────────────────────────────────

function startDockerProfiles(args) {
  const profiles = [];
  if (args.withReportingMetabase) profiles.push("reporting-metabase");
  if (args.withReportingEvidence) profiles.push("reporting-evidence");
  if (args.withMemory) profiles.push("memory");
  if (args.withEmbeddings) profiles.push("embeddings");
  if (args.withLlmGateway) profiles.push("llm-gateway");

  if (profiles.length === 0) return;

  step("Starting optional Docker profiles");
  if (!checkCommand("docker")) {
    warn("docker not found — skipping profile start");
    return;
  }

  const profileFlags = profiles.map((p) => `--profile ${p}`).join(" ");
  const cmd = `docker compose --env-file .env -f infra/docker-compose.yml ${profileFlags} up -d`;
  ok(`Running: ${cmd}`);
  const r = run(cmd);
  if (r.status !== 0) {
    warn(`Docker profile start failed — run manually: ${cmd}`);
  } else {
    ok(`Profiles started: ${profiles.join(", ")}`);
  }
}

// ── Step 8: Doctor pass ───────────────────────────────────────────────────────

function doctor(dataDir) {
  step("Doctor pass");
  const attention = [];

  // pnpm fitness
  process.stdout.write("   Running pnpm fitness ...\n");
  const fitnessEnv = { ...process.env, SELFWRIGHT_DATA_DIR: dataDir };
  const fitness = spawnSync("pnpm fitness", {
    shell: true,
    encoding: "utf-8",
    cwd: REPO_ROOT,
    env: fitnessEnv,
  });
  if (fitness.status === 0) {
    ok("pnpm fitness passed");
  } else {
    if (fitness.stdout) process.stdout.write(fitness.stdout);
    if (fitness.stderr) process.stderr.write(fitness.stderr);
    fail("pnpm fitness failed — see output above");
    attention.push("pnpm fitness has failures");
  }

  // Named-entity probe
  process.stdout.write("   Running named-entity probe ...\n");
  const neEnv = { ...process.env, SELFWRIGHT_DATA_DIR: dataDir };
  const ne = spawnSync("pnpm --filter @selfwright/tools run named-entity-scan probe", {
    shell: true,
    encoding: "utf-8",
    cwd: REPO_ROOT,
    env: neEnv,
  });
  if (ne.status === 0) {
    ok("Named-entity probe clean");
  } else {
    // The probe exits 1 when data dir has no derivable names (no truth/identity.yml yet) —
    // this is expected for a fresh template-only data dir. Downgrade to warn.
    if (ne.stdout) process.stdout.write(ne.stdout);
    if (ne.stderr) process.stderr.write(ne.stderr);
    warn("Named-entity probe returned non-zero — may be expected for an empty template data dir");
    attention.push("Named-entity probe: check output above");
  }

  // Summary
  process.stdout.write("\n");
  if (attention.length === 0) {
    process.stdout.write("PASS — Setup complete. Run `selfwright inbox` to get started.\n");
  } else {
    process.stdout.write("Attention required:\n");
    for (const item of attention) {
      process.stdout.write(`  - ${item}\n`);
    }
    process.stdout.write("\nSetup is otherwise complete — address the items above before running the full suite.\n");
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  checkPrerequisites();
  const dataDir = await resolveDataDir(args);
  populateDataDir(dataDir, args);
  writeEnv(dataDir);
  pnpmInstall();
  installHooks();
  startDockerProfiles(args);
  if (args.withPlaywright) installPlaywright();
  doctor(dataDir);
}

main().catch((err) => {
  process.stderr.write(`setup.mjs: unexpected error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
