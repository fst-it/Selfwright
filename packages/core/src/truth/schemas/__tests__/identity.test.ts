import { describe, it, expect } from "vitest";
import { IdentitySchema } from "../identity.js";

/**
 * Contact email and linkedin are stored as plain strings (no format enforcement)
 * so that test fixtures comply with the data-leak gate (no email-shaped values
 * in framework code). The real identity.yml in Selfwright-data holds the true values.
 */
const BASE_IDENTITY = {
  name: "Test User A",
  canonical_title: "Sr. Principal Data & Enterprise Architect",
  years_experience: 17,
  headline: "Technical leader specializing in data platforms.",
  seniority_equivalence: "Senior Staff / Principal",
  headline_policy: "Always include data and architecture.",
  also_known_as_titles: ["Data Architect", "Enterprise Architect"],
  cv_generation_rules: ["Use impact-first bullet structure."],
  education: [
    { degree: "MSc Information Systems Management", school: "University of Lisbon" },
  ],
  contact: {
    location: "Amsterdam, NL",
    phone: "+31 6 00000000",
    email: "contact-omitted-in-fixture",
    linkedin: "https://www.linkedin.com/in/test-fixture/",
  },
  citizenship: "Portuguese",
  relocation: ["Remote", "Amsterdam"],
  languages: { Portuguese: "native", English: "fluent", Dutch: "basic" },
  certifications: ["AWS Solutions Architect"],
  team_sizes: {
    company_a: { direct: 8, functional: "120+" },
  },
  roles_timeline: [
    { company: "Acme", title: "Senior Architect", period: "2020-present" },
  ],
  honesty_boundaries: ["Do not claim independent ML model training."],
  calibration: "Honest about seniority plateauing.",
};

describe("IdentitySchema", () => {
  it("parses a valid identity", () => {
    const result = IdentitySchema.parse(BASE_IDENTITY);
    expect(result.name).toBe("Test User A");
    expect(result.years_experience).toBe(17);
    expect(result.languages["Dutch"]).toBe("basic");
  });

  it("accepts optional show_year on education entry", () => {
    const result = IdentitySchema.parse({
      ...BASE_IDENTITY,
      education: [
        {
          degree: "MSc",
          school: "University of Lisbon",
          show_year: false,
        },
      ],
    });
    expect(result.education[0]?.show_year).toBe(false);
  });

  it("accepts optional banned_words_source", () => {
    const result = IdentitySchema.parse({
      ...BASE_IDENTITY,
      banned_words_source: "docs/banned-words.md",
    });
    expect(result.banned_words_source).toBe("docs/banned-words.md");
  });

  it("rejects empty email", () => {
    expect(() =>
      IdentitySchema.parse({
        ...BASE_IDENTITY,
        contact: { ...BASE_IDENTITY.contact, email: "" },
      }),
    ).toThrow();
  });

  it("rejects empty linkedin", () => {
    expect(() =>
      IdentitySchema.parse({
        ...BASE_IDENTITY,
        contact: { ...BASE_IDENTITY.contact, linkedin: "" },
      }),
    ).toThrow();
  });

  it("rejects zero years_experience", () => {
    expect(() =>
      IdentitySchema.parse({ ...BASE_IDENTITY, years_experience: 0 }),
    ).toThrow();
  });

  it("rejects empty name", () => {
    expect(() => IdentitySchema.parse({ ...BASE_IDENTITY, name: "" })).toThrow();
  });
});
