import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { IdentitySchema } from "@selfwright/core/truth/schemas";
import type { CheckResult } from "./shared.js";

const CHECK_NAME = "FF-TRUTH-4: truth-identity — application facts consistent with identity.yml";

const RoleTimelineEntrySchema = IdentitySchema.shape.roles_timeline.element;

interface ApplicationYaml {
  company?: string;
  title?: string;
  period?: string;
}

export function checkTruthIdentity(dataDir: string): CheckResult {
  const identityPath = join(dataDir, "truth/identity.yml");
  if (!existsSync(identityPath)) {
    return {
      name: CHECK_NAME,
      passed: true,
      skipped: true,
      details: "SELFWRIGHT_DATA_DIR not configured — skipped (run locally with private data)",
    };
  }

  let identity;
  try {
    const raw = readFileSync(identityPath, "utf-8");
    identity = IdentitySchema.parse(parse(raw));
  } catch (err) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `Failed to load identity.yml: ${String(err)}`,
    };
  }

  const appsDir = join(dataDir, "applications");
  let appFiles: string[] = [];
  try {
    appFiles = readdirSync(appsDir).filter(
      (f) => (f.endsWith(".yml") || f.endsWith(".yaml")) && f !== "README.md",
    );
  } catch {
    // No applications directory or empty — pass gracefully
    return { name: CHECK_NAME, passed: true };
  }

  if (appFiles.length === 0) {
    return { name: CHECK_NAME, passed: true };
  }

  const roleSet = new Set(
    identity.roles_timeline.map((r) => `${r.company}|${r.title}`),
  );

  const violations: string[] = [];

  for (const file of appFiles) {
    let doc: ApplicationYaml;
    try {
      const raw = readFileSync(join(appsDir, file), "utf-8");
      doc = parse(raw) as ApplicationYaml;
    } catch {
      continue;
    }

    // If the application specifies a company+title, it must appear in identity.roles_timeline
    if (doc.company && doc.title) {
      const key = `${doc.company}|${doc.title}`;
      if (!roleSet.has(key)) {
        // Validate via schema to produce a useful error
        const parsed = RoleTimelineEntrySchema.safeParse({
          company: doc.company,
          title: doc.title,
          period: doc.period ?? "unknown",
        });
        if (!parsed.success || !roleSet.has(key)) {
          violations.push(
            `${file}: company/title "${doc.company} / ${doc.title}" not in identity.yml roles_timeline`,
          );
        }
      }
    }
  }

  if (violations.length > 0) {
    return {
      name: CHECK_NAME,
      passed: false,
      details: violations.join("\n"),
    };
  }
  return { name: CHECK_NAME, passed: true };
}
