import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Archetype, EvidenceEntry, Ontology } from "@selfwright/core";

// getTruth() in index.ts constructs `new TruthLoader(dir)` directly — mock
// the class so tests never touch a real git-backed truth directory. The
// other exports (migrateCareerPlanOverlay, parseYaml, ...) pass through
// unmocked since they're pure and side-effect-free at import time.
const loadArchetypesMock = vi.fn();
const loadOntologyMock = vi.fn();
const loadEvidenceRegistryMock = vi.fn();
const loadIdentityMock = vi.fn();
const loadGapsMock = vi.fn();

vi.mock("@selfwright/adapter-storage-git", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@selfwright/adapter-storage-git")>();
  return {
    ...actual,
    TruthLoader: vi.fn().mockImplementation(() => ({
      loadArchetypes: loadArchetypesMock,
      loadOntology: loadOntologyMock,
      loadEvidenceRegistry: loadEvidenceRegistryMock,
      loadIdentity: loadIdentityMock,
      loadGaps: loadGapsMock,
    })),
  };
});

// Imported after the mock is registered (vi.mock is hoisted above imports by
// vitest, but importing index.js triggers module-load side effects — Server
// construction and handler registration only; server.connect() is guarded
// behind isMainModule() and does not run here, see R7 in index.ts).
const { handleCallTool, redactAbsolutePaths } = await import("../index.js");

function makeRequest(name: string, args: Record<string, unknown> = {}): CallToolRequest {
  return { method: "tools/call", params: { name, arguments: args } };
}

function textOf(result: Awaited<ReturnType<typeof handleCallTool>>): string {
  const block = result.content[0];
  if (block === undefined || block.type !== "text") throw new Error("expected a text content block");
  return block.text;
}

// Same minimal fixtures shape as packages/core/src/scoring/__tests__/jd-score.test.ts.
const CTRM_ARCH: Archetype = {
  id: "ctrm-enterprise-architect",
  label: "CTRM Enterprise Architect",
  related_titles: ["Enterprise Architect", "CTRM Architect"],
  match_keywords: ["CTRM", "trading", "commodities", "architecture"],
  search: {
    geos: ["Amsterdam", "Geneva"],
    seniority: ["senior", "principal", "architect"],
  },
};

const ONTOLOGY: Ontology = {
  CTRM: ["commodity trading", "energy trading"],
  architecture: ["solution design"],
};

const REGISTRY: EvidenceEntry[] = [
  {
    id: "EVD-GLOBEX-ARCH",
    org: "Globex",
    claim: "Led CTRM architecture",
    tag: "hard",
    keywords: ["CTRM", "architecture", "trading"],
  },
];

// ── redactAbsolutePaths ──────────────────────────────────────────────────────

describe("redactAbsolutePaths", () => {
  it("strips a Windows absolute path from a message", () => {
    const msg = "ENOENT: no such file or directory, open 'C:\\Users\\felipe\\data\\archetypes.yml'";
    const redacted = redactAbsolutePaths(msg);
    expect(redacted).not.toContain("C:\\Users");
    expect(redacted).toContain("<path>");
  });

  it("strips a POSIX absolute path from a message", () => {
    const msg = "ENOENT: no such file or directory, open '/home/felipe/data/archetypes.yml'";
    const redacted = redactAbsolutePaths(msg);
    expect(redacted).not.toContain("/home/felipe");
    expect(redacted).toContain("<path>");
  });

  it("strips absolute paths from a simulated err.stack, including Windows frames (round-2 fix)", () => {
    const stack = [
      "Error: ENOENT: no such file or directory, open 'C:\\Users\\felipe\\data\\archetypes.yml'",
      "    at Object.openSync (node:fs:601:3)",
      "    at C:\\dev\\Selfwright\\apps\\mcp\\dist\\index.js:120:15",
    ].join("\n");
    const redacted = redactAbsolutePaths(stack);
    expect(redacted).not.toContain("C:\\Users");
    expect(redacted).not.toContain("C:\\dev\\Selfwright");
  });

  it("strips absolute paths from a simulated err.stack with POSIX frames (round-2 fix)", () => {
    const stack = [
      "Error: ENOENT: no such file or directory, open '/home/felipe/data/archetypes.yml'",
      "    at Object.openSync (node:fs:601:3)",
      "    at /home/felipe/Selfwright/apps/mcp/dist/index.js:120:15",
    ].join("\n");
    const redacted = redactAbsolutePaths(stack);
    expect(redacted).not.toContain("/home/felipe");
  });

  it("leaves a message with no absolute paths unchanged", () => {
    expect(redactAbsolutePaths('archetype "foo" not found')).toBe('archetype "foo" not found');
  });
});

// ── handleCallTool ───────────────────────────────────────────────────────────

describe("handleCallTool", () => {
  const originalDataDir = process.env["SELFWRIGHT_DATA_DIR"];

  beforeEach(() => {
    loadArchetypesMock.mockReset();
    loadOntologyMock.mockReset();
    loadEvidenceRegistryMock.mockReset();
    loadIdentityMock.mockReset();
    loadGapsMock.mockReset();
  });

  afterEach(() => {
    if (originalDataDir === undefined) delete process.env["SELFWRIGHT_DATA_DIR"];
    else process.env["SELFWRIGHT_DATA_DIR"] = originalDataDir;
  });

  it("happy path: score tool routes to scoreService and returns a scored result", async () => {
    process.env["SELFWRIGHT_DATA_DIR"] = "C:\\fake\\data";
    loadArchetypesMock.mockResolvedValue({ ok: true, value: [CTRM_ARCH] });
    loadOntologyMock.mockResolvedValue({ ok: true, value: ONTOLOGY });
    loadEvidenceRegistryMock.mockResolvedValue({ ok: true, value: REGISTRY });

    const result = await handleCallTool(
      makeRequest("score", {
        jd_text: "We need a CTRM architect with trading and architecture expertise in Amsterdam.",
      }),
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(textOf(result)) as { archetype: string | null };
    expect(parsed.archetype).toBe("ctrm-enterprise-architect");
  });

  it("error path: a thrown error containing an absolute path is redacted, isError true, no path leaks", async () => {
    process.env["SELFWRIGHT_DATA_DIR"] = "C:\\fake\\data";
    loadArchetypesMock.mockRejectedValue(
      new Error("ENOENT: no such file or directory, open 'C:\\fake\\data\\archetypes.yml'"),
    );

    const result = await handleCallTool(makeRequest("score", { jd_text: "anything" }));

    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).not.toContain("C:\\fake\\data");
    expect(text).toContain("<path>");
  });

  it("unknown tool name returns isError true with a generic message", async () => {
    const result = await handleCallTool(makeRequest("not_a_real_tool"));
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Unknown tool");
  });

  it("missing SELFWRIGHT_DATA_DIR surfaces as a caught, non-crashing error", async () => {
    delete process.env["SELFWRIGHT_DATA_DIR"];
    const result = await handleCallTool(makeRequest("score", { jd_text: "anything" }));
    expect(result.isError).toBe(true);
  });
});

// ── path-traversal containment guard (appDir) ───────────────────────────────
// prep_pack/check_prep_pack/topics accept a caller-supplied appDir and read
// fixed filenames from it — resolveWithinDataDir (index.ts) must reject an
// appDir that resolves outside SELFWRIGHT_DATA_DIR before any file is read.

describe("path-traversal containment guard (appDir)", () => {
  const originalDataDir = process.env["SELFWRIGHT_DATA_DIR"];
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "sw-mcp-containment-"));
    process.env["SELFWRIGHT_DATA_DIR"] = dataDir;
    loadArchetypesMock.mockReset();
    loadOntologyMock.mockReset();
    loadEvidenceRegistryMock.mockReset();
    loadIdentityMock.mockReset();
    loadGapsMock.mockReset();
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env["SELFWRIGHT_DATA_DIR"];
    else process.env["SELFWRIGHT_DATA_DIR"] = originalDataDir;
  });

  it("prep_pack rejects an appDir that escapes the data dir via ../", async () => {
    const result = await handleCallTool(
      makeRequest("prep_pack", { appDir: join(dataDir, "..", "outside") }),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("escapes the sanctioned data directory");
  });

  it("check_prep_pack rejects an appDir that is an absolute path elsewhere on disk", async () => {
    const outside = mkdtempSync(join(tmpdir(), "sw-mcp-outside-"));
    try {
      const result = await handleCallTool(makeRequest("check_prep_pack", { appDir: outside }));
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("escapes the sanctioned data directory");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("topics (application mode) rejects an appDir that escapes the data dir", async () => {
    loadIdentityMock.mockResolvedValue({ ok: true, value: {} });
    loadEvidenceRegistryMock.mockResolvedValue({ ok: true, value: [] });
    loadOntologyMock.mockResolvedValue({ ok: true, value: {} });
    loadGapsMock.mockResolvedValue({ ok: true, value: [] });

    const result = await handleCallTool(
      makeRequest("topics", { appDir: join(dataDir, "..", "outside") }),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("escapes the sanctioned data directory");
  });
});
