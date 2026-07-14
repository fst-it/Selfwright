// Split from the config schema (models.ts) so a browser bundle that only
// needs a pure config *schema* (e.g. apps/web-ui, via @selfwright/api-contract)
// never pulls in node:fs through this loader (T5.10 — see settings-loader.ts
// for the fuller rationale, which applies identically here).
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { ModelsConfigSchema, type ModelsConfig } from "./models.js";
import { toMessage } from "./shared.js";

/**
 * Read and validate config/models.yml (logical role → Claude-model hint map).
 * Consumed by the optional ClaudeCliAdapter and by skills/docs — never by the
 * default composition path (D-1: co-piloted generation is the default; no
 * gateway is instantiated unless an adapter opts in).
 */
export function loadModelsConfig(path: string): ModelsConfig {
  try {
    const text = readFileSync(path, "utf-8");
    const raw: unknown = parse(text, { version: "1.2" });
    return ModelsConfigSchema.parse(raw);
  } catch (e) {
    throw new Error(`Failed to load models config from ${path}: ${toMessage(e)}`);
  }
}
