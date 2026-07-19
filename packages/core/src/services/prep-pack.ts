// ── Coaching prep-pack service — mirrors cover.ts's shape exactly ─────────────
import type { LlmPort } from "../ports/llm.js";
import type { Identity, EvidenceEntry, Gap } from "../truth/index.js";
import type { CandidateGap, RankedEvidence, PrepPackKind } from "../coaching/index.js";
import { fenceUntrusted } from "./prompt-fence.js";

export interface PrepPackContext {
  kind: PrepPackKind;
  identity: Identity;
  archetypeId?: string;
  /** Interview prep: job description text. */
  jdText?: string;
  /** Networking/event prep: person, company, or event background. */
  contextText?: string;
  candidateGaps: CandidateGap[];
  gaps: Gap[];
  topEvidence: RankedEvidence[];
  /** Resolved EvidenceEntry objects for each item in topEvidence, for prompt rendering. */
  evidenceDetails: EvidenceEntry[];
}

export interface PrepPackResult {
  markdown: string;
}

function buildPrepPackSystemPrompt(kind: PrepPackKind): string {
  const framingByKind: Record<PrepPackKind, string> = {
    interview:
      "You are an interview preparation coach. Anticipate likely questions, lead each grounded " +
      "answer with the ranked evidence, and include a 'Gaps to rehearse' section using each gap's " +
      "own frame text — never invent a smoother framing than the gap's `frame` field.",
    networking:
      "You are a networking preparation coach. Produce concise talking points AND questions to ask, " +
      "plus a lighter gaps-awareness section so the candidate knows where to be careful.",
    event:
      "You are an event preparation coach. Produce positioning and conversation starters aligned " +
      "to the event's themes, citing evidence that supports speaking credibly to each theme.",
  };

  return [
    framingByKind[kind],
    "",
    "Hard rule: every claim must trace to the provided evidence; never invent facts, titles, systems, or metrics.",
    "Required output headings: ## Likely questions, ## Grounded answers",
    kind === "interview" ? "Also required: ## Gaps to rehearse (cite GAP-* ids and supporting EVD-* ids)" : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPrepPackUserPrompt(ctx: PrepPackContext): string {
  const parts: string[] = [];

  if (ctx.jdText) {
    parts.push("JOB DESCRIPTION:", ...fenceUntrusted(ctx.jdText), "");
  }
  if (ctx.contextText) {
    parts.push("CONTEXT:", ...fenceUntrusted(ctx.contextText), "");
  }

  parts.push(
    "IDENTITY:",
    `  Name: ${ctx.identity.name}`,
    `  Canonical title: ${ctx.identity.canonical_title}`,
    `  Honesty boundaries: ${ctx.identity.honesty_boundaries.join("; ")}`,
    "",
  );

  if (ctx.archetypeId) {
    parts.push(`TARGET ARCHETYPE: ${ctx.archetypeId}`, "");
  }

  parts.push("TOP EVIDENCE:");
  for (const e of ctx.evidenceDetails) {
    parts.push(`  [${e.id}] (${e.org}) ${e.claim}${e.detail ? " — " + e.detail : ""}`);
    if (e.keywords.length > 0) {
      parts.push(`    keywords: ${e.keywords.join(", ")}`);
    }
  }
  parts.push("");

  if (ctx.candidateGaps.length > 0) {
    parts.push("COVERAGE GAPS:");
    for (const c of ctx.candidateGaps) {
      const tier = c.coverage.toUpperCase();
      const evd = c.evidenceIds.length > 0 ? ` [${c.evidenceIds.join(", ")}]` : "";
      parts.push(`  ${tier}: ${c.topic}${evd}`);
    }
    parts.push("");
  }

  if (ctx.gaps.length > 0) {
    parts.push("GAP LEDGER (use these frames verbatim in 'Gaps to rehearse'):");
    for (const g of ctx.gaps) {
      parts.push(
        `  [${g.id}] ${g.title}`,
        `    Honest gap: ${g.honest_gap}`,
        `    Frame: ${g.frame}`,
      );
    }
    parts.push("");
  }

  parts.push(
    "Produce the prep-pack with the required headings. Cite evidence ids (EVD-*, GAP-*) inline. " +
      "Never cite an id not listed above.",
  );

  return parts.join("\n");
}

export async function prepPack(ctx: PrepPackContext, llm: LlmPort): Promise<PrepPackResult> {
  const systemPrompt = buildPrepPackSystemPrompt(ctx.kind);
  const userPrompt = buildPrepPackUserPrompt(ctx);
  const result = await llm.complete({
    role: "coaching-prep-pack",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  return { markdown: result.content };
}

// Export builders for testability without LLM
export { buildPrepPackSystemPrompt, buildPrepPackUserPrompt };
