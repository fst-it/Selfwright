// T5.10 end-to-end proof: drives a real Chromium browser against the real
// built Hono server (apps/web/dist/server.js) and the real built cockpit
// bundle (apps/web-ui/dist), on a hermetic temp git data dir — never the
// real data dir. Exercises: login -> overview render -> a status write -> a
// debrief write -> a queue dismiss.
//
// Not wired into `pnpm test` / turbo's "test" task (CI has no Chromium
// installed — see .github/workflows/ci.yml). Run locally:
//   pnpm --filter @selfwright/web-ui build
//   pnpm --filter @selfwright/web build
//   pnpm --filter @selfwright/web-ui e2e
//
// If Chromium isn't installed (`npx playwright install chromium`), this
// prints a clear skip-reason line and exits 0 -- never a silent skip.
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { scrypt, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { stringify as stringifyYaml } from "yaml";

const scryptAsync = promisify(scrypt);

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB_DIR = join(HERE, "..", "..", "web");
const WEB_SERVER_ENTRY = join(WEB_DIR, "dist", "server.js");
const WEB_UI_DIST = join(HERE, "..", "dist");
const PORT = 8798;
// "localhost", not "127.0.0.1": Chromium's Secure-cookie "potentially
// trustworthy origin" allowance is documented/reliable for the "localhost"
// hostname; the session cookie (Secure; SameSite=Strict, ADR 0016) was
// observed being silently dropped by Playwright's Chromium when navigating
// to the literal 127.0.0.1 address over plain HTTP. The server still binds
// to 127.0.0.1 (server.ts, FF-WEB-1 clause a) -- "localhost" resolves there.
const BASE_URL = `http://localhost:${String(PORT)}`;
const PASSWORD = "e2e-cockpit-password";

function log(msg: string): void {
  process.stdout.write(`[e2e] ${msg}\n`);
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function runGit(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

// Not an email-shaped string (git doesn't require RFC-valid email syntax for
// user.email) -- deliberately avoids the data-leak gate's email-address PII
// pattern, which scans this file (unlike *.test.ts, .e2e.ts isn't excluded).
const GIT_IDENTITY = ["-c", "user.name=e2e", "-c", "user.email=e2e-fixture-identity"];

function makeDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-e2e-cockpit-"));
  for (const sub of ["applications", "pipeline", "coaching/drills", "content/digests", "web"]) {
    mkdirSync(join(dir, sub), { recursive: true });
  }
  runGit(["init", "-q"], dir);

  const apps = [
    {
      id: "APP-E2E-001",
      company: "Acme Corp",
      role: "Principal Engineer",
      status: "applied",
      dates: { applied: "2026-07-01", last_update: "2026-07-01" },
      fit_score: 4.2,
      ats_score: null,
      notes: null,
    },
  ];
  writeFileSync(join(dir, "applications", "applications.yml"), stringifyYaml(apps));

  const queue = {
    queue: [
      { id: "Q-E2E-001", company: "Gamma Inc", derived_role: "Senior Engineer", fit_score: 3.9 },
    ],
  };
  writeFileSync(join(dir, "pipeline", "queue.yml"), stringifyYaml(queue));

  runGit([...GIT_IDENTITY, "add", "-A"], dir);
  runGit([...GIT_IDENTITY, "commit", "-m", "e2e: seed fixtures"], dir);
  return dir;
}

function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      fetch(url)
        .then(() => { resolve(); })
        .catch(() => {
          if (Date.now() - start > timeoutMs) {
            reject(new Error(`server did not become ready within ${String(timeoutMs)}ms`));
          } else {
            setTimeout(tick, 200);
          }
        });
    };
    tick();
  });
}

async function main(): Promise<void> {
  let chromiumExecutable: string;
  try {
    chromiumExecutable = chromium.executablePath();
  } catch (err) {
    log(`SKIP-REASON: could not resolve a Chromium executable path (${String(err)}). This is a local-only E2E spec; run "npx playwright install chromium" then retry.`);
    return;
  }
  if (!existsSync(chromiumExecutable)) {
    log(`SKIP-REASON: Chromium is not installed at ${chromiumExecutable}. Run "npx playwright install chromium" then retry. This spec never runs in CI (see .github/workflows/ci.yml) -- it is local-only by design.`);
    return;
  }
  if (!existsSync(WEB_SERVER_ENTRY)) {
    throw new Error(`${WEB_SERVER_ENTRY} not found -- run "pnpm --filter @selfwright/web build" first`);
  }
  if (!existsSync(join(WEB_UI_DIST, "index.html"))) {
    throw new Error(`${WEB_UI_DIST} has no index.html -- run "pnpm --filter @selfwright/web-ui build" first`);
  }

  const dataDir = makeDataDir();
  const passwordHash = await hashPassword(PASSWORD);
  let serverProcess: ChildProcess | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

  try {
    log(`Starting server against hermetic data dir: ${dataDir}`);
    serverProcess = spawn(process.execPath, [WEB_SERVER_ENTRY], {
      cwd: WEB_DIR,
      env: {
        ...process.env,
        SELFWRIGHT_DATA_DIR: dataDir,
        SELFWRIGHT_WEB_PASSWORD_HASH: passwordHash,
        SELFWRIGHT_WEB_PORT: String(PORT),
      },
      stdio: "pipe",
    });
    serverProcess.stderr?.on("data", (chunk: Buffer) => process.stderr.write(`[server] ${chunk.toString()}`));

    await waitForServer(`${BASE_URL}/login`, 10_000);
    log("Server is up.");

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // ── Login ──────────────────────────────────────────────────────────────
    await page.goto(`${BASE_URL}/login`);
    await page.fill("#pw", PASSWORD);
    await Promise.all([page.waitForURL(`${BASE_URL}/`), page.click('button[type="submit"]')]);
    log("Logged in.");

    // ── Overview render ──────────────────────────────────────────────────────
    await page.waitForSelector("h1:has-text('Overview')");
    const northStar = await page.textContent("body");
    if (northStar === null || !northStar.includes("North-Star")) {
      throw new Error("Overview page did not render north-star section");
    }
    log("Overview rendered.");

    // ── Status write (Pipeline) ─────────────────────────────────────────────
    await page.goto(`${BASE_URL}/pipeline`);
    await page.waitForSelector("text=Acme Corp");
    await page.selectOption('select[id^="status-"]', "interview");
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/applications/") && res.request().method() === "POST"),
      page.click('button:has-text("Save")'),
    ]);
    await page.waitForSelector("text=interview");
    log("Status write succeeded (Pipeline).");

    // ── Debrief write (Coaching) ─────────────────────────────────────────────
    await page.goto(`${BASE_URL}/coaching`);
    await page.fill("#debrief-app", "APP-E2E-001");
    await page.fill("#debrief-date", "2026-07-10");
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/debriefs") && res.request().method() === "POST"),
      page.click('button:has-text("Save debrief")'),
    ]);
    await page.waitForSelector("text=APP-E2E-001 — 2026-07-10");
    log("Debrief write succeeded (Coaching).");

    // ── Queue dismiss ────────────────────────────────────────────────────────
    await page.goto(`${BASE_URL}/queue`);
    await page.waitForSelector("text=Gamma Inc");
    await page.click('button:has-text("Dismiss")');
    await page.waitForSelector('button:has-text("Confirm dismiss")');
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/queue/") && res.request().method() === "POST"),
      page.click('button:has-text("Confirm dismiss")'),
    ]);
    await page.waitForSelector("text=Queue is empty.");
    log("Queue dismiss succeeded.");

    log("ALL E2E STEPS PASSED.");
  } finally {
    await browser?.close();
    serverProcess?.kill();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`[e2e] FAILED: ${String(err)}\n`);
  process.exitCode = 1;
});
