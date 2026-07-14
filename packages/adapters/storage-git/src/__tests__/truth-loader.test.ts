import { describe, it, expect, beforeAll } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { TruthLoader } from "../truth-loader.js";

const FIXTURES_DIR = join(fileURLToPath(import.meta.url), "../fixtures");

function makeLoader(): TruthLoader {
  return new TruthLoader(FIXTURES_DIR);
}

describe("TruthLoader — constructor", () => {
  it("throws when SELFWRIGHT_DATA_DIR is unset and no arg is passed", () => {
    const saved = process.env["SELFWRIGHT_DATA_DIR"];
    delete process.env["SELFWRIGHT_DATA_DIR"];
    expect(() => new TruthLoader()).toThrow("SELFWRIGHT_DATA_DIR");
    if (saved !== undefined) process.env["SELFWRIGHT_DATA_DIR"] = saved;
  });

  it("uses the dataDir argument when provided", () => {
    expect(() => makeLoader()).not.toThrow();
  });

  it("uses SELFWRIGHT_DATA_DIR env var when no arg is passed", () => {
    const saved = process.env["SELFWRIGHT_DATA_DIR"];
    process.env["SELFWRIGHT_DATA_DIR"] = FIXTURES_DIR;
    expect(() => new TruthLoader()).not.toThrow();
    if (saved !== undefined) {
      process.env["SELFWRIGHT_DATA_DIR"] = saved;
    } else {
      delete process.env["SELFWRIGHT_DATA_DIR"];
    }
  });
});

describe("TruthLoader.loadIdentity()", () => {
  it("loads and validates the fixture identity", async () => {
    const result = await makeLoader().loadIdentity();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("Alex Rivera");
    expect(result.value.years_experience).toBe(17);
    expect(result.value.contact.email).toBe("contact-omitted-in-fixture");
  });

  it("returns FILE_NOT_FOUND for missing file", async () => {
    const loader = new TruthLoader("/nonexistent/path");
    const result = await loader.loadIdentity();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("FILE_NOT_FOUND");
  });
});

describe("TruthLoader.loadEvidenceRegistry()", () => {
  it("loads and validates all fixture evidence entries", async () => {
    const result = await makeLoader().loadEvidenceRegistry();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThan(0);
  });

  it("contains entries with both scalar and map tags", async () => {
    const result = await makeLoader().loadEvidenceRegistry();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tags = result.value.map((e) => e.tag);
    const hasScalar = tags.some((t) => typeof t === "string");
    const hasMap = tags.some((t) => typeof t === "object");
    expect(hasScalar).toBe(true);
    expect(hasMap).toBe(true);
  });

  it("includes an entry with no detail field", async () => {
    const result = await makeLoader().loadEvidenceRegistry();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const noDetail = result.value.find((e) => e.detail === undefined);
    expect(noDetail).toBeDefined();
  });

  it("returns VALIDATION_ERROR for unknown fields (strict mode)", async () => {
    const loader = new TruthLoader(
      join(fileURLToPath(import.meta.url), "../../fixtures-bad"),
    );
    const result = await loader.loadEvidenceRegistry();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(["FILE_NOT_FOUND", "VALIDATION_ERROR", "PARSE_ERROR"]).toContain(
      result.error.kind,
    );
  });
});

describe("TruthLoader.loadCompFloors()", () => {
  it("loads and validates fixture comp floors", async () => {
    const result = await makeLoader().loadCompFloors();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cities.length).toBeGreaterThanOrEqual(1);
    expect(result.value.meta.amsterdam_discretionary_baseline_eur).toBe(160000);
  });

  it("validates all city entries have required fields", async () => {
    const result = await makeLoader().loadCompFloors();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const city of result.value.cities) {
      expect(city.city).toBeTruthy();
      expect(city.floor_a_eur).toBeGreaterThan(0);
    }
  });
});

describe("TruthLoader.loadOntology()", () => {
  it("loads the fixture ontology", async () => {
    const result = await makeLoader().loadOntology();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value["data platform"]).toBeDefined();
    expect(Array.isArray(result.value["data platform"])).toBe(true);
  });

  it("accepts null values for placeholder keys", async () => {
    const result = await makeLoader().loadOntology();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value["tbd"]).toBeNull();
  });

  it("when missing, names the file and its role rather than a bare 'not found'", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "sw-truth-loader-empty-"));
    try {
      const result = await new TruthLoader(emptyDir).loadOntology();
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("FILE_NOT_FOUND");
      expect(result.error.message).toContain("truth/keyword-ontology.yml");
      expect(result.error.message).toContain("score/gap-scan/inbox --archetype/scan");
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

describe("TruthLoader.loadArchetypes()", () => {
  it("loads fixture archetypes from markdown front-matter", async () => {
    const result = await makeLoader().loadArchetypes();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThan(0);
    const archetype = result.value[0];
    expect(archetype?.id).toBe("ctrm-enterprise-architect");
    expect(archetype?.related_titles.length).toBeGreaterThan(0);
  });

  it("returns empty array when archetypes dir does not exist", async () => {
    const loader = new TruthLoader("/nonexistent/path");
    const result = await loader.loadArchetypes();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });
});

describe("TruthLoader.loadDrifts()", () => {
  it("loads all drift entries from fixture companies", async () => {
    const result = await makeLoader().loadDrifts();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThan(0);
    const entry = result.value[0];
    expect(entry?.id).toMatch(/^DRIFT-/);
    expect(entry?.status).toBe("active");
  });

  it("loads drifts for a specific slug", async () => {
    const result = await makeLoader().loadDrifts("fixture-company");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(1);
  });

  it("returns empty array for unknown slug", async () => {
    const result = await makeLoader().loadDrifts("nonexistent");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("returns empty array when drifts dir does not exist", async () => {
    const loader = new TruthLoader("/nonexistent/path");
    const result = await loader.loadDrifts();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("drift entries include deviates_from with valid EVD-* ids", async () => {
    const result = await makeLoader().loadDrifts();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const entry of result.value) {
      expect(entry.deviates_from.evidence_ids.length).toBeGreaterThan(0);
      for (const id of entry.deviates_from.evidence_ids) {
        expect(id).toMatch(/^EVD-/);
      }
    }
  });
});

describe("TruthLoader.loadDriftIndex()", () => {
  it("loads the drift index", async () => {
    const result = await makeLoader().loadDriftIndex();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.rubric_version).toBe("v1");
    expect(result.value?.companies.length).toBeGreaterThan(0);
  });

  it("returns undefined when index file does not exist", async () => {
    const loader = new TruthLoader("/nonexistent/path");
    const result = await loader.loadDriftIndex();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeUndefined();
  });
});

describe("TruthLoader.loadGaps()", () => {
  it("loads and validates fixture gaps", async () => {
    const result = await makeLoader().loadGaps();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThan(0);
    const gap = result.value[0];
    expect(gap?.id).toMatch(/^GAP-/);
    expect(gap?.title).toBeTruthy();
  });

  it("returns ok([]) when gaps.yml does not exist", async () => {
    const loader = new TruthLoader("/nonexistent/path");
    const result = await loader.loadGaps();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });
});

describe("TruthLoader.assertGapsFileExists()", () => {
  it("returns ok(true) when gaps-and-risks.md exists and is non-empty", async () => {
    const result = await makeLoader().assertGapsFileExists();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(true);
  });

  it("returns FILE_NOT_FOUND when file is absent", async () => {
    const loader = new TruthLoader("/nonexistent/path");
    const result = await loader.assertGapsFileExists();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("FILE_NOT_FOUND");
  });
});

const EDGE_DIR = join(fileURLToPath(import.meta.url), "../fixtures-edge");

describe("TruthLoader — error paths (edge fixtures)", () => {
  it("loadIdentity() returns PARSE_ERROR for malformed YAML", async () => {
    const loader = new TruthLoader(EDGE_DIR);
    const result = await loader.loadIdentity();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("PARSE_ERROR");
    expect(result.error.path).toBe("truth/identity.yml");
  });

  it("loadEvidenceRegistry() returns VALIDATION_ERROR for unknown field (strict schema)", async () => {
    const loader = new TruthLoader(EDGE_DIR);
    const result = await loader.loadEvidenceRegistry();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("VALIDATION_ERROR");
  });

  it("loadArchetypes() returns PARSE_ERROR for bad front-matter YAML", async () => {
    const loader = new TruthLoader(EDGE_DIR);
    const result = await loader.loadArchetypes();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(["PARSE_ERROR", "VALIDATION_ERROR"]).toContain(result.error.kind);
  });

  it("loadDrifts() returns VALIDATION_ERROR for invalid ledger schema", async () => {
    const loader = new TruthLoader(EDGE_DIR);
    const result = await loader.loadDrifts();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("VALIDATION_ERROR");
  });

  it("loadGaps() returns VALIDATION_ERROR for schema-invalid content", async () => {
    const loader = new TruthLoader(EDGE_DIR);
    const result = await loader.loadGaps();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("VALIDATION_ERROR");
  });

  it("assertGapsFileExists() returns VALIDATION_ERROR for whitespace-only file", async () => {
    const loader = new TruthLoader(EDGE_DIR);
    const result = await loader.assertGapsFileExists();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("VALIDATION_ERROR");
    expect(result.error.message).toContain("empty");
  });
});

describe("TruthLoader — round-trip validation (real Selfwright-data)", () => {
  const DATA_DIR = process.env["SELFWRIGHT_DATA_DIR"];

  const describe_if = DATA_DIR ? describe : describe.skip;

  describe_if("when SELFWRIGHT_DATA_DIR is set", () => {
    let loader: TruthLoader;

    beforeAll(() => {
      if (!DATA_DIR) throw new Error("unreachable");
      loader = new TruthLoader(DATA_DIR);
    });

    it("loadIdentity() validates the real identity.yml", async () => {
      const result = await loader.loadIdentity();
      if (!result.ok) {
        throw new Error(`loadIdentity failed: ${result.error.message}`);
      }
      expect(result.value.years_experience).toBeGreaterThan(0);
    });

    it("loadEvidenceRegistry() validates every EVD-* entry", async () => {
      const result = await loader.loadEvidenceRegistry();
      if (!result.ok) {
        throw new Error(`loadEvidenceRegistry failed: ${result.error.message}`);
      }
      expect(result.value.length).toBeGreaterThan(0);
    });

    it("loadCompFloors() validates the real comp-floors.data.yml", async () => {
      const result = await loader.loadCompFloors();
      if (!result.ok) {
        throw new Error(`loadCompFloors failed: ${result.error.message}`);
      }
      expect(result.value.cities.length).toBeGreaterThan(0);
    });

    it("loadOntology() validates the real keyword-ontology.yml", async () => {
      const result = await loader.loadOntology();
      if (!result.ok) {
        throw new Error(`loadOntology failed: ${result.error.message}`);
      }
      expect(Object.keys(result.value).length).toBeGreaterThan(0);
    });

    it("loadDrifts() validates all real drift ledgers", async () => {
      const result = await loader.loadDrifts();
      if (!result.ok) {
        throw new Error(`loadDrifts failed: ${result.error.message}`);
      }
    });

    it("loadDriftIndex() validates the real drift index", async () => {
      const result = await loader.loadDriftIndex();
      if (!result.ok) {
        throw new Error(`loadDriftIndex failed: ${result.error.message}`);
      }
    });

    it("assertGapsFileExists() confirms gaps-and-risks.md", async () => {
      const result = await loader.assertGapsFileExists();
      if (!result.ok) {
        throw new Error(`assertGapsFileExists failed: ${result.error.message}`);
      }
      expect(result.value).toBe(true);
    });
  });
});
