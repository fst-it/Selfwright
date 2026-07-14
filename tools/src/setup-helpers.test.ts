// Unit tests for the pure helper functions exported by scripts/setup.mjs.
// Uses Node's built-in module import (no bundler needed for these ESM helpers).
// Keeps the test surface to the deterministic, side-effect-free functions so
// the suite has no filesystem or network side-effects.
import { describe, expect, it } from "vitest";

// ── Inline copies of the pure helpers from scripts/setup.mjs ─────────────────
// These are kept in sync manually. The canonical source is setup.mjs; these
// copies let the test run inside the tools Vitest config without dynamic
// import of the main script (which would trigger its side-effects).

function parseArgs(argv: string[]): {
  nonInteractive: boolean;
  withPlaywright: boolean;
  dataDir: string | null;
  cloneData: string | null;
  initTemplate: boolean;
} {
  const args = { nonInteractive: false, withPlaywright: false, dataDir: null as string | null, cloneData: null as string | null, initTemplate: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--non-interactive") args.nonInteractive = true;
    else if (a === "--with-playwright") args.withPlaywright = true;
    else if (a === "--init-template") args.initTemplate = true;
    else if (a === "--data-dir" && argv[i + 1]) { const v = argv[++i]; if (v !== undefined) args.dataDir = v; }
    else if (a === "--clone-data" && argv[i + 1]) { const v = argv[++i]; if (v !== undefined) args.cloneData = v; }
  }
  return args;
}

function mergeEnvFile(existing: string, newVars: Record<string, string>): string {
  const lines = existing ? existing.split(/\r?\n/) : [];
  const added = new Set<string>();
  const updated = lines.map((line) => {
    if (line.startsWith("#") || !line.includes("=")) return line;
    const key = line.slice(0, line.indexOf("=")).trim();
    if (key in newVars) {
      added.add(key);
      return `${key}=${newVars[key]}`;
    }
    return line;
  });
  while (updated.length > 0 && updated[updated.length - 1] === "") {
    updated.pop();
  }
  for (const [k, v] of Object.entries(newVars)) {
    if (!added.has(k)) updated.push(`${k}=${v}`);
  }
  const trimmed = updated.join("\n").replace(/\n+$/, "");
  return trimmed + "\n";
}

// ── parseArgs ─────────────────────────────────────────────────────────────────

describe("parseArgs", () => {
  it("defaults all flags to false/null", () => {
    const args = parseArgs([]);
    expect(args).toEqual({
      nonInteractive: false,
      withPlaywright: false,
      dataDir: null,
      cloneData: null,
      initTemplate: false,
    });
  });

  it("parses --non-interactive", () => {
    expect(parseArgs(["--non-interactive"]).nonInteractive).toBe(true);
  });

  it("parses --with-playwright", () => {
    expect(parseArgs(["--with-playwright"]).withPlaywright).toBe(true);
  });

  it("parses --init-template", () => {
    expect(parseArgs(["--init-template"]).initTemplate).toBe(true);
  });

  it("parses --data-dir with a value", () => {
    expect(parseArgs(["--data-dir", "/my/data"]).dataDir).toBe("/my/data");
  });

  it("parses --clone-data with a URL", () => {
    expect(parseArgs(["--clone-data", "https://github.com/me/my-data.git"]).cloneData).toBe(
      "https://github.com/me/my-data.git",
    );
  });

  it("parses multiple flags together", () => {
    const args = parseArgs(["--non-interactive", "--data-dir", "/tmp/data", "--with-playwright"]);
    expect(args.nonInteractive).toBe(true);
    expect(args.dataDir).toBe("/tmp/data");
    expect(args.withPlaywright).toBe(true);
  });

  it("ignores unknown flags without error", () => {
    const args = parseArgs(["--unknown-flag", "--data-dir", "/x"]);
    expect(args.dataDir).toBe("/x");
  });
});

// ── mergeEnvFile ──────────────────────────────────────────────────────────────

describe("mergeEnvFile", () => {
  it("appends a new key to an empty file", () => {
    const result = mergeEnvFile("", { SELFWRIGHT_DATA_DIR: "/data" });
    expect(result).toBe("SELFWRIGHT_DATA_DIR=/data\n");
  });

  it("appends a new key to an existing file", () => {
    const result = mergeEnvFile("FOO=bar\n", { SELFWRIGHT_DATA_DIR: "/data" });
    expect(result).toBe("FOO=bar\nSELFWRIGHT_DATA_DIR=/data\n");
  });

  it("replaces an existing key in-place", () => {
    const result = mergeEnvFile("SELFWRIGHT_DATA_DIR=old\nFOO=bar\n", {
      SELFWRIGHT_DATA_DIR: "/new/path",
    });
    expect(result).toBe("SELFWRIGHT_DATA_DIR=/new/path\nFOO=bar\n");
  });

  it("preserves comment lines unchanged", () => {
    const result = mergeEnvFile("# This is a comment\nFOO=bar\n", { BAZ: "qux" });
    expect(result).toBe("# This is a comment\nFOO=bar\nBAZ=qux\n");
  });

  it("preserves other existing keys unchanged", () => {
    const result = mergeEnvFile("POSTGRES_PASSWORD=secret\nSELFWRIGHT_DATA_DIR=old\n", {
      SELFWRIGHT_DATA_DIR: "/new",
    });
    expect(result).toBe("POSTGRES_PASSWORD=secret\nSELFWRIGHT_DATA_DIR=/new\n");
  });

  it("always produces exactly one trailing newline", () => {
    const result = mergeEnvFile("FOO=bar\n\n\n", { BAZ: "qux" });
    expect(result.endsWith("\n")).toBe(true);
    expect(result.endsWith("\n\n")).toBe(false);
  });

  it("handles CRLF line endings in existing content", () => {
    const result = mergeEnvFile("FOO=bar\r\nSELFWRIGHT_DATA_DIR=old\r\n", {
      SELFWRIGHT_DATA_DIR: "/new",
    });
    expect(result).toContain("SELFWRIGHT_DATA_DIR=/new");
    expect(result).toContain("FOO=bar");
  });

  it("handles multiple new vars", () => {
    const result = mergeEnvFile("", { A: "1", B: "2" });
    expect(result).toContain("A=1");
    expect(result).toContain("B=2");
  });
});
