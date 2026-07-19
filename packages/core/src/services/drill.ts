// ── Coaching drill service — mirrors cover.ts's shape exactly ─────────────────
import type { LlmPort } from "../ports/llm.js";
import type { Identity, EvidenceEntry } from "../truth/index.js";
import type { DrillSelection } from "../coaching/index.js";

// Resolved evidence entries are passed in by the caller (same pre-resolved
// pattern as cover.ts, which assembles context before calling the builder).
export interface DrillContext {
  selection: DrillSelection;
  identity: Identity;
  archetypeId?: string;
  /** Resolved EvidenceEntry objects for each item in selection.evidenceBundle. */
  evidenceDetails: EvidenceEntry[];
}

export interface DrillResult {
  markdown: string;
}

function buildDrillSystemPrompt(): string {
  return [
    "You are an interview coach.",
    "Formulate exactly ONE natural interview question grounded only in the provided evidence bundle.",
    "If the topic has kind 'gap', the question must probe the gap's title directly.",
    "Do NOT reveal the model answer or hint at desired content in the question itself.",
    "After the question, provide a suggested answer grounded only in the evidence, then a coach critique.",
    "Output format (use these exact headings):",
    "## Question",
    "## My answer",
    "## Coach critique",
    "Grounding: <EVD-* ids used>",
    "",
    "Hard rule: never invent facts, titles, systems, or metrics outside the provided evidence.",
  ].join("\n");
}

function buildDrillUserPrompt(ctx: DrillContext): string {
  const { selection, identity } = ctx;
  const parts: string[] = [
    `TOPIC: ${selection.topicId}`,
    `KIND: ${selection.kind}`,
    "",
  ];

  if (selection.kind === "gap" && selection.gap !== undefined) {
    parts.push(
      "GAP DETAILS:",
      `  Title: ${selection.gap.title}`,
      `  Honest gap: ${selection.gap.honest_gap}`,
      `  Suggested frame: ${selection.gap.frame}`,
      "",
    );
  }

  parts.push(
    "IDENTITY:",
    `  Name: ${identity.name}`,
    `  Canonical title: ${identity.canonical_title}`,
    "",
  );

  if (ctx.archetypeId) {
    parts.push(`TARGET ARCHETYPE: ${ctx.archetypeId}`, "");
  }

  parts.push("EVIDENCE BUNDLE:");
  for (const e of ctx.evidenceDetails) {
    parts.push(`  [${e.id}] (${e.org}) ${e.claim}${e.detail ? " — " + e.detail : ""}`);
    if (e.keywords.length > 0) {
      parts.push(`    keywords: ${e.keywords.join(", ")}`);
    }
  }
  parts.push("");

  parts.push(
    "Generate the drill using exactly the headings specified. Cite only evidence ids from the bundle above.",
  );

  return parts.join("\n");
}

export async function drill(ctx: DrillContext, llm: LlmPort): Promise<DrillResult> {
  const systemPrompt = buildDrillSystemPrompt();
  const userPrompt = buildDrillUserPrompt(ctx);
  const result = await llm.complete({
    role: "coaching-drill",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  return { markdown: result.content };
}

// Export builders for testability without LLM
export { buildDrillSystemPrompt, buildDrillUserPrompt };
