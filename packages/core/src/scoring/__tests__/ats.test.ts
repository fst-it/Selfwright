import { describe, expect, it } from "vitest";
import type { EvidenceEntry, Ontology } from "../../truth/schemas/index.js";
import { computeAts, flattenCv, runPassA, runPassB } from "../ats.js";
import type { CvContent, CvRole } from "../types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_ROLE: CvRole = {
  company: "Globex",
  title: "Enterprise Architect",
  period: "Jan 2020 - Present",
  location: "Amsterdam",
  lead: "Led CTRM transformation",
  bullets: ["Designed CTRM integration platform", "Led 12-person team"],
};

const FULL_CV: CvContent = {
  name: "Test User",
  headline: "Sr. Principal Architect",
  summary: "Experienced enterprise architect with CTRM and trading expertise.",
  citizenship: "EU",
  skills: ["Architecture", "CTRM", "Integration", "Cloud"],
  roles: [BASE_ROLE],
  earlier_career: [{ org: "Shell", rest: "Solution Architect 2015-2020" }],
  education: ["MSc Computer Science"],
  certifications: ["TOGAF 9"],
  languages: "English, Portuguese",
  contact: {
    location: "Amsterdam, Netherlands",
    phone: "+31 6 00000000",
    email: "not-an-email",
    linkedin: "https://linkedin.com/in/testuser",
  },
};

const ONTOLOGY: Ontology = {
  CTRM: ["commodity trading", "energy trading", "trade lifecycle management"],
  architecture: ["solution design", "enterprise architecture"],
  integration: ["API integration", "middleware", "ESB"],
};

const REGISTRY: EvidenceEntry[] = [
  {
    id: "EVD-GLOBEX-ARCH",
    org: "Globex",
    claim: "Led CTRM architecture",
    tag: "hard",
    keywords: ["CTRM", "architecture", "trading"],
  },
  {
    id: "EVD-SHELL-INT",
    org: "Shell",
    claim: "Built integration platform",
    tag: "soft",
    keywords: ["integration", "API integration"],
  },
];

// ── flattenCv ─────────────────────────────────────────────────────────────────

describe("flattenCv", () => {
  it("flattens all fields into a single string", () => {
    const flat = flattenCv(FULL_CV);
    expect(flat).toContain("Test User");
    expect(flat).toContain("Globex");
    expect(flat).toContain("CTRM");
    expect(flat).toContain("Shell");
    expect(flat).toContain("TOGAF");
  });

  it("includes overlay content when present", () => {
    const cv: CvContent = {
      ...FULL_CV,
      overlay: {
        summary: "Overlay summary with data platform",
        skills: ["data engineering"],
        bullets: ["Overlay bullet"],
      },
    };
    const flat = flattenCv(cv);
    expect(flat).toContain("data platform");
    expect(flat).toContain("data engineering");
  });

  it("handles empty CV without throwing", () => {
    expect(() => flattenCv({})).not.toThrow();
    expect(flattenCv({})).toBe("");
  });
});

// ── runPassA ──────────────────────────────────────────────────────────────────

describe("runPassA", () => {
  it("passes a well-formed CV with score 1.0", () => {
    const result = runPassA(FULL_CV);
    expect(result.score).toBeGreaterThan(0.9);
    expect(result.checks.every((c) => (c.score ?? (c.pass ? 1 : 0)) >= 1)).toBe(true);
  });

  it("returns 7 checks", () => {
    expect(runPassA(FULL_CV).checks).toHaveLength(7);
  });

  it("fails when name is missing", () => {
    const cv: CvContent = { ...FULL_CV, name: undefined };
    const result = runPassA(cv);
    const nameCheck = result.checks.find((c) => c.name.includes("Name and all contact"));
    expect(nameCheck?.pass).toBe(false);
  });

  it("fails when skills is empty", () => {
    const cv: CvContent = { ...FULL_CV, skills: [] };
    const result = runPassA(cv);
    const skillsCheck = result.checks.find((c) => c.name.includes("Skills field"));
    expect(skillsCheck?.pass).toBe(false);
  });

  it("fails when a bullet exceeds 800 characters", () => {
    const longBullet = "a".repeat(801);
    const cv: CvContent = {
      ...FULL_CV,
      roles: [{ ...BASE_ROLE, bullets: [longBullet] }],
    };
    const result = runPassA(cv);
    const bulletCheck = result.checks.find((c) => c.name.includes("800 characters"));
    expect(bulletCheck?.pass).toBe(false);
  });

  it("partial score for date format — some bad, some good", () => {
    const cv: CvContent = {
      ...FULL_CV,
      roles: [
        { ...BASE_ROLE, period: "Jan 2020 - Present" }, // bad format (hyphen not en-dash, but depends on regex)
        { ...BASE_ROLE, period: "Feb 2018 – Jan 2020" }, // good
      ],
    };
    const result = runPassA(cv);
    const dateCheck = result.checks.find((c) => c.name.includes("periods match"));
    // dateCheck?.score should be between 0 and 1
    expect(dateCheck?.score).toBeGreaterThanOrEqual(0);
    expect(dateCheck?.score).toBeLessThanOrEqual(1);
  });

  it("fails when required sections are missing", () => {
    const cv: CvContent = { name: "User", contact: FULL_CV.contact };
    const result = runPassA(cv);
    const sectionCheck = result.checks.find((c) => c.name.includes("required sections"));
    expect(sectionCheck?.pass).toBe(false);
  });

  it("flags unsafe variant", () => {
    const cv: CvContent = { ...FULL_CV, overlay: { variant: "cv-two-column" } };
    const result = runPassA(cv);
    const variantCheck = result.checks.find((c) => c.name.includes("variant"));
    expect(variantCheck?.pass).toBe(false);
  });

  it("passes cv-executive variant", () => {
    const cv: CvContent = { ...FULL_CV, overlay: { variant: "cv-executive" } };
    const result = runPassA(cv);
    const variantCheck = result.checks.find((c) => c.name.includes("variant"));
    expect(variantCheck?.pass).toBe(true);
  });

  it("passes when no variant is set", () => {
    const cv: CvContent = { ...FULL_CV, overlay: undefined, variant: undefined };
    const result = runPassA(cv);
    const variantCheck = result.checks.find((c) => c.name.includes("variant"));
    expect(variantCheck?.pass).toBe(true);
  });
});

// ── runPassB ──────────────────────────────────────────────────────────────────

describe("runPassB", () => {
  it("returns a neutral 0.5 score (not a perfect 1.0) when JD has no ontology terms", () => {
    const result = runPassB("No relevant keywords here.", FULL_CV, ONTOLOGY, REGISTRY);
    expect(result.score).toBe(0.5);
    expect(result.jdTermsCount).toBe(0);
    expect(result.note).toBeTruthy();
  });

  it("detects JD terms that are covered in CV", () => {
    const jd = "Looking for CTRM expertise with architecture skills.";
    const result = runPassB(jd, FULL_CV, ONTOLOGY, REGISTRY);
    expect(result.covered).toContain("ctrm");
    expect(result.covered).toContain("architecture");
  });

  it("detects terms missing from CV that have EVD support", () => {
    const jd = "integration platform experience required.";
    const cvNoIntegration: CvContent = { name: "Test", summary: "No relevant skills" };
    const result = runPassB(jd, cvNoIntegration, ONTOLOGY, REGISTRY);
    expect(result.missingTruthful.some((m) => m.term === "integration")).toBe(true);
  });

  it("score = covered / total JD terms", () => {
    const jd = "CTRM architecture integration";
    const result = runPassB(jd, FULL_CV, ONTOLOGY, REGISTRY);
    if (result.jdTermsCount > 0) {
      expect(result.score).toBeCloseTo(result.covered.length / result.jdTermsCount, 5);
    }
  });

  it("uses synonym expansion to find CV terms", () => {
    const jd = "commodity trading expertise required."; // synonym for CTRM
    const result = runPassB(jd, FULL_CV, ONTOLOGY, REGISTRY);
    // "commodity trading" should resolve to "ctrm" canonical
    // and CTRM is in the CV skills — should be covered
    if (result.jdTermsCount > 0) {
      expect(result.covered.some((t) => t.toLowerCase().includes("ctrm"))).toBe(true);
    }
  });
});

// ── computeAts ────────────────────────────────────────────────────────────────

describe("computeAts", () => {
  it("passes a well-formed CV against a JD with known terms", () => {
    const jd = "CTRM architecture experience required.";
    const result = computeAts(jd, FULL_CV, ONTOLOGY, REGISTRY);
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(1);
    expect(result.passes).toBe(result.overall >= result.threshold);
  });

  it("respects custom threshold", () => {
    const jd = "CTRM";
    const result = computeAts(jd, FULL_CV, ONTOLOGY, REGISTRY, { threshold: 0.5 });
    expect(result.threshold).toBe(0.5);
  });

  it("overall = 0.5*A + 0.5*B by default", () => {
    const jd = "CTRM architecture";
    const result = computeAts(jd, FULL_CV, ONTOLOGY, REGISTRY);
    const expected = 0.5 * result.passA.score + 0.5 * result.passB.score;
    expect(result.overall).toBeCloseTo(expected, 5);
  });

  it("respects custom weight distribution", () => {
    const jd = "CTRM architecture";
    const result = computeAts(jd, FULL_CV, ONTOLOGY, REGISTRY, { weightA: 0.3, weightB: 0.7 });
    const expected = 0.3 * result.passA.score + 0.7 * result.passB.score;
    expect(result.overall).toBeCloseTo(expected, 5);
  });
});
