// Contract tests for the typed /api/* JSON contract (T5.9, FF-APICONTRACT).
// Exercises every endpoint against a hermetic temp git data dir — NEVER the
// real data dir. Mirrors the existing actions.test.ts pattern (in-process
// Hono app via createApp(), a real `git init`-ed tmp dir, a login flow to get
// a session cookie + CSRF token).
//
// Every response body is validated with the PUBLISHED zod schema from
// @selfwright/api-contract (strict `.parse()`, not safeParse-and-ignore)
// before any field-level assertion. This is the point of the suite: a
// hand-picked `expect(body.field).toBe(...)` alone would pass unchanged even
// if an unasserted field were added, renamed, retyped, or had its
// nullability changed -- schema drift the cockpit (T5.10) would only
// discover at runtime. `.parse()` throws on any such drift, failing the test
// immediately. Request fixtures for the "successful write" tests are
// likewise validated against the request schema before being sent, so a
// fixture that has silently drifted from the real contract fails loudly
// instead of coincidentally still working against today's handler.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stringify as stringifyYaml } from "yaml";
import { createApp } from "../app.js";
import { hashPassword, resetAuthState, getCsrfToken } from "../auth.js";
import { hashApplicationsContent, hashQueueContent } from "@selfwright/adapter-storage-git";
import {
  ApiErrorEnvelopeSchema,
  MetaResponseSchema,
  ApplicationsListResponseSchema,
  StatusUpdateRequestSchema,
  StatusUpdateResponseSchema,
  QueueResponseSchema,
  PromoteQueueEntryResponseSchema,
  DismissQueueEntryResponseSchema,
  CoachingResponseSchema,
  DebriefCreateRequestSchema,
  DebriefCreateResponseSchema,
  ContentResponseSchema,
  OverviewResponseSchema,
  InboxResponseSchema,
  ReportingResponseSchema,
  SettingsContractSchema,
  SettingsUpdateRequestSchema,
  SettingsUpdateResponseSchema,
  ScanTargetsContractSchema,
  ScanTargetsUpdateRequestSchema,
  ScanTargetsUpdateResponseSchema,
} from "@selfwright/api-contract";

const GIT_IDENTITY = ["-c", "user.name=fixture", "-c", "user.email=fixture@test.local"];

function runGit(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function makeGitDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-web-api-"));
  for (const sub of ["applications", "pipeline", "coaching/drills", "content/digests", "web"]) {
    mkdirSync(join(dir, sub), { recursive: true });
  }
  runGit(["init", "-q"], dir);
  return dir;
}

function installFailingPreCommitHook(dir: string): void {
  const hookPath = join(dir, ".git", "hooks", "pre-commit");
  writeFileSync(hookPath, "#!/bin/sh\necho 'blocked: synthetic PII hook rejection' 1>&2\nexit 1\n");
  chmodSync(hookPath, 0o755);
}

const SYNTHETIC_APPS = [
  {
    id: "APP-001",
    company: "Acme Corp",
    role: "Principal Engineer",
    status: "applied",
    dates: { applied: "2026-06-01", last_update: "2026-06-01" },
    fit_score: 4.2,
    ats_score: null,
    notes: null,
  },
];

function seedApplications(dir: string): string {
  const raw = stringifyYaml(SYNTHETIC_APPS);
  writeFileSync(join(dir, "applications", "applications.yml"), raw);
  runGit([...GIT_IDENTITY, "add", "-A"], dir);
  runGit([...GIT_IDENTITY, "commit", "-m", "seed applications.yml"], dir);
  return raw;
}

let tmpDir: string;
let app: ReturnType<typeof createApp>;
let sessionCookie: string;
let sessionId: string;
let csrfToken: string;

beforeEach(async () => {
  tmpDir = makeGitDataDir();
  resetAuthState();

  const cred = await hashPassword("apicontractpass");
  process.env["SELFWRIGHT_WEB_PASSWORD_HASH"] = `${cred.salt}:${cred.hash}`;
  app = createApp(tmpDir);

  const loginRes = await app.request("/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://localhost" },
    body: "password=apicontractpass",
  });
  const setCookie = loginRes.headers.get("set-cookie") ?? "";
  const match = /sw_session=([^;]+)/.exec(setCookie);
  if (match === null) throw new Error("no session cookie from login");
  sessionId = match[1] ?? "";
  sessionCookie = `sw_session=${sessionId}`;
  const token = getCsrfToken(sessionId);
  if (token === null) throw new Error("no csrf token for session");
  csrfToken = token;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env["SELFWRIGHT_WEB_PASSWORD_HASH"];
});

async function authedGet(path: string): Promise<Response> {
  return await app.request(path, { headers: { Cookie: sessionCookie } });
}

async function authedJsonPost(
  path: string,
  body: unknown,
  opts: { method?: string; csrf?: string; origin?: string; cookie?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Origin: opts.origin ?? "http://localhost",
    Cookie: opts.cookie ?? sessionCookie,
  };
  if (opts.csrf !== undefined) headers["x-csrf-token"] = opts.csrf;
  return await app.request(path, {
    method: opts.method ?? "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/** Parse an error-envelope response body with the published schema (strict). */
async function parseError(res: Response): Promise<{ error: { code: string; message: string } }> {
  return ApiErrorEnvelopeSchema.parse(await res.json());
}

// ── /api/meta ────────────────────────────────────────────────────────────────

describe("GET /api/meta", () => {
  it("returns contract version, platform version, status, and this session's csrf token", async () => {
    const res = await authedGet("/api/meta");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = MetaResponseSchema.parse(await res.json());
    expect(body.contractVersion).toBe("1.0.0");
    expect(typeof body.platformVersion).toBe("string");
    expect(body.status).toBe("ok");
    expect(body.csrfToken).toBe(csrfToken);
  });

  it("no CORS headers are set on an /api/* response", async () => {
    const res = await authedGet("/api/meta");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

// ── auth ─────────────────────────────────────────────────────────────────────

describe("/api/* auth", () => {
  it("unauthenticated request to a protected /api/* route -> 401 JSON envelope, not a redirect", async () => {
    const res = await app.request("/api/overview");
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await parseError(res);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});

// ── /api/applications (read) ────────────────────────────────────────────────

describe("GET /api/applications", () => {
  it("returns an empty list with a null contentHash when applications.yml is absent", async () => {
    const res = await authedGet("/api/applications");
    expect(res.status).toBe(200);
    const body = ApplicationsListResponseSchema.parse(await res.json());
    expect(body.applications).toEqual([]);
    expect(body.contentHash).toBeNull();
  });

  it("returns seeded applications with a matching contentHash", async () => {
    const raw = seedApplications(tmpDir);
    const res = await authedGet("/api/applications");
    const body = ApplicationsListResponseSchema.parse(await res.json());
    expect(body.applications).toHaveLength(1);
    expect(body.applications[0]?.id).toBe("APP-001");
    expect(body.contentHash).toBe(hashApplicationsContent(raw));
  });
});

// ── POST /api/applications/:id/status (write) ───────────────────────────────

describe("POST /api/applications/:id/status", () => {
  it("missing csrf header -> 403 FORBIDDEN_CSRF", async () => {
    const raw = seedApplications(tmpDir);
    const res = await authedJsonPost("/api/applications/APP-001/status", {
      status: "interview",
      contentHash: hashApplicationsContent(raw),
    });
    expect(res.status).toBe(403);
    const body = await parseError(res);
    expect(body.error.code).toBe("FORBIDDEN_CSRF");
  });

  it("wrong csrf header -> 403", async () => {
    const raw = seedApplications(tmpDir);
    const res = await authedJsonPost(
      "/api/applications/APP-001/status",
      { status: "interview", contentHash: hashApplicationsContent(raw) },
      { csrf: "wrong-token" },
    );
    expect(res.status).toBe(403);
    const body = await parseError(res);
    expect(body.error.code).toBe("FORBIDDEN_CSRF");
  });

  it("missing origin -> 403 FORBIDDEN_ORIGIN", async () => {
    const raw = seedApplications(tmpDir);
    const res = await app.request("/api/applications/APP-001/status", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ status: "interview", contentHash: hashApplicationsContent(raw) }),
    });
    expect(res.status).toBe(403);
    const body = await parseError(res);
    expect(body.error.code).toBe("FORBIDDEN_ORIGIN");
  });

  it("status outside the fixed vocabulary -> 400 VALIDATION_ERROR", async () => {
    const raw = seedApplications(tmpDir);
    const res = await authedJsonPost(
      "/api/applications/APP-001/status",
      { status: "bogus_status", contentHash: hashApplicationsContent(raw) },
      { csrf: csrfToken },
    );
    expect(res.status).toBe(400);
    const body = await parseError(res);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("note containing a control character -> 400", async () => {
    const raw = seedApplications(tmpDir);
    const res = await authedJsonPost(
      "/api/applications/APP-001/status",
      { status: "interview", note: `bad${String.fromCharCode(7)}note`, contentHash: hashApplicationsContent(raw) },
      { csrf: csrfToken },
    );
    expect(res.status).toBe(400);
    const body = await parseError(res);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("stale contentHash -> 409 CONFLICT", async () => {
    seedApplications(tmpDir);
    const res = await authedJsonPost(
      "/api/applications/APP-001/status",
      { status: "interview", contentHash: "stale-hash-value" },
      { csrf: csrfToken },
    );
    expect(res.status).toBe(409);
    const body = await parseError(res);
    expect(body.error.code).toBe("CONFLICT");
  });

  it("successful update: 200 with the updated application, applications.yml mutated, and a git commit created", async () => {
    const raw = seedApplications(tmpDir);
    const before = execFileSync("git", ["log", "--oneline"], { cwd: tmpDir, encoding: "utf-8" }).trim().split("\n").length;

    const requestBody = StatusUpdateRequestSchema.parse({
      status: "interview",
      note: "moved to onsite",
      contentHash: hashApplicationsContent(raw),
    });
    const res = await authedJsonPost("/api/applications/APP-001/status", requestBody, { csrf: csrfToken });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = StatusUpdateResponseSchema.parse(await res.json());
    expect(body.application.id).toBe("APP-001");
    expect(body.application.status).toBe("interview");
    expect(body.application.notes).toBe("moved to onsite");

    const after = execFileSync("git", ["log", "--oneline"], { cwd: tmpDir, encoding: "utf-8" }).trim().split("\n").length;
    expect(after).toBe(before + 1);
    const log = execFileSync("git", ["log", "-1", "--format=%s"], { cwd: tmpDir, encoding: "utf-8" });
    expect(log).toContain("web: status");
  });

  it("11th write in a session within the window -> 429 RATE_LIMITED", async () => {
    seedApplications(tmpDir);
    let last: Response | undefined;
    for (let i = 0; i < 11; i++) {
      last = await authedJsonPost(
        "/api/applications/APP-001/status",
        { status: "interview", contentHash: "irrelevant-wrong-hash" },
        { csrf: csrfToken },
      );
    }
    expect(last?.status).toBe(429);
    const body = await parseError(last as Response);
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  it("pre-commit hook rejection -> 422, applications.yml reverted, no new commit", async () => {
    const raw = seedApplications(tmpDir);
    installFailingPreCommitHook(tmpDir);
    const before = execFileSync("git", ["log", "--oneline"], { cwd: tmpDir, encoding: "utf-8" }).trim().split("\n").length;

    const res = await authedJsonPost(
      "/api/applications/APP-001/status",
      { status: "interview", contentHash: hashApplicationsContent(raw) },
      { csrf: csrfToken },
    );
    expect(res.status).toBe(422);
    const body = await parseError(res);
    expect(body.error.code).toBe("HOOK_REJECTED");
    expect(body.error.message).toContain("blocked: synthetic PII hook rejection");

    const after = execFileSync("git", ["log", "--oneline"], { cwd: tmpDir, encoding: "utf-8" }).trim().split("\n").length;
    expect(after).toBe(before);
  });

  it("concurrent writes are serialized: two concurrent status updates with the same contentHash -- one succeeds, the other gets a 409 (not a corrupted working tree)", async () => {
    const raw = seedApplications(tmpDir);
    const hash = hashApplicationsContent(raw);

    const [resA, resB] = await Promise.all([
      authedJsonPost("/api/applications/APP-001/status", { status: "interview", contentHash: hash }, { csrf: csrfToken }),
      authedJsonPost("/api/applications/APP-001/status", { status: "rejected", contentHash: hash }, { csrf: csrfToken }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    // Exactly one request wins (200) and the other is correctly told its
    // snapshot is stale (409) -- never both succeeding (which would race on
    // the same git index) and never a silent working-tree/HEAD divergence.
    // The withWriteLock queue this exercises is shared by every write route
    // in apps/web (T5.9's design), not just this one.
    expect(statuses).toEqual([200, 409]);
  });
});

// ── /api/queue ───────────────────────────────────────────────────────────────

describe("GET /api/queue", () => {
  it("returns an empty active list, default aging window, and a null contentHash when queue.yml is absent", async () => {
    const res = await authedGet("/api/queue");
    expect(res.status).toBe(200);
    const body = QueueResponseSchema.parse(await res.json());
    expect(body.active).toEqual([]);
    expect(body.staleCount).toBe(0);
    expect(body.agingWindowDays).toBe(30);
    expect(body.contentHash).toBeNull();
  });

  it("partitions active vs stale entries per settings.yml's aging window, and returns a matching contentHash", async () => {
    const now = new Date();
    const fresh = new Date(now.getTime() - 1 * 86_400_000).toISOString();
    const stale = new Date(now.getTime() - 40 * 86_400_000).toISOString();
    const raw = stringifyYaml({
      queue: [
        { id: "Q-1", company: "Acme", fit_score: 4.1, lastSeenAt: fresh },
        { id: "Q-2", company: "Beta", fit_score: 3.0, lastSeenAt: stale },
      ],
    });
    writeFileSync(join(tmpDir, "pipeline", "queue.yml"), raw);
    const res = await authedGet("/api/queue");
    const body = QueueResponseSchema.parse(await res.json());
    expect(body.active.map((e) => e.id)).toEqual(["Q-1"]);
    expect(body.staleCount).toBe(1);
    expect(body.contentHash).toBe(hashQueueContent(raw));
  });
});

// ── POST /api/queue/:id/promote, /dismiss (ADR 0024) ────────────────────────

function seedQueue(dir: string, entries: Array<Record<string, unknown>>): string {
  const raw = stringifyYaml({ queue: entries });
  writeFileSync(join(dir, "pipeline", "queue.yml"), raw);
  runGit([...GIT_IDENTITY, "add", "-A"], dir);
  runGit([...GIT_IDENTITY, "commit", "-m", "seed queue.yml"], dir);
  return raw;
}

describe("POST /api/queue/:id/promote", () => {
  it("missing csrf header -> 403 FORBIDDEN_CSRF", async () => {
    seedQueue(tmpDir, [{ id: "Q-001", company: "Gamma Inc", derived_role: "Senior Engineer", fit_score: 3.9 }]);
    const res = await authedJsonPost("/api/queue/Q-001/promote", {});
    expect(res.status).toBe(403);
    const body = await parseError(res);
    expect(body.error.code).toBe("FORBIDDEN_CSRF");
  });

  it("missing origin -> 403 FORBIDDEN_ORIGIN", async () => {
    seedQueue(tmpDir, [{ id: "Q-001", company: "Gamma Inc", derived_role: "Senior Engineer", fit_score: 3.9 }]);
    const res = await app.request("/api/queue/Q-001/promote", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie, "x-csrf-token": csrfToken },
      body: "{}",
    });
    expect(res.status).toBe(403);
    const body = await parseError(res);
    expect(body.error.code).toBe("FORBIDDEN_ORIGIN");
  });

  it("unknown queue entry id -> 404 NOT_FOUND", async () => {
    const raw = seedQueue(tmpDir, [{ id: "Q-OTHER", company: "Other Co", derived_role: "Engineer", fit_score: 3.0 }]);
    const res = await authedJsonPost(
      "/api/queue/NO-SUCH-ID/promote",
      { contentHash: hashQueueContent(raw) },
      { csrf: csrfToken },
    );
    expect(res.status).toBe(404);
    const body = await parseError(res);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("missing queue.yml -> 404 NOT_FOUND (no conflict check possible without a file)", async () => {
    const res = await authedJsonPost(
      "/api/queue/NO-SUCH-ID/promote",
      { contentHash: "anything" },
      { csrf: csrfToken },
    );
    expect(res.status).toBe(404);
    const body = await parseError(res);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("stale contentHash -> 409 CONFLICT (optimistic-lock guard)", async () => {
    seedQueue(tmpDir, [
      { id: "Q-001", company: "Gamma Inc", derived_role: "Senior Engineer", fit_score: 3.9 },
    ]);
    const res = await authedJsonPost(
      "/api/queue/Q-001/promote",
      { contentHash: "stale-hash-value" },
      { csrf: csrfToken },
    );
    expect(res.status).toBe(409);
    const body = await parseError(res);
    expect(body.error.code).toBe("CONFLICT");

    // Queue entry must be untouched — the guard must reject before any mutation.
    const queueRes = await authedGet("/api/queue");
    const queueBody = QueueResponseSchema.parse(await queueRes.json());
    expect(queueBody.active).toHaveLength(1);
  });

  it(
    "successful promote: 201 with the new application, entry removed from queue.yml, " +
      "appended to applications.yml, both in one git commit",
    async () => {
      const raw = seedQueue(tmpDir, [
        { id: "Q-001", company: "Gamma Inc", derived_role: "Senior Engineer", fit_score: 3.9, queuedAt: "2026-06-01T00:00:00.000Z" },
      ]);
      const before = execFileSync("git", ["log", "--oneline"], { cwd: tmpDir, encoding: "utf-8" }).trim().split("\n").length;

      const res = await authedJsonPost(
        "/api/queue/Q-001/promote",
        { contentHash: hashQueueContent(raw) },
        { csrf: csrfToken },
      );
      expect(res.status).toBe(201);
      const body = PromoteQueueEntryResponseSchema.parse(await res.json());
      expect(body.application.id).toBe("Q-001");
      expect(body.application.company).toBe("Gamma Inc");
      expect(body.application.role).toBe("Senior Engineer");
      expect(body.application.status).toBe("evaluating");
      expect(body.application.fit_score).toBe(3.9);

      const queueRes = await authedGet("/api/queue");
      const queueBody = QueueResponseSchema.parse(await queueRes.json());
      expect(queueBody.active).toEqual([]);

      const appsRes = await authedGet("/api/applications");
      const appsBody = ApplicationsListResponseSchema.parse(await appsRes.json());
      expect(appsBody.applications).toHaveLength(1);
      expect(appsBody.applications[0]?.id).toBe("Q-001");

      const after = execFileSync("git", ["log", "--oneline"], { cwd: tmpDir, encoding: "utf-8" }).trim().split("\n").length;
      expect(after).toBe(before + 1);
      const log = execFileSync("git", ["log", "-1", "--format=%s"], { cwd: tmpDir, encoding: "utf-8" });
      expect(log).toContain("web: promote");
      const filesChanged = execFileSync("git", ["show", "--stat", "--format=", "HEAD"], { cwd: tmpDir, encoding: "utf-8" });
      expect(filesChanged).toContain("queue.yml");
      expect(filesChanged).toContain("applications.yml");
    },
  );

  it("pre-commit hook rejection -> 422, queue.yml and applications.yml both reverted, no new commit", async () => {
    const raw = seedQueue(tmpDir, [
      { id: "Q-002", company: "Delta LLC", derived_role: "Staff Engineer", fit_score: 4.1 },
    ]);
    installFailingPreCommitHook(tmpDir);
    const before = execFileSync("git", ["log", "--oneline"], { cwd: tmpDir, encoding: "utf-8" }).trim().split("\n").length;

    const res = await authedJsonPost(
      "/api/queue/Q-002/promote",
      { contentHash: hashQueueContent(raw) },
      { csrf: csrfToken },
    );
    expect(res.status).toBe(422);
    const body = await parseError(res);
    expect(body.error.code).toBe("HOOK_REJECTED");

    const queueRes = await authedGet("/api/queue");
    const queueBody = QueueResponseSchema.parse(await queueRes.json());
    expect(queueBody.active).toHaveLength(1);
    expect(queueBody.active[0]?.id).toBe("Q-002");

    const appsRes = await authedGet("/api/applications");
    const appsBody = ApplicationsListResponseSchema.parse(await appsRes.json());
    expect(appsBody.applications).toEqual([]);

    const after = execFileSync("git", ["log", "--oneline"], { cwd: tmpDir, encoding: "utf-8" }).trim().split("\n").length;
    expect(after).toBe(before);
  });
});

describe("POST /api/queue/:id/dismiss", () => {
  it("missing csrf header -> 403", async () => {
    seedQueue(tmpDir, [{ id: "Q-003", company: "Epsilon Co", derived_role: "Engineer", fit_score: 2.1 }]);
    const res = await authedJsonPost("/api/queue/Q-003/dismiss", {});
    expect(res.status).toBe(403);
    const body = await parseError(res);
    expect(body.error.code).toBe("FORBIDDEN_CSRF");
  });

  it("unknown queue entry id -> 404 NOT_FOUND", async () => {
    const res = await authedJsonPost("/api/queue/NO-SUCH-ID/dismiss", {}, { csrf: csrfToken });
    expect(res.status).toBe(404);
    const body = await parseError(res);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("successful dismiss: 200 with the removed entry, queue.yml mutated, and a git commit created", async () => {
    seedQueue(tmpDir, [{ id: "Q-003", company: "Epsilon Co", derived_role: "Engineer", fit_score: 2.1 }]);
    const before = execFileSync("git", ["log", "--oneline"], { cwd: tmpDir, encoding: "utf-8" }).trim().split("\n").length;

    const res = await authedJsonPost("/api/queue/Q-003/dismiss", {}, { csrf: csrfToken });
    expect(res.status).toBe(200);
    const body = DismissQueueEntryResponseSchema.parse(await res.json());
    expect(body.dismissed.id).toBe("Q-003");

    const queueRes = await authedGet("/api/queue");
    const queueBody = QueueResponseSchema.parse(await queueRes.json());
    expect(queueBody.active).toEqual([]);

    const after = execFileSync("git", ["log", "--oneline"], { cwd: tmpDir, encoding: "utf-8" }).trim().split("\n").length;
    expect(after).toBe(before + 1);
    const log = execFileSync("git", ["log", "-1", "--format=%s"], { cwd: tmpDir, encoding: "utf-8" });
    expect(log).toContain("web: dismiss");
  });

  it("pre-commit hook rejection -> 422, queue.yml reverted, no new commit", async () => {
    seedQueue(tmpDir, [{ id: "Q-004", company: "Zeta Inc", derived_role: "Engineer", fit_score: 3.0 }]);
    installFailingPreCommitHook(tmpDir);
    const before = execFileSync("git", ["log", "--oneline"], { cwd: tmpDir, encoding: "utf-8" }).trim().split("\n").length;

    const res = await authedJsonPost("/api/queue/Q-004/dismiss", {}, { csrf: csrfToken });
    expect(res.status).toBe(422);
    const body = await parseError(res);
    expect(body.error.code).toBe("HOOK_REJECTED");

    const queueRes = await authedGet("/api/queue");
    const queueBody = QueueResponseSchema.parse(await queueRes.json());
    expect(queueBody.active).toHaveLength(1);

    const after = execFileSync("git", ["log", "--oneline"], { cwd: tmpDir, encoding: "utf-8" }).trim().split("\n").length;
    expect(after).toBe(before);
  });

  it("11th write in a session within the window -> 429 RATE_LIMITED", async () => {
    seedQueue(tmpDir, [{ id: "Q-005", company: "Eta Co", derived_role: "Engineer", fit_score: 3.0 }]);
    let last: Response | undefined;
    for (let i = 0; i < 11; i++) {
      last = await authedJsonPost("/api/queue/Q-005/dismiss", {}, { csrf: csrfToken });
    }
    expect(last?.status).toBe(429);
    const body = await parseError(last as Response);
    expect(body.error.code).toBe("RATE_LIMITED");
  });
});

// ── /api/coaching (read + debrief write) ────────────────────────────────────

describe("GET /api/coaching", () => {
  it("returns hasArchetype: false and an empty debrief list when no truth data exists", async () => {
    const res = await authedGet("/api/coaching");
    expect(res.status).toBe(200);
    const body = CoachingResponseSchema.parse(await res.json());
    expect(body.hasArchetype).toBe(false);
    expect(body.nextDrill).toBeNull();
    expect(body.debriefs).toEqual([]);
    expect(body.drillFiles).toEqual([]);
    expect(body.prepPacks).toEqual([]);
  });
});

describe("POST /api/debriefs", () => {
  it("missing csrf header -> 403", async () => {
    const res = await authedJsonPost("/api/debriefs", { application_id: "APP-002", date: "2026-06-15" });
    expect(res.status).toBe(403);
    const body = await parseError(res);
    expect(body.error.code).toBe("FORBIDDEN_CSRF");
  });

  it("more than 20 asked items -> 400", async () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `topic ${String(i)}`);
    const res = await authedJsonPost(
      "/api/debriefs",
      { application_id: "APP-002", date: "2026-06-15", asked: tooMany },
      { csrf: csrfToken },
    );
    expect(res.status).toBe(400);
    const body = await parseError(res);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("control character in notes -> 400", async () => {
    const res = await authedJsonPost(
      "/api/debriefs",
      { application_id: "APP-002", date: "2026-06-15", notes: `bad${String.fromCharCode(7)}note` },
      { csrf: csrfToken },
    );
    expect(res.status).toBe(400);
    const body = await parseError(res);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("malformed date -> 400", async () => {
    const res = await authedJsonPost(
      "/api/debriefs",
      { application_id: "APP-002", date: "06/15/2026" },
      { csrf: csrfToken },
    );
    expect(res.status).toBe(400);
    const body = await parseError(res);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("successful capture: 201 with the debrief, debriefs.yml written, and a git commit created", async () => {
    const requestBody = DebriefCreateRequestSchema.parse({
      application_id: "APP-002",
      date: "2026-06-15",
      round: "hiring manager",
      asked: ["system design", "leadership"],
      wobbled: ["system design"],
      went_well: ["leadership"],
      notes: "went okay",
    });
    const res = await authedJsonPost("/api/debriefs", requestBody, { csrf: csrfToken });
    expect(res.status).toBe(201);
    const body = DebriefCreateResponseSchema.parse(await res.json());
    expect(body.debrief.application_id).toBe("APP-002");
    expect(body.debrief.wobbled).toEqual(["system design"]);

    const log = execFileSync("git", ["log", "-1", "--format=%s"], { cwd: tmpDir, encoding: "utf-8" });
    expect(log).toContain("web: debrief");

    const coachingRes = await authedGet("/api/coaching");
    const coachingBody = CoachingResponseSchema.parse(await coachingRes.json());
    expect(coachingBody.debriefs).toHaveLength(1);
  });

  it("pre-commit hook rejection -> 422 and no debriefs.yml left behind", async () => {
    installFailingPreCommitHook(tmpDir);
    const res = await authedJsonPost(
      "/api/debriefs",
      { application_id: "APP-002", date: "2026-06-15" },
      { csrf: csrfToken },
    );
    expect(res.status).toBe(422);
    const body = await parseError(res);
    expect(body.error.code).toBe("HOOK_REJECTED");

    const { readDebriefsRaw } = await import("@selfwright/adapter-storage-git");
    expect(await readDebriefsRaw(tmpDir)).toBeNull();
  });
});

// ── /api/content ─────────────────────────────────────────────────────────────

describe("GET /api/content", () => {
  it("returns an empty digest list when none exist", async () => {
    const res = await authedGet("/api/content");
    const body = ContentResponseSchema.parse(await res.json());
    expect(body.digests).toEqual([]);
    expect(body.latestDigest).toBeNull();
  });

  it("returns the latest digest inline", async () => {
    writeFileSync(join(tmpDir, "content", "digests", "2026-07-01-week.md"), "# Week digest\n");
    const res = await authedGet("/api/content");
    const body = ContentResponseSchema.parse(await res.json());
    expect(body.digests).toEqual(["2026-07-01-week.md"]);
    expect(body.latestDigest?.file).toBe("2026-07-01-week.md");
    expect(body.latestDigest?.content).toContain("Week digest");
  });
});

// ── /api/overview + /api/reporting ──────────────────────────────────────────

describe("GET /api/overview", () => {
  it("returns north-star, fitness history, inbox summary counts, and digest count", async () => {
    seedApplications(tmpDir);
    const res = await authedGet("/api/overview");
    expect(res.status).toBe(200);
    const body = OverviewResponseSchema.parse(await res.json());
    expect(body.northStar.submitted).toBe(1);
    expect(Array.isArray(body.fitnessHistory)).toBe(true);
    expect(typeof body.inbox.decideNow).toBe("number");
    expect(body.digestCount).toBe(0);
  });
});

describe("GET /api/inbox", () => {
  it("returns the three-tier digest with an asOf timestamp", async () => {
    seedApplications(tmpDir);
    const res = await authedGet("/api/inbox");
    expect(res.status).toBe(200);
    const body = InboxResponseSchema.parse(await res.json());
    expect(typeof body.asOf).toBe("string");
    expect(Array.isArray(body.decideNow)).toBe(true);
    expect(Array.isArray(body.reviewSoon)).toBe(true);
    expect(Array.isArray(body.fyi)).toBe(true);
  });

  it("a high-fit queue entry surfaces in reviewSoon", async () => {
    writeFileSync(
      join(tmpDir, "pipeline", "queue.yml"),
      stringifyYaml({ queue: [{ id: "Q-HIGH", company: "Acme", derived_role: "Engineer", fit_score: 4.5 }] }),
    );
    const res = await authedGet("/api/inbox");
    const body = InboxResponseSchema.parse(await res.json());
    expect(body.reviewSoon.some((i) => i.id === "Q-HIGH")).toBe(true);
  });
});

describe("GET /api/reporting", () => {
  it("returns north-star, channel outcomes, byStatus, and fitness history", async () => {
    seedApplications(tmpDir);
    const res = await authedGet("/api/reporting");
    expect(res.status).toBe(200);
    const body = ReportingResponseSchema.parse(await res.json());
    expect(body.northStar.submitted).toBe(1);
    expect(body.byStatus["applied"]).toBe(1);
    expect(Array.isArray(body.channelOutcomes)).toBe(true);
  });
});

// ── /api/settings ────────────────────────────────────────────────────────────

describe("GET /api/settings", () => {
  it("returns {} when settings.yml is absent", async () => {
    const res = await authedGet("/api/settings");
    expect(res.status).toBe(200);
    const body = SettingsContractSchema.parse(await res.json());
    expect(body).toEqual({});
  });

  it("returns 500 DATA_CORRUPT (not silent defaults) when settings.yml is present but unparseable", async () => {
    writeFileSync(join(tmpDir, "settings.yml"), "::: not valid yaml [");
    const res = await authedGet("/api/settings");
    expect(res.status).toBe(500);
    const body = await parseError(res);
    expect(body.error.code).toBe("DATA_CORRUPT");
  });

  it("returns 500 DATA_CORRUPT (not silent defaults) when settings.yml fails schema validation", async () => {
    writeFileSync(join(tmpDir, "settings.yml"), "queue:\n  aging_window_days: -5\n");
    const res = await authedGet("/api/settings");
    expect(res.status).toBe(500);
    const body = await parseError(res);
    expect(body.error.code).toBe("DATA_CORRUPT");
  });
});

describe("PUT /api/settings", () => {
  it("missing csrf header -> 403", async () => {
    const res = await authedJsonPost("/api/settings", { queue: { aging_window_days: 14 } }, { method: "PUT" });
    expect(res.status).toBe(403);
    const body = await parseError(res);
    expect(body.error.code).toBe("FORBIDDEN_CSRF");
  });

  it("invalid body (non-positive aging_window_days) -> 400, generic message (no raw Zod internals leaked)", async () => {
    const res = await authedJsonPost(
      "/api/settings",
      { queue: { aging_window_days: 0 } },
      { method: "PUT", csrf: csrfToken },
    );
    expect(res.status).toBe(400);
    const body = await parseError(res);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("Invalid request: malformed settings document");
    expect(body.error.message).not.toContain("aging_window_days");
  });

  it("successful update: 200 with the written settings, settings.yml created, and a git commit made", async () => {
    const requestBody = SettingsUpdateRequestSchema.parse({ queue: { aging_window_days: 14 } });
    const res = await authedJsonPost("/api/settings", requestBody, { method: "PUT", csrf: csrfToken });
    expect(res.status).toBe(200);
    const body = SettingsUpdateResponseSchema.parse(await res.json());
    expect(body.settings.queue?.aging_window_days).toBe(14);

    const getRes = await authedGet("/api/settings");
    const getBody = SettingsContractSchema.parse(await getRes.json());
    expect(getBody).toEqual({ queue: { aging_window_days: 14 } });

    const log = execFileSync("git", ["log", "-1", "--format=%s"], { cwd: tmpDir, encoding: "utf-8" });
    expect(log).toContain("web: settings update");
  });

  it("pre-commit hook rejection -> 422 and settings.yml reverted to its pre-write state (never existed)", async () => {
    installFailingPreCommitHook(tmpDir);
    const res = await authedJsonPost(
      "/api/settings",
      { queue: { aging_window_days: 14 } },
      { method: "PUT", csrf: csrfToken },
    );
    expect(res.status).toBe(422);
    const body = await parseError(res);
    expect(body.error.code).toBe("HOOK_REJECTED");

    const getRes = await authedGet("/api/settings");
    const getBody = SettingsContractSchema.parse(await getRes.json());
    expect(getBody).toEqual({});
  });

  it("refuses to overwrite a present-but-corrupt settings.yml -> 500 DATA_CORRUPT, file untouched", async () => {
    const corruptRaw = "::: not valid yaml [";
    writeFileSync(join(tmpDir, "settings.yml"), corruptRaw);
    const res = await authedJsonPost(
      "/api/settings",
      { queue: { aging_window_days: 14 } },
      { method: "PUT", csrf: csrfToken },
    );
    expect(res.status).toBe(500);
    const body = await parseError(res);
    expect(body.error.code).toBe("DATA_CORRUPT");

    // The corrupt file must be left exactly as it was -- no silent overwrite.
    expect(readFileSync(join(tmpDir, "settings.yml"), "utf-8")).toBe(corruptRaw);
  });
});

// ── /brand-icon.png ──────────────────────────────────────────────────────────

describe("GET /brand-icon.png", () => {
  it("is publicly accessible without a session (not protected by authMiddleware)", async () => {
    // Request WITHOUT a session cookie — must not return 401 or redirect to /login.
    // Accept 200 (asset present in this environment) or 404 (asset not built in
    // the test environment); either is correct — the important invariant is the
    // route bypasses auth entirely.
    const res = await app.request("/brand-icon.png");
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(302);
    if (res.status === 200) {
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    }
  });
});

// ── promote revert filesystem assertion ──────────────────────────────────────

describe("POST /api/queue/:id/promote — filesystem revert when applications.yml did not exist before", () => {
  it("hook rejection deletes applications.yml rather than leaving it empty when it did not exist before the promote", async () => {
    // Seed ONLY queue.yml — no applications.yml exists.
    const raw = seedQueue(tmpDir, [
      { id: "Q-REVERT", company: "Revert Corp", derived_role: "Engineer", fit_score: 3.5 },
    ]);
    installFailingPreCommitHook(tmpDir);

    const applicationsPath = join(tmpDir, "applications", "applications.yml");
    expect(existsSync(applicationsPath)).toBe(false);

    const res = await authedJsonPost(
      "/api/queue/Q-REVERT/promote",
      { contentHash: hashQueueContent(raw) },
      { csrf: csrfToken },
    );
    expect(res.status).toBe(422);

    // The fix (queue.ts): on revert, rm() the file rather than writing [].
    // The data dir must not be left with an untracked empty applications.yml.
    expect(existsSync(applicationsPath)).toBe(false);
  });
});

// ── /api/scan-targets ────────────────────────────────────────────────────────

function seedScanTargets(dir: string): void {
  writeFileSync(
    join(dir, "pipeline", "scan-targets.yml"),
    "targets:\n  - company: Acme\n    provider: generic\n",
  );
  runGit([...GIT_IDENTITY, "add", "-A"], dir);
  runGit([...GIT_IDENTITY, "commit", "-m", "seed scan-targets.yml"], dir);
}

describe("GET /api/scan-targets", () => {
  it("returns an empty targets array when scan-targets.yml is absent", async () => {
    const res = await authedGet("/api/scan-targets");
    expect(res.status).toBe(200);
    const body = ScanTargetsContractSchema.parse(await res.json());
    expect(body.targets).toEqual([]);
  });

  it("returns seeded targets", async () => {
    seedScanTargets(tmpDir);
    const res = await authedGet("/api/scan-targets");
    expect(res.status).toBe(200);
    const body = ScanTargetsContractSchema.parse(await res.json());
    expect(body.targets).toHaveLength(1);
    expect(body.targets[0]?.company).toBe("Acme");
  });

  it("returns 500 DATA_CORRUPT (not silent defaults) when scan-targets.yml is present but unparseable", async () => {
    writeFileSync(join(tmpDir, "pipeline", "scan-targets.yml"), "::: not valid yaml [");
    const res = await authedGet("/api/scan-targets");
    expect(res.status).toBe(500);
    const body = await parseError(res);
    expect(body.error.code).toBe("DATA_CORRUPT");
  });

  it("returns 500 DATA_CORRUPT (not silent defaults) when scan-targets.yml fails schema validation", async () => {
    // 'company' is required — missing it fails validation
    writeFileSync(join(tmpDir, "pipeline", "scan-targets.yml"), "targets:\n  - provider: greenhouse\n");
    const res = await authedGet("/api/scan-targets");
    expect(res.status).toBe(500);
    const body = await parseError(res);
    expect(body.error.code).toBe("DATA_CORRUPT");
  });
});

describe("PUT /api/scan-targets", () => {
  it("missing csrf header -> 403 FORBIDDEN_CSRF", async () => {
    const res = await authedJsonPost("/api/scan-targets", { targets: [] }, { method: "PUT" });
    expect(res.status).toBe(403);
    const body = await parseError(res);
    expect(body.error.code).toBe("FORBIDDEN_CSRF");
  });

  it("missing origin -> 403 FORBIDDEN_ORIGIN", async () => {
    const res = await app.request("/api/scan-targets", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ targets: [] }),
    });
    expect(res.status).toBe(403);
    const body = await parseError(res);
    expect(body.error.code).toBe("FORBIDDEN_ORIGIN");
  });

  it("missing required company field in a target -> 400 VALIDATION_ERROR, generic message (no raw Zod internals leaked)", async () => {
    const res = await authedJsonPost(
      "/api/scan-targets",
      { targets: [{ provider: "generic" }] },
      { method: "PUT", csrf: csrfToken },
    );
    expect(res.status).toBe(400);
    const body = await parseError(res);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("Invalid request: malformed scan-targets document");
    expect(body.error.message).not.toContain("company");
  });

  it("successful update: 200 with the written targets, scan-targets.yml created, and a git commit made", async () => {
    const requestBody = ScanTargetsUpdateRequestSchema.parse({
      targets: [{ company: "TechCo", provider: "generic" }],
    });
    const res = await authedJsonPost("/api/scan-targets", requestBody, { method: "PUT", csrf: csrfToken });
    expect(res.status).toBe(200);
    const body = ScanTargetsUpdateResponseSchema.parse(await res.json());
    expect(body.targets).toHaveLength(1);
    expect(body.targets[0]?.company).toBe("TechCo");

    const getRes = await authedGet("/api/scan-targets");
    const getBody = ScanTargetsContractSchema.parse(await getRes.json());
    expect(getBody.targets[0]?.company).toBe("TechCo");

    const log = execFileSync("git", ["log", "-1", "--format=%s"], { cwd: tmpDir, encoding: "utf-8" });
    expect(log).toContain("web: scan-targets update");
  });

  it("pre-commit hook rejection -> 422 and scan-targets.yml reverted to its pre-write state (never existed)", async () => {
    installFailingPreCommitHook(tmpDir);
    const res = await authedJsonPost(
      "/api/scan-targets",
      { targets: [{ company: "TechCo", provider: "generic" }] },
      { method: "PUT", csrf: csrfToken },
    );
    expect(res.status).toBe(422);
    const body = await parseError(res);
    expect(body.error.code).toBe("HOOK_REJECTED");

    const getRes = await authedGet("/api/scan-targets");
    const getBody = ScanTargetsContractSchema.parse(await getRes.json());
    expect(getBody.targets).toEqual([]);
  });

  it("refuses to overwrite a present-but-corrupt scan-targets.yml -> 500 DATA_CORRUPT, file untouched", async () => {
    const corruptRaw = "::: not valid yaml [";
    writeFileSync(join(tmpDir, "pipeline", "scan-targets.yml"), corruptRaw);
    const res = await authedJsonPost(
      "/api/scan-targets",
      { targets: [{ company: "TechCo", provider: "generic" }] },
      { method: "PUT", csrf: csrfToken },
    );
    expect(res.status).toBe(500);
    const body = await parseError(res);
    expect(body.error.code).toBe("DATA_CORRUPT");

    // The corrupt file must be left exactly as it was -- no silent overwrite.
    expect(readFileSync(join(tmpDir, "pipeline", "scan-targets.yml"), "utf-8")).toBe(corruptRaw);
  });
});

// ── 404 ──────────────────────────────────────────────────────────────────────

describe("unknown /api/* route", () => {
  it("returns a JSON NOT_FOUND envelope, not plain text", async () => {
    const res = await authedGet("/api/does-not-exist");
    expect(res.status).toBe(404);
    const body = await parseError(res);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
