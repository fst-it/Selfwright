import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  ArchetypeSchema,
  CompFloorsSchema,
  DriftIndexSchema,
  DriftLedgerSchema,
  EvidenceRegistrySchema,
  GapsFileSchema,
  IdentitySchema,
  OntologySchema,
  err,
  ok,
} from "@selfwright/core";
import type {
  Archetype,
  CompFloors,
  DriftEntry,
  DriftIndex,
  EvidenceEntry,
  Gap,
  Identity,
  Ontology,
  Result,
  TruthError,
  TruthPort,
} from "@selfwright/core";
import { parseFrontMatter, parseYaml } from "./yaml.js";

export class TruthLoader implements TruthPort {
  private readonly dataDir: string;

  constructor(dataDir?: string) {
    const dir = dataDir ?? process.env["SELFWRIGHT_DATA_DIR"];
    if (!dir) throw new Error("SELFWRIGHT_DATA_DIR environment variable is not set");
    this.dataDir = dir;
  }

  private resolve(...segments: string[]): string {
    return join(this.dataDir, ...segments);
  }

  private async readText(relPath: string): Promise<Result<string, TruthError>> {
    const absPath = this.resolve(relPath);
    try {
      return ok(await readFile(absPath, "utf-8"));
    } catch (e) {
      if (isNodeEnoent(e)) {
        return err({ kind: "FILE_NOT_FOUND", message: `Not found: ${relPath}`, path: relPath });
      }
      return err({ kind: "PARSE_ERROR", message: toMessage(e), path: relPath });
    }
  }

  private parseAndValidate<T>(
    source: string,
    relPath: string,
    schema: { parse: (v: unknown) => T },
    mode: "yaml" | "front-matter" = "yaml",
  ): Result<T, TruthError> {
    let parsed: unknown;
    try {
      parsed = mode === "front-matter" ? parseFrontMatter(source) : parseYaml(source);
    } catch (e) {
      return err({ kind: "PARSE_ERROR", message: toMessage(e), path: relPath });
    }
    try {
      return ok(schema.parse(parsed));
    } catch (e) {
      return err({
        kind: "VALIDATION_ERROR",
        message: `${relPath}: ${toMessage(e)}`,
        path: relPath,
      });
    }
  }

  async loadIdentity(): Promise<Result<Identity, TruthError>> {
    const relPath = "truth/identity.yml";
    const text = await this.readText(relPath);
    if (!text.ok) return text;
    return this.parseAndValidate(text.value, relPath, IdentitySchema);
  }

  async loadEvidenceRegistry(): Promise<Result<EvidenceEntry[], TruthError>> {
    const relPath = "truth/evidence/registry.yml";
    const text = await this.readText(relPath);
    if (!text.ok) return text;
    return this.parseAndValidate(text.value, relPath, EvidenceRegistrySchema);
  }

  async loadCompFloors(): Promise<Result<CompFloors, TruthError>> {
    const relPath = "truth/comp-floors.data.yml";
    const text = await this.readText(relPath);
    if (!text.ok) return text;
    return this.parseAndValidate(text.value, relPath, CompFloorsSchema);
  }

  async loadOntology(): Promise<Result<Ontology, TruthError>> {
    const relPath = "truth/keyword-ontology.yml";
    const text = await this.readText(relPath);
    if (!text.ok) {
      if (text.error.kind === "FILE_NOT_FOUND") {
        return err({
          kind: "FILE_NOT_FOUND",
          message:
            `Not found: ${relPath} — this is the domain-keyword taxonomy required by ` +
            `score/gap-scan/inbox --archetype/scan. It is not optional enrichment; see ` +
            `docs/data-storage-and-backup.md for the minimal data-dir file set.`,
          path: relPath,
        });
      }
      return text;
    }
    return this.parseAndValidate(text.value, relPath, OntologySchema);
  }

  async loadArchetypes(): Promise<Result<Archetype[], TruthError>> {
    const dir = this.resolve("truth/archetypes");
    let files: string[];
    try {
      const entries = await readdir(dir);
      files = entries.filter((f) => f.endsWith(".md"));
    } catch {
      return ok([]);
    }

    const archetypes: Archetype[] = [];
    for (const file of files) {
      const relPath = `truth/archetypes/${file}`;
      const text = await this.readText(relPath);
      if (!text.ok) return text;
      const result = this.parseAndValidate(text.value, relPath, ArchetypeSchema, "front-matter");
      if (!result.ok) return result;
      archetypes.push(result.value);
    }
    return ok(archetypes);
  }

  async loadDrifts(slug?: string): Promise<Result<DriftEntry[], TruthError>> {
    const companiesDir = this.resolve("drifts/companies");
    let files: string[];
    try {
      const entries = await readdir(companiesDir);
      const yamlFiles = entries.filter((f) => f.endsWith(".yml"));
      files =
        slug !== undefined
          ? yamlFiles.filter((f) => f === `${slug}.yml`)
          : yamlFiles;
    } catch {
      return ok([]);
    }

    const all: DriftEntry[] = [];
    for (const file of files) {
      const relPath = `drifts/companies/${file}`;
      const text = await this.readText(relPath);
      if (!text.ok) return text;
      const result = this.parseAndValidate(text.value, relPath, DriftLedgerSchema);
      if (!result.ok) return result;
      all.push(...result.value.drifts);
    }
    return ok(all);
  }

  async loadDriftIndex(): Promise<Result<DriftIndex | undefined, TruthError>> {
    const relPath = "drifts/index.yml";
    const text = await this.readText(relPath);
    if (!text.ok) {
      if (text.error.kind === "FILE_NOT_FOUND") return ok(undefined);
      return text;
    }
    return this.parseAndValidate(text.value, relPath, DriftIndexSchema);
  }

  async loadGaps(): Promise<Result<Gap[], TruthError>> {
    const relPath = "truth/gaps.yml";
    const text = await this.readText(relPath);
    if (!text.ok) {
      if (text.error.kind === "FILE_NOT_FOUND") return ok([]);
      return text;
    }
    return this.parseAndValidate(text.value, relPath, GapsFileSchema);
  }

  async assertGapsFileExists(): Promise<Result<true, TruthError>> {
    const relPath = "truth/gaps-and-risks.md";
    const absPath = this.resolve(relPath);
    try {
      await access(absPath);
      const content = await readFile(absPath, "utf-8");
      if (content.trim().length === 0) {
        return err({
          kind: "VALIDATION_ERROR",
          message: `${relPath} exists but is empty`,
          path: relPath,
        });
      }
      return ok(true);
    } catch {
      return err({ kind: "FILE_NOT_FOUND", message: `Not found: ${relPath}`, path: relPath });
    }
  }
}

function isNodeEnoent(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  return (e as Record<string, unknown>)["code"] === "ENOENT";
}

function toMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
