/**
 * Unit tests for the dependency-free .env loader.
 *
 * parseDotEnv is a pure function so every case is deterministic.
 * loadDotEnv is tested with a temporary directory to exercise the
 * file-read path and the no-override-of-explicit-env semantics.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDotEnv, loadDotEnv } from "../load-dotenv.js";

// ── parseDotEnv ───────────────────────────────────────────────────────────────

describe("parseDotEnv", () => {
  it("parses a simple KEY=VALUE line", () => {
    expect(parseDotEnv("FOO=bar")).toEqual({ FOO: "bar" });
  });

  it("ignores blank lines", () => {
    expect(parseDotEnv("\nFOO=bar\n\nBAZ=qux\n")).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("ignores comment lines starting with #", () => {
    const text = "# this is a comment\nFOO=bar\n# another comment\nBAZ=qux";
    expect(parseDotEnv(text)).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("strips surrounding double quotes from values", () => {
    expect(parseDotEnv('FOO="hello world"')).toEqual({ FOO: "hello world" });
  });

  it("strips surrounding single quotes from values", () => {
    expect(parseDotEnv("FOO='hello world'")).toEqual({ FOO: "hello world" });
  });

  it("does not strip mismatched quotes", () => {
    // Outer chars differ — no stripping should happen
    expect(parseDotEnv("FOO=\"hello'")).toEqual({ FOO: "\"hello'" });
  });

  it("trims whitespace around keys and values", () => {
    expect(parseDotEnv("  FOO  =  bar  ")).toEqual({ FOO: "bar" });
  });

  it("handles values that contain = characters", () => {
    expect(parseDotEnv("FOO=a=b=c")).toEqual({ FOO: "a=b=c" });
  });

  it("returns empty object for empty string", () => {
    expect(parseDotEnv("")).toEqual({});
  });

  it("skips lines without an = sign", () => {
    expect(parseDotEnv("NOEQUALSSIGN\nFOO=bar")).toEqual({ FOO: "bar" });
  });

  it("parses multiple entries", () => {
    const text = [
      "SELFWRIGHT_DATA_DIR=/tmp/data",
      "NTFY_URL=https://ntfy.example.com/topic",
      "LITELLM_BASE_URL=http://localhost:4000",
    ].join("\n");
    expect(parseDotEnv(text)).toEqual({
      SELFWRIGHT_DATA_DIR: "/tmp/data",
      NTFY_URL: "https://ntfy.example.com/topic",
      LITELLM_BASE_URL: "http://localhost:4000",
    });
  });
});

// ── loadDotEnv ────────────────────────────────────────────────────────────────

describe("loadDotEnv", () => {
  let tmpDir: string;
  const TEST_KEY = "__SW_DOTENV_TEST__";

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sw-dotenv-"));
    Reflect.deleteProperty(process.env, TEST_KEY);
  });

  afterEach(async () => {
    Reflect.deleteProperty(process.env, TEST_KEY);
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("sets a missing env key from .env", async () => {
    await writeFile(join(tmpDir, ".env"), `${TEST_KEY}=from-dotenv\n`, "utf-8");
    loadDotEnv(tmpDir);
    expect(process.env[TEST_KEY]).toBe("from-dotenv");
  });

  it("does NOT override a key already set in process.env", async () => {
    process.env[TEST_KEY] = "already-set";
    await writeFile(join(tmpDir, ".env"), `${TEST_KEY}=from-dotenv\n`, "utf-8");
    loadDotEnv(tmpDir);
    expect(process.env[TEST_KEY]).toBe("already-set");
  });

  it("does nothing when .env is absent (no throw)", () => {
    // No .env written — should not throw
    expect(() => { loadDotEnv(tmpDir); }).not.toThrow();
    expect(process.env[TEST_KEY]).toBeUndefined();
  });

  it("strips quotes when setting values", async () => {
    await writeFile(join(tmpDir, ".env"), `${TEST_KEY}="quoted-value"\n`, "utf-8");
    loadDotEnv(tmpDir);
    expect(process.env[TEST_KEY]).toBe("quoted-value");
  });
});
