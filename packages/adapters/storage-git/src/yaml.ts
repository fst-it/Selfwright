import { parse } from "yaml";

/**
 * Parse a YAML string and return the deserialized value.
 * Throws `SyntaxError` on malformed input (the `yaml` package's native error type).
 *
 * The `yaml` package (eemeli) is YAML 1.2-conformant and comment-preserving — see ADR 0003.
 * We intentionally do NOT convert Date/timestamp strings to JavaScript Date objects here;
 * all date-like strings remain as raw strings for Zod schemas to validate downstream.
 */
// Parameter is `unknown`, not `string`: every real caller reads a string off disk, but the
// "null-YAML-row" class (ADR 0017 FF-INPUT) means a caller can hand this a parsed-but-wrong
// value from elsewhere. The `yaml` package dereferences its argument internally (e.g.
// `.length`) without a type check, so a non-string input would otherwise throw a raw,
// unhelpful TypeError from deep inside the dependency — reject with a clear, typed error
// at this boundary instead.
export function parseYaml(source: unknown): unknown {
  if (typeof source !== "string") {
    throw new TypeError(
      `parseYaml: expected a string, got ${source === null ? "null" : typeof source}`,
    );
  }
  return parse(source, { version: "1.2" });
}

/** Extract and parse the YAML front-matter block from a Markdown file. */
export function parseFrontMatter(markdown: unknown): unknown {
  if (typeof markdown !== "string") {
    throw new TypeError(
      `parseFrontMatter: expected a string, got ${markdown === null ? "null" : typeof markdown}`,
    );
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---/m.exec(markdown);
  if (!match) {
    throw new SyntaxError("No YAML front-matter block found in markdown source");
  }
  return parseYaml(match[1] ?? "");
}
