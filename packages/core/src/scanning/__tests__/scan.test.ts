import { describe, expect, it } from "vitest";
import { evaluatePosting } from "../scan.js";
import type { Archetype } from "../../truth/schemas/index.js";
import type { RawPosting } from "../types.js";

const ARCHETYPES: Archetype[] = [
  {
    id: "enterprise-architect",
    related_titles: ["Director of Architecture", "Head of Architecture"],
    match_keywords: ["enterprise architecture", "tech radar", "platform engineering"],
  },
];

function posting(overrides: Partial<RawPosting> = {}): RawPosting {
  return {
    url: "https://boards-api.greenhouse.io/v1/boards/acme/jobs/123",
    title: "Director of Architecture",
    company: "Acme",
    location: "Amsterdam, NL",
    description:
      "We are hiring a Director of Architecture to own enterprise architecture, the tech radar " +
      "and platform engineering across the company. Apply now to join our team.",
    source: "greenhouse",
    fetchedAt: "2026-07-03T00:00:00.000Z",
    ...overrides,
  };
}

describe("evaluatePosting", () => {
  it("combines liveness and scan-time fit for a live, matching posting", () => {
    const result = evaluatePosting(posting(), ARCHETYPES, new Map());
    expect(result.liveness.status).toBe("live");
    expect(result.archetype).toBe("enterprise-architect");
    expect(result.fitScore).toBeGreaterThan(0);
  });

  it("still scores a posting whose description reads as expired", () => {
    const result = evaluatePosting(
      posting({ description: "This job posting has expired. No longer accepting applications." }),
      ARCHETYPES,
      new Map(),
    );
    expect(result.liveness.status).toBe("expired");
    // Scoring still runs — the caller decides whether to skip expired postings.
    expect(result.archetype).toBe("enterprise-architect");
  });

  it("returns a null archetype when no archetype matches", () => {
    const result = evaluatePosting(posting({ title: "Barista", description: "" }), [], new Map());
    expect(result.archetype).toBeNull();
  });

  it("uses the posting's own httpStatus for liveness (403 -> uncertain, not text-pattern expired)", () => {
    // Short, content-free body that would otherwise hit the "insufficient
    // content" -> expired branch on text alone; httpStatus must short-circuit
    // to "uncertain" (access blocked, likely anti-bot) before that check runs.
    const result = evaluatePosting(posting({ description: "Access Denied", httpStatus: 403 }), ARCHETYPES, new Map());
    expect(result.liveness.status).toBe("uncertain");
  });

  it("classifies a 404 posting as expired via the observed httpStatus", () => {
    const result = evaluatePosting(posting({ description: "", httpStatus: 404 }), ARCHETYPES, new Map());
    expect(result.liveness.status).toBe("expired");
  });

  it("lets an explicit livenessOpts argument override the posting's own httpStatus", () => {
    const result = evaluatePosting(posting({ httpStatus: 404 }), ARCHETYPES, new Map(), { httpStatus: 200 });
    expect(result.liveness.status).not.toBe("expired");
  });

  it("classifies a structured-provider posting with no description as live (ATS API is live by construction)", () => {
    // Reproduces the first-scan bug: ATS JSON-API providers return postings with
    // title/url/location but no description; checkLiveness("", {}) classified them
    // all "expired" (insufficient content), draining the queue to 0.
    // Construct directly — exactOptionalPropertyTypes forbids passing `description: undefined`.
    const structuredPosting: import("../types.js").RawPosting = {
      url: "https://boards-api.greenhouse.io/v1/boards/acme/jobs/123",
      title: "Director of Architecture",
      company: "Acme",
      location: "Amsterdam, NL",
      source: "greenhouse",
      sourceKind: "structured",
      fetchedAt: "2026-07-03T00:00:00.000Z",
    };
    const result = evaluatePosting(structuredPosting, ARCHETYPES, new Map());
    expect(result.liveness.status).toBe("live");
    expect(result.liveness.reason).toMatch(/structured ATS/i);
  });

  it("still applies text-based liveness to scraped/generic postings (sourceKind: 'scraped')", () => {
    // The generic provider sets sourceKind: "scraped" — its content heuristics
    // must still run (a bot-wall returning short text should stay "uncertain").
    const result = evaluatePosting(
      posting({ description: "Access Denied", httpStatus: 403, sourceKind: "scraped" }),
      ARCHETYPES,
      new Map(),
    );
    expect(result.liveness.status).toBe("uncertain");
  });
});
