// Targeted tests for coverage gaps identified by the coverage report.
// Each describe block names the source file and lines it covers so the
// rationale for each test is obvious without reading the coverage report.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stringify as stringifyYaml } from "yaml";
import { createApp } from "../app.js";
import {
  hashPassword,
  resetAuthState,
  getCsrfToken,
  sessionStore,
} from "../auth.js";
import { loadFitnessHistory } from "../utils.js";
import { hashApplicationsContent, hashQueueContent } from "@selfwright/adapter-storage-git";
import {
  ApiErrorEnvelopeSchema,
  OverviewResponseSchema,
  ReportingResponseSchema,
  InboxResponseSchema,
} from "@selfwright/api-contract";

// ── helpers ───────────────────────────────────────────────────────────────────

const GIT_IDENTITY = ["-c", "user.name=fixture", "-c", "user.email=fixture@test.local"];

function runGit(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

/** git-initialised data dir — used for write-route tests. */
function makeGitDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-covgap-git-"));
  for (const sub of ["applications", "pipeline", "coaching/drills", "content/digests", "web"]) {
    mkdirSync(join(dir, sub), { recursive: true });
  }
  runGit(["init", "-q"], dir);
  return dir;
}

/**
 * Plain (non-git) data dir — used to exercise the not-a-git-repo failure path
 * in handleCommitFailure (shared.ts lines 68-70).
 */
function makePlainDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-covgap-plain-"));
  for (const sub of ["applications", "pipeline", "coaching/drills", "content/digests", "web"]) {
    mkdirSync(join(dir, sub), { recursive: true });
  }
  return dir;
}

function installFailingPreCommitHook(dir: string): void {
  const hookPath = join(dir, ".git", "hooks", "pre-commit");
  writeFileSync(hookPath, "#!/bin/sh\necho 'hook-blocked' 1>&2\nexit 1\n");
  chmodSync(hookPath, 0o755);
}

let tmpDir: string;
let app: ReturnType<typeof createApp>;
let sessionCookie: string;
let sessionId: string;
let csrfToken: string;

async function loginAndSetup(dir: string): Promise<void> {
  resetAuthState();
  const cred = await hashPassword("testpass");
  process.env["SELFWRIGHT_WEB_PASSWORD_HASH"] = `${cred.salt}:${cred.hash}`;
  app = createApp(dir);

  const loginRes = await app.request("/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://localhost" },
    body: "password=testpass",
  });
  const setCookie = loginRes.headers.get("set-cookie") ?? "";
  const match = /sw_session=([^;]+)/.exec(setCookie);
  if (match === null) throw new Error("no session cookie");
  sessionId = match[1] ?? "";
  sessionCookie = `sw_session=${sessionId}`;
  const token = getCsrfToken(sessionId);
  if (token === null) throw new Error("no csrf token");
  csrfToken = token;
}

async function authedGet(path: string): Promise<Response> {
  return app.request(path, { headers: { Cookie: sessionCookie } });
}

async function authedJsonPost(
  path: string,
  body: unknown,
  opts: { method?: string; csrf?: string } = {},
): Promise<Response> {
  return app.request(path, {
    method: opts.method ?? "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
      Cookie: sessionCookie,
      ...(opts.csrf !== undefined ? { "x-csrf-token": opts.csrf } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function parseError(res: Response): Promise<{ error: { code: string; message: string } }> {
  return ApiErrorEnvelopeSchema.parse(await res.json());
}

beforeEach(() => {
  process.env["SELFWRIGHT_WEB_FAILURE_DELAY_MS"] = "0";
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env["SELFWRIGHT_WEB_PASSWORD_HASH"];
  delete process.env["SELFWRIGHT_WEB_FAILURE_DELAY_MS"];
});

// ── utils.ts: loadFitnessHistory (lines 25-59) ───────────────────────────────
// The function reads a JSONL file and parses valid entries, skipping blank
// lines and malformed JSON. The existing tests never create a fitness-history
// file, leaving the entire parsing loop untested.

describe("utils.ts: loadFitnessHistory JSONL parsing", () => {
  it("returns [] when the file is absent", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "sw-covgap-utils-"));
    const result = await loadFitnessHistory(tmpDir);
    expect(result).toEqual([]);
  });

  it("returns parsed entries from a valid fitness-history.jsonl", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "sw-covgap-utils-"));
    mkdirSync(join(tmpDir, "reports"), { recursive: true });
    const entry1 = { runAt: "2026-07-01T00:00:00Z", passed: 28, failed: 0, skipped: 5 };
    const entry2 = { runAt: "2026-07-02T00:00:00Z", passed: 29, failed: 0, skipped: 5 };
    writeFileSync(
      join(tmpDir, "reports", "fitness-history.jsonl"),
      [JSON.stringify(entry1), JSON.stringify(entry2)].join("\n") + "\n",
    );
    const result = await loadFitnessHistory(tmpDir);
    expect(result).toHaveLength(2);
    expect(result[0]?.runAt).toBe("2026-07-01T00:00:00Z");
    expect(result[0]?.passed).toBe(28);
    expect(result[1]?.runAt).toBe("2026-07-02T00:00:00Z");
  });

  it("skips blank lines and malformed JSON without throwing", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "sw-covgap-utils-"));
    mkdirSync(join(tmpDir, "reports"), { recursive: true });
    const valid = { runAt: "2026-07-03T00:00:00Z", passed: 30, failed: 1, skipped: 0 };
    writeFileSync(
      join(tmpDir, "reports", "fitness-history.jsonl"),
      [
        "",
        "  ",
        "not valid json {{{",
        JSON.stringify(valid),
        "",
      ].join("\n"),
    );
    const result = await loadFitnessHistory(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]?.passed).toBe(30);
  });

  it("skips entries missing required fields (no runAt, passed, failed, or skipped)", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "sw-covgap-utils-"));
    mkdirSync(join(tmpDir, "reports"), { recursive: true });
    const incomplete = { runAt: "2026-07-04T00:00:00Z", passed: 10 }; // missing failed/skipped
    const valid = { runAt: "2026-07-04T00:00:00Z", passed: 10, failed: 0, skipped: 0 };
    writeFileSync(
      join(tmpDir, "reports", "fitness-history.jsonl"),
      [JSON.stringify(incomplete), JSON.stringify(valid)].join("\n") + "\n",
    );
    const result = await loadFitnessHistory(tmpDir);
    // Only the fully-valid entry should be returned.
    expect(result).toHaveLength(1);
    expect(result[0]?.passed).toBe(10);
  });
});

// ── auth.ts: handleLoginPost edge cases (lines 308-313, 318-324) ─────────────

describe("auth.ts: handleLoginPost — missing body and no-credentials paths", () => {
  beforeEach(() => {
    tmpDir = makeGitDataDir();
    resetAuthState();
    delete process.env["SELFWRIGHT_WEB_PASSWORD_HASH"];
  });

  it("POST /login with no password field in body → 401 Invalid password (LoginBody.safeParse fails)", async () => {
    // Exercises the !parsed.success branch (lines 308-313) — body without
    // the required `password` key fails Zod validation before scrypt runs.
    const app2 = createApp(tmpDir);
    const res = await app2.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://localhost" },
      body: "other_field=value",
    });
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).toContain("Invalid password");
  });

  it("POST /login with oversized password (>1024 chars) → 401 (schema rejects before scrypt)", async () => {
    const app2 = createApp(tmpDir);
    const res = await app2.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://localhost" },
      body: `password=${"x".repeat(1025)}`,
    });
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).toContain("Invalid password");
  });

  it("POST /login with valid body but no credentials configured → 401 Invalid password (lines 318-324)", async () => {
    // No credentials.json written, no env override set.
    const app2 = createApp(tmpDir);
    const res = await app2.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://localhost" },
      body: "password=anything",
    });
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).toContain("Invalid password");
  });
});

// ── auth.ts: isValidSession expired-session cleanup (lines 223-224) ─────────

describe("auth.ts: isValidSession — expired session triggers cleanup and redirect", () => {
  beforeEach(async () => {
    tmpDir = makeGitDataDir();
    await loginAndSetup(tmpDir);
  });

  it("a session older than SESSION_MAX_AGE_MS is rejected and removed from sessionStore", async () => {
    // Directly age the session so the expiry check triggers without sleeping
    // 30 days: overwrite createdAt with a timestamp 31 days in the past.
    const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
    const existing = sessionStore.get(sessionId);
    if (existing === undefined) throw new Error("session missing");
    sessionStore.set(sessionId, {
      ...existing,
      createdAt: Date.now() - SESSION_MAX_AGE_MS - 1000,
    });

    const res = await app.request("/pipeline", { headers: { Cookie: sessionCookie } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
    // The expired session must have been cleaned up from the store.
    expect(sessionStore.has(sessionId)).toBe(false);
  });
});

// ── overview.ts: queue YAML parsing and catch branches (lines 24, 30-43) ─────

describe("overview.ts: GET /api/overview — queue.yml parsing and catch branches", () => {
  beforeEach(async () => {
    tmpDir = makeGitDataDir();
    await loginAndSetup(tmpDir);
  });

  it("includes queue entries when queue.yml is present (covers the queue YAML parsing block)", async () => {
    writeFileSync(
      join(tmpDir, "pipeline", "queue.yml"),
      stringifyYaml({ queue: [{ id: "Q-1", company: "Acme", fit_score: 4.0 }] }),
    );
    const res = await authedGet("/api/overview");
    expect(res.status).toBe(200);
    const body = OverviewResponseSchema.parse(await res.json());
    // inboxService sees the queue entry, so reviewSoon count is > 0.
    expect(typeof body.inbox.reviewSoon).toBe("number");
  });

  it("graceful empty when applications.yml is present but contains invalid YAML (catch branch line 24)", async () => {
    writeFileSync(join(tmpDir, "applications", "applications.yml"), "::: not valid yaml [");
    const res = await authedGet("/api/overview");
    expect(res.status).toBe(200);
    const body = OverviewResponseSchema.parse(await res.json());
    expect(body.northStar.submitted).toBe(0);
  });
});

// ── reporting.ts: catch branch for malformed YAML (line 22) ──────────────────

describe("reporting.ts: GET /api/reporting — graceful empty on malformed applications YAML", () => {
  beforeEach(async () => {
    tmpDir = makeGitDataDir();
    await loginAndSetup(tmpDir);
  });

  it("returns empty reporting data without crashing when applications.yml is unparseable (covers catch on line 22)", async () => {
    writeFileSync(join(tmpDir, "applications", "applications.yml"), "::: not valid yaml [");
    const res = await authedGet("/api/reporting");
    expect(res.status).toBe(200);
    const body = ReportingResponseSchema.parse(await res.json());
    expect(body.northStar.submitted).toBe(0);
    expect(body.channelOutcomes).toEqual([]);
  });
});

// ── inbox.ts: catch branches for malformed YAML (lines 27, 45) ───────────────

describe("inbox.ts: GET /api/inbox — graceful empty on malformed YAML", () => {
  beforeEach(async () => {
    tmpDir = makeGitDataDir();
    await loginAndSetup(tmpDir);
  });

  it("returns empty inbox data when applications.yml is unparseable (catch branch line 27)", async () => {
    writeFileSync(join(tmpDir, "applications", "applications.yml"), "::: not valid yaml [");
    const res = await authedGet("/api/inbox");
    expect(res.status).toBe(200);
    const body = InboxResponseSchema.parse(await res.json());
    expect(body.decideNow).toEqual([]);
  });

  it("returns empty queue section when queue.yml is unparseable (catch branch line 45)", async () => {
    writeFileSync(join(tmpDir, "pipeline", "queue.yml"), "::: not valid yaml [");
    const res = await authedGet("/api/inbox");
    expect(res.status).toBe(200);
    const body = InboxResponseSchema.parse(await res.json());
    expect(body.reviewSoon).toEqual([]);
  });
});

// ── applications.ts: NOT_FOUND when app id absent from file (lines 108-114) ──

describe("applications.ts: POST /api/applications/:id/status — NOT_FOUND for missing id", () => {
  beforeEach(async () => {
    tmpDir = makeGitDataDir();
    await loginAndSetup(tmpDir);
  });

  it("returns 404 NOT_FOUND when the app id is not in applications.yml", async () => {
    const apps = [{ id: "APP-001", company: "Acme", role: "Engineer", status: "applied",
      dates: { applied: "2026-06-01", last_update: "2026-06-01" },
      fit_score: 4.0, ats_score: null, notes: null }];
    const raw = stringifyYaml(apps);
    writeFileSync(join(tmpDir, "applications", "applications.yml"), raw);
    runGit([...GIT_IDENTITY, "add", "-A"], tmpDir);
    runGit([...GIT_IDENTITY, "commit", "-m", "seed"], tmpDir);

    const res = await authedJsonPost(
      "/api/applications/DOES-NOT-EXIST/status",
      { status: "interview", contentHash: hashApplicationsContent(raw) },
      { csrf: csrfToken },
    );
    expect(res.status).toBe(404);
    const body = await parseError(res);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

// ── coaching.ts: rate limit on POST /api/debriefs (lines 132-134) ────────────

describe("coaching.ts: POST /api/debriefs — rate limit", () => {
  beforeEach(async () => {
    tmpDir = makeGitDataDir();
    await loginAndSetup(tmpDir);
  });

  it("11th debrief write in the same session within the throttle window → 429 RATE_LIMITED", async () => {
    let last: Response | undefined;
    for (let i = 0; i < 11; i++) {
      last = await authedJsonPost(
        "/api/debriefs",
        { application_id: `APP-${String(i).padStart(3, "0")}`, date: "2026-06-15" },
        { csrf: csrfToken },
      );
    }
    expect(last?.status).toBe(429);
    const body = await parseError(last as Response);
    expect(body.error.code).toBe("RATE_LIMITED");
  });
});

// ── coaching.ts: debrief revert when originalRaw is not null (line 154) ──────

describe("coaching.ts: POST /api/debriefs — revert restores pre-existing debriefs.yml on hook rejection", () => {
  beforeEach(async () => {
    tmpDir = makeGitDataDir();
    await loginAndSetup(tmpDir);
  });

  it("hook rejection with a pre-existing debriefs.yml restores the original file content (covers writeFile path at line 154)", async () => {
    // Write an initial debrief so there IS an existing debriefs.yml before the failing commit.
    const firstRes = await authedJsonPost(
      "/api/debriefs",
      { application_id: "APP-001", date: "2026-06-01" },
      { csrf: csrfToken },
    );
    expect(firstRes.status).toBe(201);

    // Verify the file now exists.
    const { readDebriefsRaw } = await import("@selfwright/adapter-storage-git");
    const originalContent = await readDebriefsRaw(tmpDir);
    expect(originalContent).not.toBeNull();

    // Install the hook AFTER the first commit so the first debrief succeeds.
    installFailingPreCommitHook(tmpDir);

    // A second debrief now hits the hook and must revert to the original file.
    const secondRes = await authedJsonPost(
      "/api/debriefs",
      { application_id: "APP-002", date: "2026-06-15" },
      { csrf: csrfToken },
    );
    expect(secondRes.status).toBe(422);
    const body = await parseError(secondRes);
    expect(body.error.code).toBe("HOOK_REJECTED");

    // The file must have been restored to its pre-second-debrief state.
    const afterContent = await readDebriefsRaw(tmpDir);
    expect(afterContent).toBe(originalContent);
  });
});

// ── shared.ts: not-a-git-repo failure branch (lines 68-70) ──────────────────

describe("shared.ts: handleCommitFailure — not-a-git-repo returns 500 INTERNAL_ERROR", () => {
  beforeEach(async () => {
    tmpDir = makePlainDataDir(); // no git init
    await loginAndSetup(tmpDir);
  });

  it("write to a non-git data dir → 500 INTERNAL_ERROR (not-a-git-repo branch)", async () => {
    const apps = [{ id: "APP-001", company: "Acme", role: "Engineer", status: "applied",
      dates: { applied: "2026-06-01", last_update: "2026-06-01" },
      fit_score: 4.0, ats_score: null, notes: null }];
    const raw = stringifyYaml(apps);
    writeFileSync(join(tmpDir, "applications", "applications.yml"), raw);

    const res = await authedJsonPost(
      "/api/applications/APP-001/status",
      { status: "interview", contentHash: hashApplicationsContent(raw) },
      { csrf: csrfToken },
    );
    expect(res.status).toBe(500);
    const body = await parseError(res);
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});

// ── queue.ts: promote revert when applications.yml already existed (line 176) ─

describe("queue.ts: promote — revert restores applications.yml when it existed before promote", () => {
  beforeEach(async () => {
    tmpDir = makeGitDataDir();
    await loginAndSetup(tmpDir);
  });

  it("hook rejection with a pre-existing applications.yml restores it rather than deleting it (covers writeApplicationsRaw revert at line 176)", async () => {
    // Seed both queue.yml AND applications.yml so originalAppsRaw != null.
    const existingApps = [{ id: "EXISTING-001", company: "OldCo", role: "Dev", status: "applied",
      dates: { applied: "2026-05-01", last_update: "2026-05-01" },
      fit_score: 3.5, ats_score: null, notes: null }];
    writeFileSync(join(tmpDir, "applications", "applications.yml"), stringifyYaml(existingApps));

    const queueEntries = [{ id: "Q-PROMOTE", company: "NewCo", derived_role: "Staff Eng", fit_score: 4.2 }];
    const queueRaw = stringifyYaml({ queue: queueEntries });
    writeFileSync(join(tmpDir, "pipeline", "queue.yml"), queueRaw);

    runGit([...GIT_IDENTITY, "add", "-A"], tmpDir);
    runGit([...GIT_IDENTITY, "commit", "-m", "seed both files"], tmpDir);

    installFailingPreCommitHook(tmpDir);

    const res = await authedJsonPost(
      "/api/queue/Q-PROMOTE/promote",
      { contentHash: hashQueueContent(queueRaw) },
      { csrf: csrfToken },
    );
    expect(res.status).toBe(422);
    const body = await parseError(res);
    expect(body.error.code).toBe("HOOK_REJECTED");

    // applications.yml must still exist and contain the original app — not
    // deleted and not extended with the newly promoted entry.
    const { readApplicationsRaw } = await import("@selfwright/adapter-storage-git");
    const afterRaw = await readApplicationsRaw(tmpDir);
    expect(afterRaw).not.toBeNull();
    expect(afterRaw).toContain("EXISTING-001");
    expect(afterRaw).not.toContain("Q-PROMOTE");
  });
});
