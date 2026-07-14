import { describe, expect, it } from "vitest";
import { ats } from "../ats.js";
import type { AtsInput } from "../types.js";
import type { CvContent } from "../../scoring/types.js";

const CV: CvContent = {
  name: "Test User",
  headline: "Enterprise Architect",
  summary: "CTRM and trading expertise",
  citizenship: "EU",
  skills: ["Architecture", "CTRM"],
  roles: [
    {
      company: "Globex",
      title: "Enterprise Architect",
      period: "Jan 2020 – Present",
      location: "Amsterdam",
      bullets: ["Led CTRM platform"],
    },
  ],
  earlier_career: [{ org: "Shell", rest: "Architect 2015" }],
  education: ["MSc CS"],
  certifications: ["TOGAF"],
  languages: "English",
  contact: {
    location: "Amsterdam",
    phone: "+31 6 0000",
    email: "test@example.com",
    linkedin: "https://linkedin.com/in/test",
  },
};

const BASE_INPUT: AtsInput = {
  jdText: "Looking for CTRM architecture expertise.",
  cv: CV,
  evidenceRegistry: [],
  ontology: { CTRM: ["commodity trading"], architecture: ["solution design"] },
};

describe("ats service", () => {
  it("returns an AtsResult with passA, passB and overall", () => {
    const result = ats(BASE_INPUT);
    expect(result).toBeDefined();
    expect(result.passA).toBeDefined();
    expect(result.passB).toBeDefined();
    expect(typeof result.overall).toBe("number");
  });

  it("overall is between 0 and 1", () => {
    const result = ats(BASE_INPUT);
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(1);
  });

  it("respects custom threshold", () => {
    const highThreshold = ats({ ...BASE_INPUT, opts: { threshold: 0.99 } });
    expect(highThreshold.threshold).toBe(0.99);
    const lowThreshold = ats({ ...BASE_INPUT, opts: { threshold: 0.01 } });
    expect(lowThreshold.passes).toBe(true);
  });

  it("threshold defaults to 0.8", () => {
    const result = ats(BASE_INPUT);
    expect(result.threshold).toBe(0.8);
  });
});
