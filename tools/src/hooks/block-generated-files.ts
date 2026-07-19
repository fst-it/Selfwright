#!/usr/bin/env node
// PreToolUse hard-block: prevents Claude Code from editing generated/rendered artifacts.
// Exit 2 + stderr → Claude Code treats the hook as a block for PreToolUse.
// Exit 0 → allow.
// Cross-platform pure Node, no shell deps.
import { isGeneratedFilePath, normalizeHookPath } from "./checks.js";
import { notifyNtfy } from "./ntfy.js";

interface HookInput {
  tool_name?: string;
  tool_input?: { file_path?: string; path?: string };
}

let raw = "";
process.stdin.setEncoding("utf-8");
for await (const chunk of process.stdin) {
  raw += chunk as string;
}

let parsed: HookInput = {};
try {
  parsed = JSON.parse(raw) as HookInput;
} catch {
  // Invalid JSON from stdin — allow (don't block on parse errors)
  process.exit(0);
}

const rawPath = parsed.tool_input?.file_path ?? parsed.tool_input?.path ?? "";
const filePath = normalizeHookPath(rawPath);

if (!filePath || !isGeneratedFilePath(filePath)) {
  process.exit(0);
}

const message =
  `[block-generated-files] BLOCKED: "${rawPath}" is a generated/rendered artifact.\n` +
  `  Edit the source, not the output. Generated paths: dist/, *.pdf, *.docx, **/cv-tailored.json, reports/\n`;

process.stderr.write(message);

void notifyNtfy(`BLOCKED: ${rawPath}`, {
  title: "Selfwright hook blocked",
  priority: "high",
});

process.exit(2);
