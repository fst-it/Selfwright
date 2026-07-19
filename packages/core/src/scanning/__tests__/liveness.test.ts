import { describe, expect, it } from "vitest";
import { checkLiveness } from "../liveness.js";

describe("checkLiveness", () => {
  it("classifies a 404/410 as expired regardless of body", () => {
    expect(checkLiveness("some short body", { httpStatus: 404 }).status).toBe("expired");
    expect(checkLiveness("some short body", { httpStatus: 410 }).status).toBe("expired");
  });

  it("classifies a Cloudflare bot-challenge page as uncertain, never expired", () => {
    const result = checkLiveness("Just a moment... Checking your browser before accessing.");
    expect(result.status).toBe("uncertain");
    expect(result.reason).toContain("bot challenge");
  });

  it("classifies a 403/503 as uncertain (access blocked), not expired", () => {
    expect(checkLiveness("some body", { httpStatus: 403 }).status).toBe("uncertain");
    expect(checkLiveness("some body", { httpStatus: 503 }).status).toBe("uncertain");
  });

  it("classifies a redirect to an error URL as expired", () => {
    const result = checkLiveness("some body", { finalUrl: "https://example.com/jobs?error=true" });
    expect(result.status).toBe("expired");
  });

  it("classifies an explicit 'no longer accepting applications' banner as expired", () => {
    const result = checkLiveness(
      "Thank you for your interest. This posting is no longer accepting applications.",
    );
    expect(result.status).toBe("expired");
  });

  it("classifies a real posting with a visible apply control as live", () => {
    const body =
      "Senior Enterprise Architect. We are looking for an experienced architect to join our team. " +
      "Responsibilities include leading architecture decisions. Apply now to join us.";
    const result = checkLiveness(body);
    expect(result.status).toBe("live");
  });

  it("classifies a listing/search page (not a single posting) as expired", () => {
    const result = checkLiveness("42 jobs found matching your search criteria across all locations.");
    expect(result.status).toBe("expired");
  });

  it("classifies very short content with no apply control as expired (nav/footer only)", () => {
    const result = checkLiveness("Page not loaded properly.");
    expect(result.status).toBe("expired");
  });

  it("classifies substantial content with no apply control as uncertain", () => {
    const body =
      "Senior Enterprise Architect. We are looking for an experienced architect to join our team. " +
      "Responsibilities include leading architecture decisions across a federated organisation and " +
      "working with senior stakeholders to define technology direction for the next several years. " +
      "The successful candidate will have deep experience in distributed systems, cloud platforms, " +
      "and enterprise integration patterns, plus a track record of leading senior technical teams.";
    expect(body.trim().length).toBeGreaterThanOrEqual(300);
    const result = checkLiveness(body);
    expect(result.status).toBe("uncertain");
  });
});
