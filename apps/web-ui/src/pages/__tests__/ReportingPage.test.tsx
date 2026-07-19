import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import ReportingPage from "../ReportingPage.js";
import { mockFetchRoutes } from "../../test/mock-fetch.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ReportingPage", () => {
  it("renders north-star detail, channel outcomes, and by-status breakdown", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchRoutes({
        "/api/reporting": {
          northStar: { submitted: 5, interviews: 2, ratePerTen: 4 },
          channelOutcomes: [{ channel: "referral", submitted: 3, interviews: 2, rate: 0.67 }],
          byStatus: { applied: 8 },
          fitnessHistory: [{ runAt: "2026-07-01T00:00:00.000Z", passed: 28, failed: 0, skipped: 0 }],
        },
      }),
    );
    render(<ReportingPage />);
    await waitFor(() => expect(screen.getByText("Reporting")).toBeInTheDocument());
    expect(screen.getByText("5", { selector: "td" })).toBeInTheDocument();
    expect(screen.getByText("referral")).toBeInTheDocument();
    expect(screen.getByText("67%")).toBeInTheDocument();
  });

  it("shows 'No submitted applications yet' when channelOutcomes is empty", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchRoutes({
        "/api/reporting": {
          northStar: { submitted: 0, interviews: 0, ratePerTen: null },
          channelOutcomes: [],
          byStatus: {},
          fitnessHistory: [],
        },
      }),
    );
    render(<ReportingPage />);
    await waitFor(() => expect(screen.getByText(/No submitted applications yet/i)).toBeInTheDocument());
  });
});
