// Machine-identity data-leak defenses (Phase 5 T5.1, ADR 0017 addendum). The owner's Windows
// username, machine hostname, personal email, and any C:\Users\<name>-style local absolute
// path must never leave the machine in a commit, push, or commit message.
//
// This is a DIFFERENT category from the named-entity confidential-name blocklist in
// named-entity-scan.ts (person/company names derived from Selfwright-data): these are MACHINE
// identifiers, derivable at runtime from the OS and git config rather than from the private
// data layer. Per the owner's instruction this is an ABSOLUTE rule: a machine-identity match
// is NEVER allowlistable via .confidential-allowlist.yml — that mechanism exists to manage
// common-word false positives on confidential *names* (an allowlist term must itself be a
// dictionary word); a machine identifier has no legitimate reason to appear in the framework
// repo at all, so there is no contextual exception to carve out. findMachineIdentityViolations
// below deliberately takes no allowlist parameter.
//
// Same open-core discipline as named-entity-scan.ts (ADR 0017 §1): every function below that
// could expose a matched value is shaped to return only a FILE PATH, never the matched
// term/pattern. Do not add a console.log/console.error that prints a username/hostname/email.
//
// Pure functions here take values as parameters (buildMachineIdentityPatterns,
// getIdentifierEmbeddedTokens, findMachineIdentityViolations, extractIdentityEmail) so unit
// tests exercise them with synthetic values only. deriveMachineIdentity is the thin runtime IO
// wrapper that gathers the real values — never unit-tested directly (same convention as the
// IO helpers at the bottom of named-entity-scan.ts).
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { hostname as osHostname, userInfo } from "node:os";
import { join } from "node:path";
import { parse as parseYamlSource } from "yaml";
import { escapeRegex } from "../data-leak-gate.js";
import { COMMON_WORDS } from "./common-words.js";
import { extractIdentifierRunTokenSets } from "./identifier-tokens.js";

export interface MachineIdentityInputs {
  readonly username?: string;
  readonly hostname?: string;
  readonly emails?: readonly string[];
}

export interface MachineIdentityViolation {
  readonly file: string;
}

// Same eligibility rule as buildNamedEntityPatterns in named-entity-scan.ts (empty, <4 chars,
// or a bundled common word is too weak/risky a signal to match standalone) — one consistent,
// well-understood eligibility rule shared across both scanners. Applied ONCE to the whole raw
// username/hostname/email value, never per split component (see splitWords below) — the same
// choice named-entity-scan makes for its multi-word terms, where requiring several component
// words to co-occur is already a much stronger signal than any single common/short word alone.
const MIN_LENGTH = 4;

function isEligible(value: string | undefined): value is string {
  if (value === undefined) return false;
  const trimmed = value.trim();
  if (trimmed.length < MIN_LENGTH) return false;
  return !COMMON_WORDS.has(trimmed.toLowerCase());
}

// Splits a machine-identity value into lowercased component words on the same separator set
// buildNamedEntityPatterns uses for multi-word names (whitespace, `.`, `,`, `-`, `_`, `/`). A
// single-token value (no internal separator — most usernames) yields a one-element array; a
// compound value (Windows' own default auto-generated hostname shape is DESKTOP-XXXXXXX, or
// any hyphen/underscore/dot-separated hostname) yields one element per word.
const MULTI_WORD_SPLIT = /[\s.,\-_/]+/;

function splitWords(value: string): string[] {
  return value
    .trim()
    .split(MULTI_WORD_SPLIT)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

// Static, value-free: these patterns reveal nothing about any particular machine, so unlike
// username/hostname/email (derived and injected) they can safely be plain literal regexes.
// Two real-shaped forms of the same local per-user path, both matched by one pattern:
//   1. Windows drive-letter form:  `C:\Users\...` / `C:/Users/...` (any drive letter, either
//      slash direction).
//   2. MSYS/Git-Bash form:        `/c/Users/...` (Git Bash on Windows renders drive `C:` as
//      `/c/`) — the exact same real local path, just as a different shell renders it. Without
//      this form, a path pasted from a Git-Bash terminal would sail past the drive-letter form
//      entirely (adversarial review finding).
// Both forms require the segment after `Users\`/`Users/` to start with a real word character
// (`\w`) — this is exactly what excludes the legal angle-bracket placeholder form
// `C:\Users\<you>` / `/c/Users/<you>` (docs use this deliberately: `<` is not a word
// character) while still catching a real, non-placeholder local absolute path.
export const WINDOWS_USER_PATH_PATTERN = /(?:[A-Za-z]:[\\/]|\/[A-Za-z]\/)Users[\\/]\w/i;

// Builds the plain-text (word-boundary) regexes for a set of machine-identity values. Always
// includes the value-free path pattern(s); adds a username/hostname/email regex only for
// values that pass the eligibility filter above. Case-insensitive. A compound username/
// hostname (see splitWords) gets a FLEXIBLE-punctuation phrase pattern — same discipline as
// buildNamedEntityPatterns' multi-word company/person names — so it still matches when
// written with a different separator convention than the one it was derived with (e.g. a
// hostname derived as "SYNTH-HOST-42" also matches "synth_host_42" or "synth host 42" in
// prose). Email is never split this way: an email's `.`/`@` characters would be torn apart by
// the same separator set, so it always gets an exact literal match.
export function buildMachineIdentityPatterns(inputs: MachineIdentityInputs): RegExp[] {
  const patterns: RegExp[] = [WINDOWS_USER_PATH_PATTERN];

  if (isEligible(inputs.username)) patterns.push(buildFlexiblePattern(inputs.username));
  if (isEligible(inputs.hostname)) patterns.push(buildFlexiblePattern(inputs.hostname));
  for (const email of inputs.emails ?? []) {
    if (isEligible(email)) {
      patterns.push(new RegExp(`\\b${escapeRegex(email.trim())}\\b`, "i"));
    }
  }
  return patterns;
}

function buildFlexiblePattern(value: string): RegExp {
  const words = splitWords(value);
  if (words.length > 1) {
    const body = words.map(escapeRegex).join("[\\s.,\\-_/]+");
    return new RegExp(`\\b${body}\\b`, "i");
  }
  return new RegExp(`\\b${escapeRegex(value.trim())}\\b`, "i");
}

// One word-group per eligible username/hostname, for identifier-embedded matching — closes
// the same \b-blind-spot gap documented in identifier-tokens.ts (e.g. a username embedded in
// `zqxbot_specific` or `zqxbotProfile` has no true word boundary around it). A single-token
// value yields a one-element group; a COMPOUND value (e.g. "SYNTH-HOST-42") yields a
// multi-element group whose words must ALL co-occur within the SAME identifier run to count
// as a match (see findMachineIdentityViolations) — mirrors named-entity-scan's multiWordTokens
// handling for multi-word confidential names. This fixes a real bug: storing a compound value
// as one opaque lowercased token (e.g. "synth-host-42") can never equal any single extracted
// sub-token, since extractIdentifierRunTokenSets always splits an identifier run on
// underscore/hyphen/camelCase boundaries — a compound hostname's embedded form would silently
// never be caught. Email is excluded: an email address has no meaningful identifier-embedded
// form, and its own word-boundary regex already has a reliable boundary (`@`/`.` are not \w).
export function getIdentifierEmbeddedTokenGroups(inputs: MachineIdentityInputs): string[][] {
  const groups: string[][] = [];
  if (isEligible(inputs.username)) groups.push(splitWords(inputs.username));
  if (isEligible(inputs.hostname)) groups.push(splitWords(inputs.hostname));
  return groups;
}

// Scanning (never exposes the matched value — file path only, same discipline as
// findNamedEntityViolations). Deliberately takes NO allowlist parameter: a machine identifier
// is never allowlistable (see file header) — there is no per-(term, path) exception to check.
export function findMachineIdentityViolations(
  fileContents: ReadonlyMap<string, string>,
  patterns: readonly RegExp[],
  identifierTokenGroups: readonly (readonly string[])[] = [],
): MachineIdentityViolation[] {
  if (patterns.length === 0 && identifierTokenGroups.length === 0) return [];
  const violations: MachineIdentityViolation[] = [];

  for (const [file, content] of fileContents) {
    let matched = patterns.some((p) => p.test(content));
    if (!matched && identifierTokenGroups.length > 0) {
      const runTokenSets = extractIdentifierRunTokenSets(content);
      matched = identifierTokenGroups.some((group) =>
        runTokenSets.some((tokens) => group.every((w) => tokens.has(w))),
      );
    }
    if (matched) violations.push({ file });
  }
  return violations;
}

// Pure — extracts contact.email from an already-parsed truth/identity.yml doc. Mirrors
// extractIdentityOwnName in named-entity-scan.ts: YAML parsing is IO, kept in the runtime
// wrapper below; extraction over the parsed doc is pure and unit-testable on its own.
export function extractIdentityEmail(doc: unknown): string | undefined {
  if (doc === null || typeof doc !== "object") return undefined;
  const contact = (doc as Record<string, unknown>)["contact"];
  if (contact === null || typeof contact !== "object") return undefined;
  const email = (contact as Record<string, unknown>)["email"];
  return typeof email === "string" && email.trim() !== "" ? email.trim() : undefined;
}

// ── Runtime derivation (IO; not unit-tested directly — the pure functions above are) ─────
/* v8 ignore start */
function readGitUserEmail(): string | undefined {
  try {
    const out = execSync("git config user.email", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return out !== "" ? out : undefined;
  } catch {
    return undefined;
  }
}

function readIdentityEmail(dataDir: string | undefined): string | undefined {
  if (dataDir === undefined) return undefined;
  const identityPath = join(dataDir, "truth", "identity.yml");
  if (!existsSync(identityPath)) return undefined;
  try {
    const doc: unknown = parseYamlSource(readFileSync(identityPath, "utf-8"), { version: "1.2" });
    return extractIdentityEmail(doc);
  } catch {
    return undefined;
  }
}

// Gathers the real machine-identity values at hook time: OS username/hostname, git config
// user.email, and (if a data dir is available) truth/identity.yml's contact.email. dataDir is
// optional and best-effort — check-text-for-pii's commit-msg check does not fail closed on a
// missing data dir the way named-entity-scan's pre-commit/pre-push gate does (git config
// user.email and the OS username/hostname are independent of the data dir and still checked).
export function deriveMachineIdentity(dataDir?: string): MachineIdentityInputs {
  const emails = new Set<string>();
  const gitEmail = readGitUserEmail();
  if (gitEmail !== undefined) emails.add(gitEmail);
  const identityEmail = readIdentityEmail(dataDir);
  if (identityEmail !== undefined) emails.add(identityEmail);

  return {
    username: userInfo().username,
    hostname: osHostname(),
    emails: [...emails],
  };
}
/* v8 ignore stop */
