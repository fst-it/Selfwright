// Identifier tokenization (ADR 0017 §1 addendum), extracted from named-entity-scan.ts so
// machine-identity.ts (Phase 5 T5.1) can reuse the same sub-token machinery without creating
// a circular import between the two scanner modules (named-entity-scan.ts imports from this
// module too, and re-exports it for backward compatibility with existing callers/tests).
//
// The plain \b-word-boundary regex used elsewhere is blind to a confidential name/machine
// identifier embedded inside a programming identifier: `_` is a \w character, so there is no
// boundary between a name and a trailing "_specific" suffix in a snake_case identifier, and a
// lowercase-to-uppercase transition (as in camelCase) produces no boundary at all. This closes
// that gap: extract every identifier-shaped run from the content, split each on underscore/
// hyphen, camelCase transitions, and digit boundaries, and compare the resulting sub-tokens
// (case-insensitively) against patterns.
const IDENTIFIER_RUN_PATTERN = /[A-Za-z][A-Za-z0-9_-]*/g;

function tokenizeIdentifierRun(run: string): Set<string> {
  const out = new Set<string>();
  for (const piece of run.split(/[_-]+/).filter(Boolean)) {
    const spaced = piece
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/([A-Za-z])([0-9])/g, "$1 $2")
      .replace(/([0-9])([A-Za-z])/g, "$1 $2");
    for (const token of spaced.split(/\s+/).filter(Boolean)) {
      out.add(token.toLowerCase());
    }
  }
  return out;
}

// One token-set per identifier-shaped run — used for multi-word identifier-embedded
// matching, which requires all of a term's component words to co-occur within a single run.
export function extractIdentifierRunTokenSets(content: string): Set<string>[] {
  const runs = content.match(IDENTIFIER_RUN_PATTERN) ?? [];
  return runs.map(tokenizeIdentifierRun);
}

// Every sub-token across the whole content, merged into one flat set — used for
// single-token matching, where run-grouping doesn't matter (a single word only ever
// needs to appear once, anywhere).
export function extractIdentifierSubTokens(content: string): Set<string> {
  const out = new Set<string>();
  for (const tokens of extractIdentifierRunTokenSets(content)) {
    for (const token of tokens) out.add(token);
  }
  return out;
}
