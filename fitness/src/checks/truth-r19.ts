import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { EvidenceRegistrySchema, IdentitySchema } from "@selfwright/core/truth/schemas";
import { guardSummary } from "@selfwright/core/truth/r19-guard";
import type { EvidenceEntry, Identity } from "@selfwright/core";
import type { CheckResult } from "./shared.js";

const CHECK_NAME_SYNTHETIC = "FF-TRUTH-5a: truth-r19 — synthetic fixture always runs in CI";
const CHECK_NAME_PRODUCTION = "FF-TRUTH-5b: truth-r19 — summary grounded in production registry";

// ── Synthetic fixtures (CI-safe — no private data required) ───────────────────

const SYNTHETIC_REGISTRY: EvidenceEntry[] = [
  {
    id: "EVD-SYN-FF5-001",
    org: "SyntheticCo",
    claim: "Led data platform migration to cloud infrastructure with streaming pipelines",
    tag: "hard",
    keywords: ["data", "platform", "cloud", "streaming", "pipelines", "migration"],
  },
  {
    id: "EVD-SYN-FF5-002",
    org: "SyntheticCo",
    claim: "Defined enterprise architecture strategy for trading and risk systems",
    tag: "hard",
    keywords: ["enterprise", "architecture", "strategy", "trading", "risk", "systems"],
  },
];

const SYNTHETIC_IDENTITY: Identity = {
  name: "Synthetic User",
  canonical_title: "Enterprise Architect",
  years_experience: 10,
  headline: "Enterprise Architect at SyntheticCo",
  seniority_equivalence: "Senior",
  headline_policy: "None",
  also_known_as_titles: [],
  cv_generation_rules: [],
  education: [],
  contact: { location: "Amsterdam", phone: "555-0100", email: "synth@localhost", linkedin: "https://linkedin.com/in/synthetic" },
  citizenship: "EU",
  relocation: [],
  languages: {},
  certifications: [],
  team_sizes: {},
  roles_timeline: [
    { company: "SyntheticCo", title: "Enterprise Architect", period: "2020–present" },
  ],
  honesty_boundaries: [],
  calibration: "None",
};

// Must be grounded: every sentence overlaps with synthetic registry or identity
const SYNTHETIC_FIXTURE_SUMMARY = [
  "Led data platform migration with cloud streaming pipelines at SyntheticCo.",
  "Defined enterprise architecture strategy for trading and risk systems.",
].join(" ");

// Must NOT be grounded: no overlap with any synthetic entry or identity role
const ADVERSARIAL_SUMMARY =
  "Invented perpetual motion machines and pioneered quantum teleportation during tenure as CEO of SpaceX.";

export function checkTruthR19Synthetic(): CheckResult {
  // Positive: grounded summary must pass
  const positiveResult = guardSummary(SYNTHETIC_FIXTURE_SUMMARY, SYNTHETIC_IDENTITY, SYNTHETIC_REGISTRY);
  if (!positiveResult.ok) {
    return {
      name: CHECK_NAME_SYNTHETIC,
      passed: false,
      details: `Synthetic grounded summary flagged as ungrounded — check algorithm regression:\n${positiveResult.ungrounded.join("\n")}`,
    };
  }

  // Adversarial: fabricated summary must be flagged
  const adversarialResult = guardSummary(ADVERSARIAL_SUMMARY, SYNTHETIC_IDENTITY, SYNTHETIC_REGISTRY);
  if (adversarialResult.ok) {
    return {
      name: CHECK_NAME_SYNTHETIC,
      passed: false,
      details:
        "Adversarial summary passed guardSummary when it should have been flagged — truth-r19 is not catching fabricated claims",
    };
  }

  return { name: CHECK_NAME_SYNTHETIC, passed: true };
}

export function checkTruthR19Production(dataDir: string): CheckResult {
  const registryPath = join(dataDir, "truth/evidence/registry.yml");
  const identityPath = join(dataDir, "truth/identity.yml");

  if (!existsSync(registryPath)) {
    return {
      name: CHECK_NAME_PRODUCTION,
      passed: true,
      skipped: true,
      details: "SELFWRIGHT_DATA_DIR not configured — skipped (run locally with private data)",
    };
  }

  let registry;
  let identity;
  try {
    registry = EvidenceRegistrySchema.parse(parse(readFileSync(registryPath, "utf-8")));
    identity = IdentitySchema.parse(parse(readFileSync(identityPath, "utf-8")));
  } catch (err) {
    return {
      name: CHECK_NAME_PRODUCTION,
      passed: false,
      details: `Failed to load truth files: ${String(err)}`,
    };
  }

  // Run adversarial fixture against production registry: must still be flagged
  const adversarialResult = guardSummary(ADVERSARIAL_SUMMARY, identity, registry);
  if (adversarialResult.ok) {
    return {
      name: CHECK_NAME_PRODUCTION,
      passed: false,
      details:
        "Adversarial summary passed guardSummary against production registry — truth-r19 is not catching fabricated claims in production data",
    };
  }

  return { name: CHECK_NAME_PRODUCTION, passed: true };
}
