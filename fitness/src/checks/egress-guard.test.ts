// FF-EGRESS (ADR 0017 §3) — fixtures build a synthetic packages/adapters/**-shaped repo
// root under the OS temp dir per test; nothing here touches the real repo tree.
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkEgressGuard } from "./egress-guard.js";

function tmpRepoRoot(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${String(Date.now())}-${String(Math.random()).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeAdapterFile(repoRoot: string, relPath: string, content: string): void {
  const full = join(repoRoot, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

describe("checkEgressGuard — aliased/bound fetch detection (GAP-2 fix)", () => {
  let repoRoot: string;

  afterEach(() => {
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  it("FAILS on a wrapper class that binds fetch to a property and calls it, with no guard", () => {
    repoRoot = tmpRepoRoot("egress-alias-unguarded");
    writeAdapterFile(
      repoRoot,
      "packages/adapters/webhook-relay/src/relay-client.ts",
      [
        "export class RelayClient {",
        "  private doRequest = fetch.bind(globalThis);",
        "  async send(url: string): Promise<Response> {",
        "    return this.doRequest(url);",
        "  }",
        "}",
      ].join("\n"),
    );

    const result = checkEgressGuard(repoRoot);
    expect(result.passed).toBe(false);
    expect(result.details).toMatch(/relay-client\.ts/);
  });

  it("PASSES the same bound-fetch pattern once the URL is routed through an assert*Url guard", () => {
    repoRoot = tmpRepoRoot("egress-alias-guarded");
    writeAdapterFile(
      repoRoot,
      "packages/adapters/webhook-relay/src/relay-client.ts",
      [
        "import { assertAllowedUrl } from './guard.js';",
        "export class RelayClient {",
        "  private doRequest = fetch.bind(globalThis);",
        "  async send(url: string): Promise<Response> {",
        "    assertAllowedUrl(url);",
        "    return this.doRequest(url);",
        "  }",
        "}",
      ].join("\n"),
    );

    const result = checkEgressGuard(repoRoot);
    expect(result.passed).toBe(true);
  });

  it("catches `= fetch` (bare alias assignment, not a bind) with no guard", () => {
    repoRoot = tmpRepoRoot("egress-alias-bare");
    writeAdapterFile(
      repoRoot,
      "packages/adapters/webhook-relay/src/relay-client.ts",
      [
        "export class RelayClient {",
        "  private doRequest = fetch;",
        "  async send(url: string): Promise<Response> {",
        "    return this.doRequest(url);",
        "  }",
        "}",
      ].join("\n"),
    );

    const result = checkEgressGuard(repoRoot);
    expect(result.passed).toBe(false);
  });

  it("catches `const f = globalThis.fetch` with no guard", () => {
    repoRoot = tmpRepoRoot("egress-alias-globalthis");
    writeAdapterFile(
      repoRoot,
      "packages/adapters/webhook-relay/src/relay-client.ts",
      ["export function send(url: string) {", "  const f = globalThis.fetch;", "  return f(url);", "}"].join(
        "\n",
      ),
    );

    const result = checkEgressGuard(repoRoot);
    expect(result.passed).toBe(false);
  });

  it("catches `const { fetch } = globalThis` destructuring with no guard", () => {
    repoRoot = tmpRepoRoot("egress-alias-destructure");
    writeAdapterFile(
      repoRoot,
      "packages/adapters/webhook-relay/src/relay-client.ts",
      ["export function send(url: string) {", "  const { fetch } = globalThis;", "  return fetch(url);", "}"].join(
        "\n",
      ),
    );

    const result = checkEgressGuard(repoRoot);
    expect(result.passed).toBe(false);
  });

  it("PASSES a legitimately-guarded literal fetch (no aliasing involved)", () => {
    repoRoot = tmpRepoRoot("egress-literal-guarded");
    writeAdapterFile(
      repoRoot,
      "packages/adapters/webhook-relay/src/relay-client.ts",
      [
        "import { assertAllowedUrl } from './guard.js';",
        "export async function send(url: string) {",
        "  assertAllowedUrl(url);",
        "  return fetch(url);",
        "}",
      ].join("\n"),
    );

    const result = checkEgressGuard(repoRoot);
    expect(result.passed).toBe(true);
  });

  it("does NOT trip hasEgress on a comment that merely mentions fetch(", () => {
    repoRoot = tmpRepoRoot("egress-comment-only");
    writeAdapterFile(
      repoRoot,
      "packages/adapters/webhook-relay/src/relay-client.ts",
      [
        "// Note: this file intentionally avoids fetch(url) — see ADR 0017.",
        "/* historical note: we used to call fetch(url) directly here */",
        "export function noop(): void {}",
      ].join("\n"),
    );

    const result = checkEgressGuard(repoRoot);
    expect(result.passed).toBe(true);
  });

  it("still flags a real unguarded fetch( call on a line that also has a trailing comment", () => {
    repoRoot = tmpRepoRoot("egress-comment-plus-real-call");
    writeAdapterFile(
      repoRoot,
      "packages/adapters/webhook-relay/src/relay-client.ts",
      [
        "export async function send(url: string) {",
        "  return fetch(url); // no guard here, should still fail",
        "}",
      ].join("\n"),
    );

    const result = checkEgressGuard(repoRoot);
    expect(result.passed).toBe(false);
  });

  it("does not false-positive strip an http:// URL literal as a line comment", () => {
    repoRoot = tmpRepoRoot("egress-url-literal");
    writeAdapterFile(
      repoRoot,
      "packages/adapters/webhook-relay/src/relay-client.ts",
      [
        "import { assertAllowedUrl } from './guard.js';",
        "const BASE_URL = 'http://localhost:9999'; // local dev default",
        "export async function send(path: string) {",
        "  const url = BASE_URL + path;",
        "  assertAllowedUrl(url);",
        "  return fetch(url);",
        "}",
      ].join("\n"),
    );

    const result = checkEgressGuard(repoRoot);
    expect(result.passed).toBe(true);
  });

  it("an unguarded fetch after an http:// literal on the same line is still caught", () => {
    repoRoot = tmpRepoRoot("egress-url-literal-unguarded");
    writeAdapterFile(
      repoRoot,
      "packages/adapters/webhook-relay/src/relay-client.ts",
      [
        "export async function send() {",
        "  const url = 'http://localhost:9999'; return fetch(url);",
        "}",
      ].join("\n"),
    );

    const result = checkEgressGuard(repoRoot);
    expect(result.passed).toBe(false);
  });
});

describe("checkEgressGuard — no new false positives on real allowlisted/guarded files", () => {
  it("passes clean when packages/adapters and apps don't exist (nothing to scan)", () => {
    const repoRoot = tmpRepoRoot("egress-empty-repo");
    try {
      const result = checkEgressGuard(repoRoot);
      expect(result.passed).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("confirms the real repo's current packages/adapters/** and apps/** still pass FF-EGRESS", () => {
    // Runs against the actual checked-out repo (six allowlisted egress files: litellm,
    // ollama, mem0, scan-http/http-context.ts, apps/web-ui/src/lib/api.ts, and
    // apps/web-ui/e2e/cockpit.e2e.ts) — proves the broadened alias/bind/destructure
    // detection and comment-stripping introduce no new false positive against real source.
    const realRepoRoot = join(import.meta.dirname, "..", "..", "..");
    const result = checkEgressGuard(realRepoRoot);
    expect(result.passed).toBe(true);
  });

  it("the apps/web-ui/src/lib/api.ts allowlist entry is scoped to that exact file, not the whole app", () => {
    // A second, unallowlisted fetch() call site elsewhere in the same app must still fail —
    // proves the T5.10 allowlist addition doesn't blanket-exempt apps/web-ui.
    const repoRoot = tmpRepoRoot("egress-web-ui-scoped");
    try {
      writeAdapterFile(
        repoRoot,
        "apps/web-ui/src/lib/api.ts",
        "export async function request(path: string) { return fetch(path); }",
      );
      writeAdapterFile(
        repoRoot,
        "apps/web-ui/src/lib/other.ts",
        "export async function request(url: string) { return fetch(url); }",
      );
      const result = checkEgressGuard(repoRoot);
      expect(result.passed).toBe(false);
      expect(result.details).toMatch(/other\.ts/);
      expect(result.details).not.toMatch(/lib\/api\.ts/);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
