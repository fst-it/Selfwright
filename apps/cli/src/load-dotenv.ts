/**
 * Dependency-free .env loader.
 *
 * Reads a `.env` file from the given directory (default: process.cwd()) and
 * populates process.env for keys that are NOT already set.  Explicit env vars
 * always win — this is standard dotenv no-override semantics.
 *
 * If the file does not exist the function silently does nothing, so it is safe
 * to call in any environment (CI, fresh clone before setup, etc.).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Parse a .env file string into a key→value map.
 *
 * Rules:
 * - Blank lines are ignored.
 * - Lines whose first non-whitespace character is `#` are ignored (comments).
 * - Lines must contain `=`; anything without `=` is silently skipped.
 * - Keys and values are trimmed of leading/trailing whitespace.
 * - Surrounding single or double quotes on values are stripped (one layer).
 * - No variable expansion, no shell substitution, no multiline values.
 */
export function parseDotEnv(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    if (key === "") continue;
    let value = line.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/**
 * Load `<dir>/.env` and set any missing keys in process.env.
 * Keys already present in process.env are never overwritten.
 * If the file is absent, does nothing.
 */
export function loadDotEnv(dir: string = process.cwd()): void {
  const envPath = join(dir, ".env");
  let text: string;
  try {
    text = readFileSync(envPath, "utf-8");
  } catch {
    return; // File absent — silent no-op
  }
  const pairs = parseDotEnv(text);
  for (const [k, v] of Object.entries(pairs)) {
    process.env[k] ??= v;
  }
}
