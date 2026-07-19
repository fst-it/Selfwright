// ── Content topics service — mirrors prep-pack.ts's shape exactly ─────────
import type { LlmPort } from "../ports/llm.js";
import type { Identity, EvidenceEntry, Gap } from "../truth/index.js";
import type { ContentTopicCandidate } from "../content/index.js";
import { fenceUntrusted } from "./prompt-fence.js";

export interface TopicsContext {
  mode: "digest" | "application";
  identity: Identity;
  archetypeId?: string;
  appRef?: string;
  jdText?: string;
  candidates: ContentTopicCandidate[];
  /** Resolved EvidenceEntry objects for evidence cited in candidates. */
  evidenceDetails: EvidenceEntry[];
  gaps: Gap[];
}

export interface TopicsResult {
  markdown: string;
}

export function buildTopicsSystemPrompt(mode: TopicsContext["mode"]): string {
  const framingByMode: Record<TopicsContext["mode"], string> = {
    digest:
      "You are a content strategy co-pilot. Research each candidate topic on the live web " +
      "with a 30-day freshness window, prefer high-engagement and authoritative sources, and " +
      "produce a ranked digest of 3–5 topics with citations.",
    application:
      "You are a content strategy co-pilot. Research each candidate topic on the live web " +
      "with a 30-day freshness window, focussed on the target role's domain, and " +
      "produce a ranked digest of 3–5 topics with citations.",
  };

  return [
    framingByMode[mode],
    "",
    "Hard rules:",
    "  - Every topic must carry at least one real source URL (https://...).",
    "  - 'Topics to write' items must cite the provided EVD-* ids (credibility grounding); " +
      "never claim experience beyond what the evidence supports.",
    "  - 'Topics to read' items must reference the provided GAP-* ids where present.",
    "  - Never invent evidence, metrics, titles, or sources.",
    "",
    // Topic item format: each topic is a markdown list item starting with '- '.
    // The validator counts '- ' prefixed lines within each section to verify the
    // 3–5 combined topic count and checks each item (plus its indented continuation
    // lines, if any) for a URL — keep this in lockstep.
    "Required output headings (exactly): ## Topics to write, ## Topics to read.",
    "Under each heading list each topic as a markdown list item starting with '- '.",
    "Each list item must include at least one source URL (https://...), either inline in " +
      "the item or on an immediately-following indented continuation line " +
      "(e.g. an indented 'Sources: https://...' line).",
    "End the response with a final 'Grounding:' line (on its own line) listing every " +
      "EVD-*/GAP-* id cited, e.g.: Grounding: EVD-001, GAP-A",
  ].join("\n");
}

export function buildTopicsUserPrompt(ctx: TopicsContext): string {
  const parts: string[] = [];

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

  if (ctx.jdText) {
    parts.push("JOB DESCRIPTION:", ...fenceUntrusted(ctx.jdText), "");
  }

  if (ctx.appRef) {
    parts.push(`APPLICATION REF: ${ctx.appRef}`, "");
  }

  parts.push("TOPIC CANDIDATES:");
  for (const c of ctx.candidates) {
    const kindLabel = `[${c.direction.toUpperCase()} / ${c.kind}]`;
    const gapRef = c.gapId ? ` (${c.gapId})` : "";
    parts.push(`  ${kindLabel} ${c.topic}${gapRef}`);
    for (const e of c.evidenceBundle) {
      parts.push(`    EVD: ${e.id} — ${e.why}`);
    }
  }
  parts.push("");

  if (ctx.evidenceDetails.length > 0) {
    parts.push("EVIDENCE DETAILS:");
    for (const e of ctx.evidenceDetails) {
      parts.push(
        `  [${e.id}] (${e.org}) ${e.claim}${e.detail ? " — " + e.detail : ""}`,
      );
      if (e.keywords.length > 0) {
        parts.push(`    keywords: ${e.keywords.join(", ")}`);
      }
    }
    parts.push("");
  }

  if (ctx.gaps.length > 0) {
    parts.push("GAP LEDGER:");
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
    "Research each candidate topic and produce the digest with the required headings. " +
      "Format each topic as a markdown list item starting with '- '. " +
      "Cite evidence ids (EVD-*, GAP-*) inline where relevant. " +
      "Never cite an id not listed above. " +
      "End with a 'Grounding:' line listing every EVD-*/GAP-* id cited.",
  );

  return parts.join("\n");
}

export async function topics(ctx: TopicsContext, llm: LlmPort): Promise<TopicsResult> {
  const systemPrompt = buildTopicsSystemPrompt(ctx.mode);
  const userPrompt = buildTopicsUserPrompt(ctx);
  const result = await llm.complete({
    role: "content-topics",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  return { markdown: result.content };
}
