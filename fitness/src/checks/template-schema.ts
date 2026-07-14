// FF-TEMPLATE-1: every file examples/data-template/ ships must validate against the
// same schema the framework's real loaders enforce for a user's own data dir.
// Tier 1 (no SELFWRIGHT_DATA_DIR required) — the template ships in the framework repo
// itself, so this check has no dependency on private data.
//
// Root cause this guards against: the documented `--init-template` + `SELFWRIGHT_DATA_DIR`
// + `pnpm fitness` quick-start flow failed FF-TRUTH-1b/4/5b on a fresh install because
// examples/data-template/truth/identity.yml shipped `phone`/`email` commented out while
// ContactSchema requires non-empty strings — and nothing gated the template against schema
// drift, so the break was silent until a real fresh-install E2E hit it. This check closes
// that gap: it fails, naming the file and the Zod error, the moment any template file
// stops matching its schema.
//
// Two of the nine files below (pipeline/scan-targets.yml, positioning/scoring-vocabulary.yml)
// have production loaders (parseScanTargets, loadScoringVocabularyFile) that intentionally
// swallow schema errors and fall back to a safe default (the framework's own
// never-crash/degrade-gracefully convention). That fallback is correct product behavior but
// would make this check useless as a drift gate, so this check validates those two — and
// applications.yml, which has no dedicated schema-validating loader at all — directly
// against the real Zod schema instead of going through the swallowing loader.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontMatter, parseYaml } from "@selfwright/adapter-storage-git";
import {
  ArchetypeSchema,
  CompFloorsSchema,
  EvidenceRegistrySchema,
  GapsFileSchema,
  IdentitySchema,
  OntologySchema,
  ScoringVocabularySchema,
} from "@selfwright/core";
import { ApplicationRecordSchema } from "@selfwright/api-contract";
import { ScanTargetsConfigSchema } from "@selfwright/shared-config";
import { z } from "zod";
import type { CheckResult } from "./shared.js";

const CHECK_NAME =
  "FF-TEMPLATE-1: template-schema — examples/data-template validates against every schema it ships";

const ApplicationsFileSchema = z.array(ApplicationRecordSchema);

interface TemplateFileSpec {
  readonly relPath: string;
  readonly schema: { parse: (v: unknown) => unknown };
}

const TEMPLATE_FILES: readonly TemplateFileSpec[] = [
  { relPath: "truth/identity.yml", schema: IdentitySchema },
  { relPath: "truth/evidence/registry.yml", schema: EvidenceRegistrySchema },
  { relPath: "truth/gaps.yml", schema: GapsFileSchema },
  { relPath: "truth/keyword-ontology.yml", schema: OntologySchema },
  { relPath: "truth/comp-floors.data.yml", schema: CompFloorsSchema },
  { relPath: "applications/applications.yml", schema: ApplicationsFileSchema },
  { relPath: "pipeline/scan-targets.yml", schema: ScanTargetsConfigSchema },
  { relPath: "positioning/scoring-vocabulary.yml", schema: ScoringVocabularySchema },
];

export function checkTemplateSchema(repoRoot: string): CheckResult {
  const templateDir = join(repoRoot, "examples", "data-template");
  const violations: string[] = [];

  for (const file of TEMPLATE_FILES) {
    const absPath = join(templateDir, file.relPath);
    if (!existsSync(absPath)) {
      violations.push(`${file.relPath}: file not found in examples/data-template`);
      continue;
    }
    try {
      const text = readFileSync(absPath, "utf-8");
      file.schema.parse(parseYaml(text));
    } catch (e) {
      violations.push(`${file.relPath}: ${toMessage(e)}`);
    }
  }

  // Archetypes: at least one *.md file with valid front-matter, same shape TruthLoader parses.
  const archetypesDir = join(templateDir, "truth", "archetypes");
  let archetypeFiles: string[] = [];
  try {
    archetypeFiles = readdirSync(archetypesDir).filter((f) => f.endsWith(".md"));
  } catch (e) {
    violations.push(`truth/archetypes/: directory not found in examples/data-template (${toMessage(e)})`);
  }
  if (existsSync(archetypesDir) && archetypeFiles.length === 0) {
    violations.push("truth/archetypes/: no archetype .md files found in examples/data-template");
  }
  for (const file of archetypeFiles) {
    const relPath = `truth/archetypes/${file}`;
    try {
      const text = readFileSync(join(archetypesDir, file), "utf-8");
      ArchetypeSchema.parse(parseFrontMatter(text));
    } catch (e) {
      violations.push(`${relPath}: ${toMessage(e)}`);
    }
  }

  if (violations.length > 0) {
    return { name: CHECK_NAME, passed: false, details: violations.join("\n") };
  }
  return { name: CHECK_NAME, passed: true };
}

function toMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
