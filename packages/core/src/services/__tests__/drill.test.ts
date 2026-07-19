import { describe, expect, it, vi } from "vitest";
import { buildDrillSystemPrompt, buildDrillUserPrompt, drill } from "../drill.js";
import type { DrillContext } from "../drill.js";
import type { Identity, EvidenceEntry, EvidenceTag } from "../../truth/schemas/index.js";
import type { DrillSelection } from "../../coaching/index.js";
import type { LlmPort, LlmRequest, LlmResult } from "../../ports/llm.js";

function entry(opts: { id: string; claim: string; tag?: EvidenceTag; keywords?: string[]; org?: string; detail?: string }): EvidenceEntry {
  return {
    id: opts.id,
    org: opts.org ?? "Acme",
    claim: opts.claim,
    tag: opts.tag ?? "soft",
    keywords: opts.keywords ?? [],
    ...(opts.detail !== undefined ? { detail: opts.detail } : {}),
  };
}

const IDENTITY: Identity = {
  name: "Ada Lovelace",
  canonical_title: "Principal Engineer",
  years_experience: 12,
  headline: "Principal Engineer",
  seniority_equivalence: "Senior",
  headline_policy: "None",
  also_known_as_titles: [],
  cv_generation_rules: [],
  education: [],
  contact: {
    location: "Amsterdam",
    phone: "+31000000000",
    email: "ada@example.com",
    linkedin: "https://linkedin.com/in/ada",
  },
  citizenship: "EU",
  relocation: [],
  languages: {},
  certifications: [],
  team_sizes: {},
  roles_timeline: [{ company: "Acme", title: "Principal Engineer", period: "2020–present" }],
  honesty_boundaries: [],
  calibration: "None",
};

const EVD_1 = entry({
  id: "EVD-001",
  claim: "Led treasury settlement operations",
  detail: "Owned the settlement reconciliation pipeline",
  tag: "hard",
  keywords: ["treasury", "settlement"],
});

const EVD_2 = entry({ id: "EVD-002", claim: "Credit risk dashboard rollout", tag: "soft" });

const GAP_SELECTION: DrillSelection = {
  topicId: "GAP-A",
  kind: "gap",
  gap: {
    id: "GAP-A",
    title: "treasury settlement gap",
    honest_gap: "Limited treasury experience",
    frame: "Treasury project exposure via adjacent work",
    tag: "soft",
    evidence_ids: ["EVD-001"],
    company_specific: false,
  },
  evidenceBundle: [{ id: "EVD-001", score: 3, tag: "hard", why: "treasury, settlement" }],
};

const STRETCH_SELECTION: DrillSelection = {
  topicId: "credit risk",
  kind: "stretch",
  evidenceBundle: [{ id: "EVD-002", score: 1, tag: "soft", why: "credit" }],
};

describe("buildDrillSystemPrompt", () => {
  it("requires the exact heading structure and a Grounding line", () => {
    const prompt = buildDrillSystemPrompt();
    expect(prompt).toContain("## Question");
    expect(prompt).toContain("## My answer");
    expect(prompt).toContain("## Coach critique");
    expect(prompt).toContain("Grounding:");
  });

  it("instructs the coach to probe the gap's title directly when the topic is a gap", () => {
    const prompt = buildDrillSystemPrompt();
    expect(prompt.toLowerCase()).toContain("gap");
    expect(prompt).toMatch(/gap[^.]*title/i);
  });

  it("states the hard rule against inventing facts outside the evidence", () => {
    const prompt = buildDrillSystemPrompt();
    expect(prompt.toLowerCase()).toContain("never invent facts");
  });

  it("instructs the coach not to reveal the model answer in the question itself", () => {
    const prompt = buildDrillSystemPrompt();
    expect(prompt.toLowerCase()).toContain("do not reveal the model answer");
  });
});

describe("buildDrillUserPrompt", () => {
  it("includes the topic, kind, and identity context", () => {
    const ctx: DrillContext = { selection: STRETCH_SELECTION, identity: IDENTITY, evidenceDetails: [EVD_2] };
    const prompt = buildDrillUserPrompt(ctx);
    expect(prompt).toContain("TOPIC: credit risk");
    expect(prompt).toContain("KIND: stretch");
    expect(prompt).toContain("Name: Ada Lovelace");
    expect(prompt).toContain("Canonical title: Principal Engineer");
  });

  it("includes GAP DETAILS only when kind is 'gap' and a gap is present", () => {
    const gapCtx: DrillContext = { selection: GAP_SELECTION, identity: IDENTITY, evidenceDetails: [EVD_1] };
    const gapPrompt = buildDrillUserPrompt(gapCtx);
    expect(gapPrompt).toContain("GAP DETAILS:");
    expect(gapPrompt).toContain("Title: treasury settlement gap");
    expect(gapPrompt).toContain("Honest gap: Limited treasury experience");
    expect(gapPrompt).toContain("Suggested frame: Treasury project exposure via adjacent work");
  });

  it("omits GAP DETAILS for stretch/strength selections (no gap object)", () => {
    const stretchCtx: DrillContext = { selection: STRETCH_SELECTION, identity: IDENTITY, evidenceDetails: [EVD_2] };
    const stretchPrompt = buildDrillUserPrompt(stretchCtx);
    expect(stretchPrompt).not.toContain("GAP DETAILS:");
  });

  it("includes the target archetype only when archetypeId is provided", () => {
    const withArchetype: DrillContext = {
      selection: STRETCH_SELECTION,
      identity: IDENTITY,
      archetypeId: "arch-1",
      evidenceDetails: [EVD_2],
    };
    expect(buildDrillUserPrompt(withArchetype)).toContain("TARGET ARCHETYPE: arch-1");

    const withoutArchetype: DrillContext = {
      selection: STRETCH_SELECTION,
      identity: IDENTITY,
      evidenceDetails: [EVD_2],
    };
    expect(buildDrillUserPrompt(withoutArchetype)).not.toContain("TARGET ARCHETYPE");
  });

  it("renders each evidence bundle entry with id, org, claim, detail, and keywords", () => {
    const ctx: DrillContext = { selection: GAP_SELECTION, identity: IDENTITY, evidenceDetails: [EVD_1] };
    const prompt = buildDrillUserPrompt(ctx);
    expect(prompt).toContain(
      "[EVD-001] (Acme) Led treasury settlement operations — Owned the settlement reconciliation pipeline",
    );
    expect(prompt).toContain("keywords: treasury, settlement");
  });

  it("omits the detail suffix and keywords line when an evidence entry has neither", () => {
    const ctx: DrillContext = { selection: STRETCH_SELECTION, identity: IDENTITY, evidenceDetails: [EVD_2] };
    const prompt = buildDrillUserPrompt(ctx);
    expect(prompt).toContain("[EVD-002] (Acme) Credit risk dashboard rollout");
    expect(prompt).not.toContain("Credit risk dashboard rollout —");
    expect(prompt).not.toContain("keywords:");
  });

  it("instructs the model to cite only evidence ids from the bundle", () => {
    const ctx: DrillContext = { selection: GAP_SELECTION, identity: IDENTITY, evidenceDetails: [EVD_1] };
    const prompt = buildDrillUserPrompt(ctx);
    expect(prompt.toLowerCase()).toContain("cite only evidence ids from the bundle");
  });
});

describe("drill", () => {
  it("calls the LlmPort with the coaching-drill role and the built prompts, returning its content as markdown", async () => {
    const completeMock = vi
      .fn<(req: LlmRequest) => Promise<LlmResult>>()
      .mockResolvedValue({ content: "## Question\n...", usage: { inputTokens: 1, outputTokens: 1 } });
    const llm: LlmPort = { complete: completeMock };
    const ctx: DrillContext = { selection: GAP_SELECTION, identity: IDENTITY, evidenceDetails: [EVD_1] };

    const result = await drill(ctx, llm);

    expect(result.markdown).toBe("## Question\n...");
    expect(completeMock).toHaveBeenCalledTimes(1);
    const call = completeMock.mock.calls[0]?.[0];
    expect(call?.role).toBe("coaching-drill");
    expect(call?.messages).toEqual([
      { role: "system", content: buildDrillSystemPrompt() },
      { role: "user", content: buildDrillUserPrompt(ctx) },
    ]);
  });
});
