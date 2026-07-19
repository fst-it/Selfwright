// FF-EGRESS (ADR 0017 §3): the SSRF class. Every outbound fetch/undici/page.goto/navigate
// call site in packages/adapters/** and apps/** must route its URL through a named
// validation guard (assert*Url), or be explicitly allowlisted as known-safe egress (a
// developer-configured local/infra endpoint, never attacker- or scanned-content-influenced).
// Structural only — asserts the guard is CALLED somewhere in the file, not that it
// dominates the call in the control-flow graph (the guard's own SSRF logic is separate).
// Detection also covers common aliased/bound-fetch forms (`= fetch`, `fetch.bind(...)`,
// destructured `{ fetch } = globalThis`), not just a literal `fetch(` token — see the
// ALIAS_* patterns below. Also catches direct `globalThis.fetch(` calls (not matched by
// FETCH_CALL_RE's negative lookbehind on `.`) — see GLOBALTHIS_FETCH_CALL_RE below.
// Accepted structural limitation: this is deterministic token/regex (not AST) matching.
// A fully dynamic or computed alias — e.g. built via `Reflect`, a string-keyed lookup,
// or reassigned through an intermediate object the scanner can't statically name — can
// still evade detection. No such pattern exists in-tree today. The scanner is augmented
// over time with cheap, targeted additions; a full AST-based control-flow reachability
// analysis is documented as a future hardening candidate (docs/fitness-functions.md §FF-EGRESS).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { CheckResult } from "./shared.js";

const CHECK_NAME = "FF-EGRESS: outbound fetch/navigate in packages/adapters/** and apps/** is guarded";

const SCAN_DIRS = ["packages/adapters", "apps"];

// Known-safe egress (ADR 0017 §3): the URL is a developer-configured local/infra endpoint
// (constructor argument or fixed baseUrl), never attacker- or scanned-content-influenced —
// unlike scan-http/scan-browser, which fetch third-party job-posting URLs and are guarded
// per call site (assert*Url). "MUST NOT false-positive on the legitimate LLM-gateway fetch
// ... allowlist that known-safe egress explicitly" (anchor §4.3).
const EGRESS_ALLOWLIST: ReadonlyArray<{ file: string; reason: string }> = [
  {
    file: "packages/adapters/llm-litellm/src/litellm-adapter.ts",
    reason:
      "the sanctioned LLM-gateway fetch (anchor §4.3) — baseUrl is local config, not attacker-influenced",
  },
  {
    file: "packages/adapters/llm-ollama/src/ollama-adapter.ts",
    reason:
      "local Ollama endpoint (default http://localhost:11434) — same developer-configured-baseUrl class as litellm",
  },
  {
    file: "packages/adapters/memory-mem0/src/mem0-adapter.ts",
    reason: "mem0 service endpoint — developer-configured baseUrl, not attacker-influenced",
  },
  {
    file: "packages/adapters/scan-http/src/http-context.ts",
    reason:
      'the one place fetch() is used in the scanner; SSRF protection is enforced per-provider ' +
      'before the URL reaches here (ATS providers via their own hostname allowlists; the generic ' +
      'provider via assertPubliclyRoutableUrl + assertDnsResolvesPublicly in url-guard.ts), ' +
      'plus redirect:"error" on every call — restructuring is out of scope for this ADR',
  },
  {
    file: "apps/web-ui/src/lib/api.ts",
    reason:
      "the cockpit's /api/* fetch wrapper (T5.10) — every call site passes a fixed, literal " +
      '"/api/..." path constructed by this app\'s own page code, never an attacker- or ' +
      "scanned-content-influenced URL (there is no third-party fetch anywhere in this app); " +
      "same-origin-only class of egress as the other allowlisted local/infra endpoints above.",
  },
  {
    file: "apps/web-ui/e2e/cockpit.e2e.ts",
    reason:
      "T5.10's local-only Playwright E2E spec: every fetch()/page.goto() targets a URL built " +
      "from a hardcoded localhost port driving a server process this same script just spawned " +
      "(never a third-party or scanned-content URL) — a test harness, the same class of " +
      "developer-controlled egress as the other allowlisted entries above, not production code.",
  },
];

const FETCH_CALL_RE = /(?<![.\w])fetch\(/g;
const GOTO_CALL_RE = /\.goto\(/g;
const NAVIGATE_CALL_RE = /(?<![.\w])navigate\(/g;
const UNDICI_IMPORT_RE = /from\s+["']undici["']/;
const GUARD_CALL_RE = /\bassert\w*Url\w*\s*\(/i;
// A function/method DECLARATION looks like "fetch(target: ScanTarget, ...)" — a real CALL
// never has an "identifier: Type" first argument (that syntax is declaration-only in TS).
const DECLARATION_ARG_RE = /^\s*\w+\s*:\s*/;

// Aliased/bound fetch (ADR 0017 §3 residual, closed here): a fetch call routed through an
// alias or a bound reference has no literal `fetch(` call-site token, so FETCH_CALL_RE above
// is structurally blind to it (`this.doRequest = fetch.bind(globalThis); ... this.doRequest(url)`
// never contains the substring "fetch("). These patterns instead catch the ALIASING site
// itself — assignment, `.bind(`, or destructuring — regardless of what name the eventual call
// site uses. Still deterministic token/regex matching, no AST.
// `= fetch` / `= globalThis.fetch` not immediately followed by `(` (a call, already covered
// by FETCH_CALL_RE): `this.doRequest = fetch;`, `const f = globalThis.fetch;`.
const ALIAS_ASSIGN_RE = /=\s*(?:globalThis\.)?fetch\b(?!\s*\()/;
// `fetch.bind(...)` in any position, including `globalThis.fetch.bind(globalThis)` — covers
// both "fetch.bind(" and ".bind(globalThis) on fetch" as one pattern.
const FETCH_BIND_RE = /\bfetch\s*\.\s*bind\s*\(/;
// `const { fetch } = globalThis;` (destructured from undici is already covered by
// UNDICI_IMPORT_RE, which matches any import statement naming the "undici" module).
const DESTRUCTURE_GLOBALTHIS_FETCH_RE = /\{[^}]*\bfetch\b[^}]*\}\s*=\s*globalThis\b/;
// `globalThis.fetch(url)` — a direct call via the global property accessor. FETCH_CALL_RE's
// negative lookbehind `(?<![.\w])` excludes any `.fetch(` sequence, so `globalThis.fetch(`
// is structurally invisible to it. This pattern closes that specific gap.
const GLOBALTHIS_FETCH_CALL_RE = /\bglobalThis\.fetch\s*\(/;

function walkTs(dir: string, files: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    try {
      const stat = statSync(full);
      if (stat.isDirectory() && entry !== "node_modules" && entry !== "dist" && entry !== ".turbo") {
        walkTs(full, files);
      } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts") && !entry.endsWith(".test.ts")) {
        files.push(full);
      }
    } catch {
      // skip unreadable entries
    }
  }
  return files;
}

// Strips `//` line comments and `/* */` block comments before scanning for egress/guard
// tokens, so a comment merely mentioning `fetch(` doesn't trip hasEgress. Best-effort and
// deterministic, not a full JS/TS parser: a string literal that itself contains `/*` could
// in principle be mis-stripped. The `(?<!:)` guard on the line-comment pattern specifically
// protects "http://" / "https://" URL literals (a real risk in adapter source), which would
// otherwise be misread as the start of a line comment. Stripping can only ever reduce false
// positives here — both the hasEgress and the GUARD_CALL_RE checks run against the same
// stripped content, so a real unguarded call site is never hidden by this step.
function stripComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");
}

function hasRealCallSite(content: string, re: RegExp): boolean {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const after = content.slice(m.index + m[0].length);
    if (!DECLARATION_ARG_RE.test(after)) return true;
  }
  return false;
}

export function checkEgressGuard(repoRoot: string): CheckResult {
  const violations: string[] = [];

  for (const dir of SCAN_DIRS) {
    const files = walkTs(join(repoRoot, dir));
    for (const file of files) {
      let rawContent: string;
      try {
        rawContent = readFileSync(file, "utf-8");
      } catch {
        continue;
      }
      const content = stripComments(rawContent);

      const hasEgress =
        hasRealCallSite(content, FETCH_CALL_RE) ||
        hasRealCallSite(content, GOTO_CALL_RE) ||
        hasRealCallSite(content, NAVIGATE_CALL_RE) ||
        UNDICI_IMPORT_RE.test(content) ||
        ALIAS_ASSIGN_RE.test(content) ||
        FETCH_BIND_RE.test(content) ||
        DESTRUCTURE_GLOBALTHIS_FETCH_RE.test(content) ||
        GLOBALTHIS_FETCH_CALL_RE.test(content);
      if (!hasEgress) continue;
      if (GUARD_CALL_RE.test(content)) continue;

      const relPath = relative(repoRoot, file).split("\\").join("/");
      if (EGRESS_ALLOWLIST.some((e) => e.file === relPath)) continue;

      violations.push(
        `${relPath}: outbound fetch/undici/goto/navigate on a non-literal URL with no assert*Url guard call in file`,
      );
    }
  }

  if (violations.length > 0) {
    return { name: CHECK_NAME, passed: false, details: violations.join("\n") };
  }
  return { name: CHECK_NAME, passed: true };
}
