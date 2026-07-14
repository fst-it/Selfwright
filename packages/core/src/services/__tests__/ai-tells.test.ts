import { describe, expect, it } from "vitest";
import { BANNED_AI_TELLS, scanAiTells } from "../ai-tells.js";
import { validateCoverArtifact } from "../generation-guard.js";
import type { EvidenceEntry, Identity } from "../../truth/schemas/index.js";

// ── Shared fixtures for integration tests ────────────────────────────────────

const REGISTRY: EvidenceEntry[] = [
  {
    id: "EVD-SYN-AITELLS-001",
    org: "SyntheticCo",
    claim: "Led the CTRM trading platform integration and architecture",
    tag: "hard",
    keywords: ["ctrm", "trading", "platform", "architecture", "integration"],
  },
];

const IDENTITY: Identity = {
  name: "Test User",
  canonical_title: "Architect",
  years_experience: 10,
  headline: "Enterprise Architect",
  seniority_equivalence: "Senior",
  headline_policy: "None",
  also_known_as_titles: [],
  cv_generation_rules: [],
  education: [],
  contact: {
    location: "Amsterdam",
    phone: "555-0100",
    email: "user@localhost",
    linkedin: "https://linkedin.com/in/test",
  },
  citizenship: "EU",
  relocation: [],
  languages: {},
  certifications: [],
  team_sizes: {},
  roles_timeline: [{ company: "SyntheticCo", title: "Architect", period: "2020–present" }],
  honesty_boundaries: [],
  calibration: "None",
};

const TRACEABLE_SENTENCE =
  "I led the CTRM trading platform integration and architecture work for the enterprise.";
const FILLER_SENTENCE = "I am not that or this.";

function buildLetter(opening: string, fillerCount: number): string {
  const filler = Array.from({ length: fillerCount }, () => FILLER_SENTENCE).join(" ");
  return `${opening} ${filler}`;
}

// ── BANNED_AI_TELLS list ──────────────────────────────────────────────────────

describe("BANNED_AI_TELLS", () => {
  it("is a non-empty array", () => {
    expect(BANNED_AI_TELLS.length).toBeGreaterThan(0);
  });

  it("every entry has a label and a match field", () => {
    for (const entry of BANNED_AI_TELLS) {
      expect(typeof entry.label).toBe("string");
      expect(entry.label.length).toBeGreaterThan(0);
      expect(typeof entry.match === "string" || entry.match instanceof RegExp).toBe(true);
    }
  });
});

// ── scanAiTells unit tests ─────────────────────────────────────────────────────

describe("scanAiTells", () => {
  it("returns empty array for clean text", () => {
    expect(scanAiTells("I led the platform integration and architecture work.")).toEqual([]);
  });

  it("detects 'delve' and 'delving' (stem 'delv' catches all inflections)", () => {
    const v1 = scanAiTells("We must delve deeper into the problem space.");
    expect(v1.some((v) => v.includes("delve"))).toBe(true);
    const v2 = scanAiTells("We were delving deeper into the problem space.");
    expect(v2.some((v) => v.includes("delve"))).toBe(true);
  });

  it("detects 'tapestry' (noun tell)", () => {
    const violations = scanAiTells("The rich tapestry of experience I bring to the role.");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.includes("tapestry"))).toBe(true);
  });

  it("detects 'synergies' (noun tell)", () => {
    const violations = scanAiTells("I delivered synergies across teams.");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.includes("synergies"))).toBe(true);
  });

  it("detects 'synergy' (singular noun tell)", () => {
    const violations = scanAiTells("We aim for synergy between departments.");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.toLowerCase().includes("synergy"))).toBe(true);
  });

  it("detects 'seamlessly' (adjective tell)", () => {
    const violations = scanAiTells("The project ran seamlessly from day one.");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.includes("seamlessly"))).toBe(true);
  });

  it("detects 'In today's' opener (case-insensitive)", () => {
    const violations = scanAiTells("In today's competitive landscape, candidates must stand out.");
    expect(violations.some((v) => v.includes("today's"))).toBe(true);
  });

  it("detects 'in the ever-evolving' opener (case-insensitive)", () => {
    const violations = scanAiTells("In the ever-evolving tech sector, adaptability matters.");
    expect(violations.some((v) => v.includes("ever-evolving"))).toBe(true);
  });

  it("detects 'it's important to note'", () => {
    const violations = scanAiTells("It's important to note that I have over 10 years of experience.");
    expect(violations.some((v) => v.includes("important to note"))).toBe(true);
  });

  it("detects 'In conclusion,' closer (with trailing punctuation)", () => {
    expect(scanAiTells("In conclusion, I am the ideal candidate.").some((v) => v.includes("conclusion"))).toBe(true);
    expect(scanAiTells("In conclusion. I am the ideal candidate.").some((v) => v.includes("conclusion"))).toBe(true);
    expect(scanAiTells("In conclusion: the above makes me an ideal candidate.").some((v) => v.includes("conclusion"))).toBe(true);
  });

  it("does NOT flag 'in conclusion' without trailing punctuation (avoids mid-sentence false positive)", () => {
    expect(scanAiTells("They arrived in conclusion of the lengthy process.")).toEqual([]);
  });

  it("detects 'In summary,' and 'In summary.' (anchored closer)", () => {
    expect(scanAiTells("In summary, I am the ideal candidate.").some((v) => v.includes("summary"))).toBe(true);
    expect(scanAiTells("In summary. I am the ideal candidate.").some((v) => v.includes("summary"))).toBe(true);
  });

  it("does NOT flag 'in summary form' (anchor prevents false positive)", () => {
    expect(scanAiTells("Please provide results in summary form.")).toEqual([]);
  });

  it("detects 'let's dive in' phrase", () => {
    const violations = scanAiTells("Let's dive in to the details of my experience.");
    expect(violations.some((v) => v.includes("dive in"))).toBe(true);
  });

  it("detects negation pivot 'not just ... but'", () => {
    const violations = scanAiTells(
      "I am not just a developer but a strategic thinker.",
    );
    expect(violations.some((v) => v.includes("not just"))).toBe(true);
  });

  it("detects negation pivot spanning a newline (dotall flag)", () => {
    const violations = scanAiTells("I am not just a developer,\nbut a strategic thinker.");
    expect(violations.some((v) => v.includes("not just"))).toBe(true);
  });

  it("detects 'Importantly,' tone marker", () => {
    const violations = scanAiTells("Importantly, I bring cross-functional collaboration skills.");
    expect(violations.some((v) => v.includes("Importantly"))).toBe(true);
  });

  it("is case-insensitive for string matches", () => {
    expect(scanAiTells("DELVE into the matter").length).toBeGreaterThan(0);
    expect(scanAiTells("DELVING into the matter").length).toBeGreaterThan(0);
    expect(scanAiTells("TAPESTRY of skills").length).toBeGreaterThan(0);
  });

  it("detects multiple tells in one text", () => {
    const violations = scanAiTells(
      "In today's world, let's dive in. Importantly, I have synergies. In summary.",
    );
    expect(violations.length).toBeGreaterThanOrEqual(4);
  });

  it("does not detect false positives in clean career language", () => {
    // Common finance/tech phrases that must not be flagged
    expect(scanAiTells("I managed the financial leverage ratios for the portfolio.")).toEqual([]);
    expect(scanAiTells("The system architecture spans three data centres.")).toEqual([]);
    expect(scanAiTells("I summarised the results and presented them to the board.")).toEqual([]);
  });
});

// ── Integration: validateCoverArtifact with AI-tell detection ─────────────────

describe("validateCoverArtifact: AI-tell detection", () => {
  it("passes a clean 350-400 word cover letter with no AI tells", () => {
    const text = buildLetter(TRACEABLE_SENTENCE, 60); // ~375 words
    const result = validateCoverArtifact(text, { registry: REGISTRY, identity: IDENTITY, drifts: [] });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("fails a cover letter containing a banned AI-tell phrase", () => {
    // "Let's dive in." = 3 extra words → 378 total, still within 350-400
    const opening = `${TRACEABLE_SENTENCE} Let's dive in.`;
    const text = buildLetter(opening, 60);
    const result = validateCoverArtifact(text, { registry: REGISTRY, identity: IDENTITY, drifts: [] });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.toLowerCase().includes("ai-tell"))).toBe(true);
  });

  it("fail message identifies the specific tell", () => {
    const opening = `${TRACEABLE_SENTENCE} The tapestry of my experience is vast.`;
    // 15 + 7 = 22 words + 60 * 6 = 382 total
    const text = buildLetter(opening, 60);
    const result = validateCoverArtifact(text, { registry: REGISTRY, identity: IDENTITY, drifts: [] });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("tapestry"))).toBe(true);
  });
});
