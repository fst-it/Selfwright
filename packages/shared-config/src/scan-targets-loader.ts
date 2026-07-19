// Split from the config schema (scan-targets.ts) — see settings-loader.ts for
// the rationale (T5.10: keep node:fs out of any browser bundle that only
// needs the pure schema).
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { ScanTargetsConfigSchema, type ScanTargetsConfig } from "./scan-targets.js";
import { toMessage } from "./shared.js";

/**
 * Read and validate config/scan-targets.yml (T2.3 scanner: the list of
 * companies/providers to scan). Consumed by the CLI/MCP `scan` command —
 * never by core (core has no I/O; the scanner's pure logic lives in
 * packages/core/src/scanning/, this is just the config-file reader).
 */
export function loadScanTargets(path: string): ScanTargetsConfig {
  try {
    const text = readFileSync(path, "utf-8");
    const raw: unknown = parse(text, { version: "1.2" });
    return ScanTargetsConfigSchema.parse(raw);
  } catch (e) {
    throw new Error(`Failed to load scan targets config from ${path}: ${toMessage(e)}`);
  }
}
