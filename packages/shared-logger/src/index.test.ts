import { join } from "node:path";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, afterEach } from "vitest";
import { createLogger } from "./index.js";

describe("createLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["debug", "info", "warn", "error"] as const)(
    "writes the expected stderr line for level %s",
    (level) => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      const logger = createLogger("test-source");
      logger[level]("my message");
      expect(stderrSpy).toHaveBeenCalledWith(
        `[test-source] ${level.toUpperCase()}: my message\n`,
      );
    },
  );

  it("appends a JSONL entry with all fields including meta when filePath is given", () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const dir = join(tmpdir(), randomUUID());
    const filePath = join(dir, "test.jsonl");
    const logger = createLogger("file-source", { filePath });

    logger.info("hello world", { key: "value" });

    const line = readFileSync(filePath, "utf-8").trim();
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed["level"]).toBe("info");
    expect(parsed["source"]).toBe("file-source");
    expect(parsed["message"]).toBe("hello world");
    expect(parsed["meta"]).toEqual({ key: "value" });
    expect(typeof parsed["timestamp"]).toBe("string");
  });

  it("omits meta field from the JSONL entry when meta is not provided", () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const dir = join(tmpdir(), randomUUID());
    const filePath = join(dir, "test.jsonl");
    const logger = createLogger("file-source", { filePath });

    logger.debug("no meta here");

    const line = readFileSync(filePath, "utf-8").trim();
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(parsed, "meta")).toBe(false);
  });

  it("does not write a file when filePath is not provided", () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const logger = createLogger("no-file");
    expect(() => { logger.info("no file written"); }).not.toThrow();
  });

  it("creates nested parent directories when filePath points to a non-existent path", () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const filePath = join(tmpdir(), randomUUID(), "deep", "nested", "log.jsonl");
    const logger = createLogger("mkdir-source", { filePath });

    logger.warn("mkdir test");

    const line = readFileSync(filePath, "utf-8").trim();
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed["level"]).toBe("warn");
    expect(parsed["source"]).toBe("mkdir-source");
  });

  it("appends multiple entries to the same file", () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const filePath = join(tmpdir(), randomUUID(), "multi.jsonl");
    const logger = createLogger("multi-source", { filePath });

    logger.info("first");
    logger.error("second");

    const lines = readFileSync(filePath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const levels = lines.map((l) => (JSON.parse(l) as Record<string, unknown>)["level"]);
    expect(levels).toEqual(["info", "error"]);
  });

  it("does not throw when filePath directory cannot be created (best-effort write)", () => {
    // Create a *file* (not a directory) and then try to use it as a parent dir.
    // mkdirSync will fail because the parent path is an existing regular file.
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const baseDir = join(tmpdir(), randomUUID());
    mkdirSync(baseDir, { recursive: true });
    const fileActingAsDir = join(baseDir, "not-a-dir.txt");
    writeFileSync(fileActingAsDir, "");  // create a regular file
    const filePath = join(fileActingAsDir, "log.jsonl");  // parent is a file, not a dir

    const logger = createLogger("safe-source", { filePath });
    // Must not throw — disk errors are swallowed with a stderr warning
    expect(() => { logger.error("should not throw"); }).not.toThrow();
  });
});
