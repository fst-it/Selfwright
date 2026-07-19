// Named-entity data-leak scan (ADR 0017 §1) — the authoritative local defense against
// committing a confidential person/company name into the framework repo. BASE_PII_PATTERNS
// in data-leak-gate.ts is regex-only and structurally blind to names (a name has no
// syntactic signature); this scanner closes that gap by DERIVING the confidential-name
// blocklist in memory, at hook time, from the private data layer (Selfwright-data) — never
// hand-maintained, so it can never be forgotten or left empty (the failure mode this ADR
// hardens against).
//
// Runs LOCALLY ONLY (pre-commit + pre-push): cloud CI has no access to Selfwright-data
// (anchor §4.3, local-first), so it structurally cannot run this scan. See docs/adr/0017.
//
// Open-core boundary (absolute, ADR 0017 §1): the derived list is held in process memory
// only — never written to any file, cache, or log in this repo. Every function below that
// could expose a matched name is deliberately shaped to return only a FILE PATH, never the
// term/pattern that matched (same discipline as findPiiViolationsInContent in
// data-leak-gate.ts). Do not add a console.log/console.error that prints a `term` value.
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYamlSource } from "yaml";
import { escapeRegex, isNamedEntityScannableFile } from "../data-leak-gate.js";
import { COMMON_WORDS } from "./common-words.js";
import { extractIdentifierRunTokenSets, extractIdentifierSubTokens } from "./identifier-tokens.js";
import {
  buildMachineIdentityPatterns,
  deriveMachineIdentity,
  findMachineIdentityViolations,
  getIdentifierEmbeddedTokenGroups,
} from "./machine-identity.js";

// Re-exported for backward compatibility — these lived in this file until Phase 5 T5.1
// extracted them into identifier-tokens.ts so machine-identity.ts could reuse them without
// a circular import (machine-identity.ts imports from identifier-tokens.ts, never from here).
export { extractIdentifierRunTokenSets, extractIdentifierSubTokens };

// ── Data dir resolution — fail-closed (ADR 0017 §2) ─────────────────────────────
// SELFWRIGHT_DATA_DIR env var → conventional sibling ../Selfwright-data → hard fail.
// Distinguishes "scanned and clean" from "could not scan" so an unconfigured
// environment can never masquerade as a clean named-entity result.
export interface DataDirResolution {
  readonly ok: boolean;
  readonly dir?: string;
  readonly reason?: string;
}

export function resolveDataDir(repoRoot: string): DataDirResolution {
  const envDir = process.env["SELFWRIGHT_DATA_DIR"];
  if (envDir !== undefined && envDir.trim() !== "") {
    if (existsSync(envDir)) return { ok: true, dir: resolve(envDir) };
    return {
      ok: false,
      reason: `SELFWRIGHT_DATA_DIR is set to "${envDir}" but that path does not exist.`,
    };
  }
  const sibling = resolve(repoRoot, "..", "Selfwright-data");
  if (existsSync(sibling)) return { ok: true, dir: sibling };
  return {
    ok: false,
    reason:
      "No data dir found: SELFWRIGHT_DATA_DIR is unset and the conventional sibling " +
      "../Selfwright-data does not exist. The named-entity scan cannot verify staged/pushed " +
      "files are free of confidential names — failing closed. Set SELFWRIGHT_DATA_DIR or " +
      "place the private data repo at ../Selfwright-data.",
  };
}

// ── Term derivation (pure over an already-read doc; IO wrapper below) ──────────
const NAME_LIKE_KEY_PATTERN =
  /(^name$|_name$|^company$|^contact$|^hiring_manager$|^referrer$|^recruiter$)/i;

function collectStringsByKey(node: unknown, keyPattern: RegExp, out: Set<string>): void {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const item of node) collectStringsByKey(item, keyPattern, out);
    return;
  }
  if (typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (keyPattern.test(key) && typeof value === "string" && value.trim() !== "") {
        out.add(value.trim());
      }
      collectStringsByKey(value, keyPattern, out);
    }
  }
}

// Deliberately excludes the top-level `name` field (ADR 0017 §1 owner-name exemption):
// identity.yml's own name is the owner's authorship identity, legitimately present in
// framework files like LICENSE and .claude-plugin manifests — not a confidential third
// party. roles_timeline[].company (past/current employers) is a different category: those
// are exactly the confidential names this scanner exists to keep out of the framework repo,
// so they stay in the derived set. See extractIdentityOwnName for the excluded field.
export function extractIdentityTerms(doc: unknown): string[] {
  const out = new Set<string>();
  if (doc !== null && typeof doc === "object") {
    const d = doc as Record<string, unknown>;
    const timeline = d["roles_timeline"];
    if (Array.isArray(timeline)) {
      for (const role of timeline) {
        if (role !== null && typeof role === "object") {
          const company = (role as Record<string, unknown>)["company"];
          if (typeof company === "string" && company.trim() !== "") out.add(company.trim());
        }
      }
    }
  }
  return [...out];
}

// The owner's own name (identity.yml `name`) — extracted separately from
// extractIdentityTerms precisely so it is never folded into the confidential blocklist.
// Not currently consumed by deriveConfidentialTerms; exported for test coverage of the
// exemption and for any future caller that needs the distinction explicit.
export function extractIdentityOwnName(doc: unknown): string | undefined {
  if (doc === null || typeof doc !== "object") return undefined;
  const name = (doc as Record<string, unknown>)["name"];
  return typeof name === "string" && name.trim() !== "" ? name.trim() : undefined;
}

export function extractGenericTerms(doc: unknown): string[] {
  const out = new Set<string>();
  if (doc !== null && typeof doc === "object") {
    const company = (doc as Record<string, unknown>)["company"];
    if (typeof company === "string" && company.trim() !== "") out.add(company.trim());
  }
  collectStringsByKey(doc, NAME_LIKE_KEY_PATTERN, out);
  return [...out];
}

export function extractDriftTerms(doc: unknown, filenameStem: string): string[] {
  const out = new Set<string>();
  if (filenameStem.trim() !== "") out.add(filenameStem.trim());
  if (doc !== null && typeof doc === "object") {
    const company = (doc as Record<string, unknown>)["company"];
    if (typeof company === "string" && company.trim() !== "") out.add(company.trim());
  }
  return [...out];
}

function safeReadYaml(path: string): unknown {
  try {
    const raw = readFileSync(path, "utf-8");
    return parseYamlSource(raw, { version: "1.2" });
  } catch (err) {
    process.stderr.write(
      `[named-entity-scan] WARN: could not parse ${path}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return undefined;
  }
}

function collectYamlTermsInDir(dir: string, extract: (doc: unknown) => string[]): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
    out.push(...extract(safeReadYaml(join(dir, file))));
  }
  return out;
}

// Derives the confidential-name blocklist from Selfwright-data (ADR 0017 §1 source list):
// truth/identity.yml (roles_timeline[].company only — the owner's own `name` field is
// intentionally excluded, see extractIdentityTerms), applications/*.yml (company +
// contact/hiring-manager/referrer names), contacts/*.yml (person + company names),
// drifts/companies/*.yml (filename stem + company field), positioning/*.yml (company names).
// Held in memory only by the caller — this function itself performs no writes.
export function deriveConfidentialTerms(dataDir: string): string[] {
  const terms = new Set<string>();

  const identityPath = join(dataDir, "truth", "identity.yml");
  if (existsSync(identityPath)) {
    for (const t of extractIdentityTerms(safeReadYaml(identityPath))) terms.add(t);
  }

  for (const t of collectYamlTermsInDir(join(dataDir, "applications"), extractGenericTerms)) {
    terms.add(t);
  }
  for (const t of collectYamlTermsInDir(join(dataDir, "contacts"), extractGenericTerms)) {
    terms.add(t);
  }
  for (const t of collectYamlTermsInDir(join(dataDir, "positioning"), extractGenericTerms)) {
    terms.add(t);
  }

  const driftsCompaniesDir = join(dataDir, "drifts", "companies");
  if (existsSync(driftsCompaniesDir)) {
    for (const file of readdirSync(driftsCompaniesDir)) {
      if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
      const stem = basename(file, extname(file));
      const doc = safeReadYaml(join(driftsCompaniesDir, file));
      for (const t of extractDriftTerms(doc, stem)) terms.add(t);
    }
  }

  return [...terms].filter((t) => t.trim().length > 0);
}

// Additive override (ADR 0017 §1): the pre-existing .confidential-names.local /
// SELFWRIGHT_CONFIDENTIAL_NAMES sources, for names that live only in a human's head.
// Returns raw terms (not regexes) so they get the same phrase/single-token treatment
// as derived terms via buildNamedEntityPatterns.
export function loadAdditionalConfidentialNames(repoRoot: string): string[] {
  const localFile = resolve(repoRoot, ".confidential-names.local");
  const raw = existsSync(localFile)
    ? readFileSync(localFile, "utf-8")
    : (process.env["SELFWRIGHT_CONFIDENTIAL_NAMES"] ?? "");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

// ── Pattern building ─────────────────────────────────────────────────────────
export interface NamedPattern {
  readonly term: string;
  readonly regex: RegExp;
  // Single-token terms (e.g. an unusual employer name with no spaces) are also checked
  // against identifier-embedded sub-tokens (see extractIdentifierSubTokens below).
  readonly singleToken: boolean;
  // For a multi-word term ("Zorblatt Fenwick"), the lowercased component words. A
  // multi-word term DOES have a meaningful identifier-embedded form — e.g.
  // `zorblattFenwickWebhookUrl`, `zorblatt_fenwick_webhook_url` — checked by requiring
  // every word in this list to appear as a sub-token within the SAME identifier run (see
  // extractIdentifierRunTokenSets below). Empty for single-token patterns, which use
  // `term` directly instead.
  readonly multiWordTokens: readonly string[];
}

const MULTI_WORD_SPLIT = /[\s.,\-_/]+/;
const MIN_SINGLE_TOKEN_LENGTH = 4;

// Matching (ADR 0017 §1): case-insensitive, word-boundary. Multi-word entities
// ("Blorptech.io", "Jane Doe") match as a full phrase with flexible internal
// whitespace/punctuation. A single-token term additionally matches on its own only
// when it is NOT a bundled common word and is >= 4 chars (so an uncommon employer name
// is caught alone; a common surname like "Jane" or a job-board word like "booking" is not).
export function buildNamedEntityPatterns(terms: readonly string[]): NamedPattern[] {
  const patterns: NamedPattern[] = [];
  for (const rawTerm of terms) {
    const term = rawTerm.trim();
    if (!term) continue;
    const words = term.split(MULTI_WORD_SPLIT).filter(Boolean);
    if (words.length > 1) {
      const body = words.map(escapeRegex).join("[\\s.,\\-_/]+");
      patterns.push({
        term,
        regex: new RegExp(`\\b${body}\\b`, "i"),
        singleToken: false,
        multiWordTokens: words.map((w) => w.toLowerCase()),
      });
    } else if (term.length >= MIN_SINGLE_TOKEN_LENGTH && !COMMON_WORDS.has(term.toLowerCase())) {
      patterns.push({
        term,
        regex: new RegExp(`\\b${escapeRegex(term)}\\b`, "i"),
        singleToken: true,
        multiWordTokens: [],
      });
    }
  }
  return patterns;
}

// ── Allowlist (ADR 0017 §1) — per (term, path), never global ──────────────────
export interface AllowlistEntry {
  readonly term: string;
  readonly path: string;
  readonly reason: string;
}

export function loadAllowlist(repoRoot: string): AllowlistEntry[] {
  const path = resolve(repoRoot, ".confidential-allowlist.yml");
  if (!existsSync(path)) return [];
  let doc: unknown;
  try {
    doc = parseYamlSource(readFileSync(path, "utf-8"), { version: "1.2" });
  } catch {
    return [];
  }
  const entries =
    doc !== null && typeof doc === "object" ? (doc as Record<string, unknown>)["entries"] : undefined;
  if (!Array.isArray(entries)) return [];

  const out: AllowlistEntry[] = [];
  for (const e of entries) {
    if (
      e !== null &&
      typeof e === "object" &&
      typeof (e as Record<string, unknown>)["term"] === "string" &&
      typeof (e as Record<string, unknown>)["path"] === "string"
    ) {
      const rec = e as Record<string, unknown>;
      out.push({
        term: rec["term"] as string,
        path: rec["path"] as string,
        reason: typeof rec["reason"] === "string" ? (rec["reason"]) : "",
      });
    }
  }
  return out;
}

// INVARIANT (ADR 0017 §1): an allowlist term must itself be a common dictionary word.
// A unique non-dictionary name (e.g. a real employer) must never appear in the allowlist
// and is always blocked everywhere. Returns the offending terms for programmatic/test use
// only — the CLI orchestrator below never prints this array (would defeat the point: the
// offending term is, by definition of this failure, a candidate confidential name).
export function validateAllowlistInvariant(
  entries: readonly AllowlistEntry[],
): { valid: boolean; invalidTerms: string[] } {
  const invalidTerms = entries
    .filter((e) => !COMMON_WORDS.has(e.term.trim().toLowerCase()))
    .map((e) => e.term);
  return { valid: invalidTerms.length === 0, invalidTerms };
}

// Minimal glob matcher for allowlist path-globs (`*` = any run of non-separator chars,
// `**` = any run including separators). No new dependency — deterministic, hand-rolled.
export function matchGlob(pattern: string, filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/");
  const regexStr = normalizedPattern
    .split("**")
    .map((segment) => segment.split("*").map(escapeRegex).join("[^/]*"))
    .join(".*");
  return new RegExp(`^${regexStr}$`).test(normalizedPath);
}

// ── Scanning (never exposes the matched term — file path only) ────────────────
export interface NamedEntityViolation {
  readonly file: string;
}

export function findNamedEntityViolations(
  fileContents: ReadonlyMap<string, string>,
  patterns: readonly NamedPattern[],
  allowlist: readonly AllowlistEntry[] = [],
): NamedEntityViolation[] {
  if (patterns.length === 0) return [];
  const violations: NamedEntityViolation[] = [];

  for (const [file, content] of fileContents) {
    let subTokens: Set<string> | undefined;
    let runTokenSets: Set<string>[] | undefined;
    for (const { term, regex, singleToken, multiWordTokens } of patterns) {
      let matched = regex.test(content);
      if (!matched && singleToken) {
        subTokens ??= extractIdentifierSubTokens(content);
        matched = subTokens.has(term.toLowerCase());
      }
      if (!matched && !singleToken && multiWordTokens.length > 0) {
        runTokenSets ??= extractIdentifierRunTokenSets(content);
        matched = runTokenSets.some((tokens) => multiWordTokens.every((w) => tokens.has(w)));
      }
      if (!matched) continue;
      const allowlisted = allowlist.some(
        (e) => e.term.trim().toLowerCase() === term.toLowerCase() && matchGlob(e.path, file),
      );
      if (allowlisted) continue;
      violations.push({ file });
      break; // one violation per file is enough — never report which term matched
    }
  }
  return violations;
}

// ── IO helpers (not unit-tested — exercised via the hook itself) ──────────────
/* v8 ignore start */
const MAX_SCAN_BYTES = 200_000;
const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const ZERO_SHA = "0000000000000000000000000000000000000000";

function getGitRoot(): string {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf-8" });
  if (r.error !== undefined || r.status !== 0) {
    throw new Error("[named-entity-scan] not in a git repository");
  }
  return r.stdout.trim();
}

function getStagedFiles(): string[] {
  const output = execSync("git diff --cached --name-only", { encoding: "utf-8" });
  return output.trim().split("\n").filter(Boolean);
}

function getStagedFileContents(files: readonly string[]): Map<string, string> {
  const contents = new Map<string, string>();
  for (const file of files) {
    try {
      const content = execSync(`git show ":${file}"`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      if (content.length > MAX_SCAN_BYTES) continue;
      contents.set(file, content);
    } catch {
      // binary or unreadable — skip
    }
  }
  return contents;
}

// git's pre-push hook protocol: one line per ref being pushed, on stdin —
// "<local ref> <local sha1> <remote ref> <remote sha1>". A remote sha of all zeros
// means the remote ref does not exist yet (new branch) — diff against the empty tree.
export function parsePrePushRefs(input: string): Array<{ localSha: string; remoteSha: string }> {
  return input
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      return { localSha: parts[1] ?? "", remoteSha: parts[3] ?? "" };
    })
    .filter((r) => r.localSha !== "" && r.localSha !== ZERO_SHA);
}

function readStdin(): string {
  try {
    return readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}

// Fallback file-determination when stdin parsing yields nothing (ADR 0017 fail-closed
// spirit): stdin forwarding through the git -> lefthook -> pnpm -> node process chain is
// NOT guaranteed reliable on every platform — observed in practice: readFileSync(0) can
// silently return "" on a Windows pipe through that chain, which would otherwise make this
// hook report "nothing to scan" on a real push and give false assurance. @{push} (falling
// back to @{u}) reflects the pre-push, not-yet-updated remote-tracking state at the time
// this hook runs, so it needs no stdin at all. If neither resolves (first push of a brand
// new branch with no upstream), scan every file in HEAD's tree rather than nothing.
function getChangedFilesViaUpstreamRef(): string[] {
  for (const ref of ["@{push}", "@{u}"]) {
    const probe = spawnSync("git", ["rev-parse", ref], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    if (probe.status !== 0) continue;
    const result = spawnSync("git", ["diff", "--name-only", `${ref}..HEAD`], { encoding: "utf-8" });
    if (result.status === 0) return result.stdout.trim().split("\n").filter(Boolean);
  }
  const result = spawnSync("git", ["diff", "--name-only", `${EMPTY_TREE_SHA}..HEAD`], { encoding: "utf-8" });
  return result.status === 0 ? result.stdout.trim().split("\n").filter(Boolean) : [];
}

function getPushChangedFiles(refs: Array<{ localSha: string; remoteSha: string }>): string[] {
  const files = new Set<string>();
  for (const { localSha, remoteSha } of refs) {
    const base = remoteSha === "" || remoteSha === ZERO_SHA ? EMPTY_TREE_SHA : remoteSha;
    const result = spawnSync("git", ["diff", "--name-only", `${base}..${localSha}`], {
      encoding: "utf-8",
    });
    if (result.status === 0) {
      for (const f of result.stdout.trim().split("\n").filter(Boolean)) files.add(f);
    }
  }
  if (files.size > 0) return [...files];
  return getChangedFilesViaUpstreamRef();
}

// Reads content at HEAD — a deliberate simplification for the common single-branch-push
// case (local_sha for the pushed branch is HEAD). Multi-branch pushes still get every
// changed path scanned; content is read from the currently checked-out tree.
function getFileContentsAtHead(files: readonly string[]): Map<string, string> {
  const contents = new Map<string, string>();
  for (const file of files) {
    try {
      const content = execSync(`git show "HEAD:${file}"`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      if (content.length > MAX_SCAN_BYTES) continue;
      contents.set(file, content);
    } catch {
      // deleted file or binary — skip
    }
  }
  return contents;
}

function main(): void {
  const mode = process.argv[2] === "pre-push" ? "pre-push" : "pre-commit";
  const repoRoot = getGitRoot();

  const resolution = resolveDataDir(repoRoot);
  if (!resolution.ok) {
    console.error(`\n[named-entity-scan] BLOCKED (fail-closed): ${resolution.reason}\n`);
    process.exit(1);
  }
  const dataDir = resolution.dir as string;

  const changedFiles =
    mode === "pre-commit" ? getStagedFiles() : getPushChangedFiles(parsePrePushRefs(readStdin()));
  const scannableFiles = changedFiles.filter(isNamedEntityScannableFile);

  if (scannableFiles.length === 0) {
    console.log(
      `[named-entity-scan] No scannable ${mode === "pre-commit" ? "staged" : "pushed"} files — skipping.`,
    );
    process.exit(0);
  }

  const fileContents =
    mode === "pre-commit" ? getStagedFileContents(scannableFiles) : getFileContentsAtHead(scannableFiles);

  const allowlist = loadAllowlist(repoRoot);
  const invariant = validateAllowlistInvariant(allowlist);
  if (!invariant.valid) {
    console.error(
      `\n[named-entity-scan] BLOCKED: .confidential-allowlist.yml has ${invariant.invalidTerms.length} ` +
        "entry/entries whose term is not a common dictionary word. An allowlist term must be a common " +
        "word — a unique name can never be allowlisted. Fix .confidential-allowlist.yml.\n",
    );
    process.exit(1);
  }

  const derivedTerms = deriveConfidentialTerms(dataDir);
  const additionalTerms = loadAdditionalConfidentialNames(repoRoot);
  const patterns = buildNamedEntityPatterns([...derivedTerms, ...additionalTerms]);

  const violations = findNamedEntityViolations(fileContents, patterns, allowlist);

  // Machine-identity check (Phase 5 T5.1, ADR 0017 addendum): the owner's Windows username,
  // hostname, personal email, and any C:\Users\<name>-style local path — a DIFFERENT category
  // from the confidential-name blocklist above, never allowlistable (see machine-identity.ts
  // file header). Same file-contents input, same file-path-only reporting discipline.
  const machineIdentity = deriveMachineIdentity(dataDir);
  const machinePatterns = buildMachineIdentityPatterns(machineIdentity);
  const machineTokens = getIdentifierEmbeddedTokenGroups(machineIdentity);
  const machineViolations = findMachineIdentityViolations(fileContents, machinePatterns, machineTokens);

  const violatingFiles = new Set([...violations.map((v) => v.file), ...machineViolations.map((v) => v.file)]);

  if (violatingFiles.size > 0) {
    console.error(
      `\n[named-entity-scan] BLOCKED: confidential name/company or machine-identity pattern found in ` +
        `${mode === "pre-commit" ? "staged" : "pushed"} file(s):`,
    );
    for (const f of violatingFiles) {
      console.error(`  ✖ ${f}`);
    }
    console.error(
      "  → Remove the confidential name/company from framework files, or move it to Selfwright-data.\n" +
        "  → A machine-identity match (username/hostname/personal email/local path) is never\n" +
        "    allowlistable — it must simply be removed.\n",
    );
    process.exit(1);
  }

  console.log(
    `[named-entity-scan] ✓ Clean — ${scannableFiles.length} file(s) scanned against ` +
      `${patterns.length} derived pattern(s) + machine-identity patterns, no violations found.`,
  );
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
/* v8 ignore stop */
