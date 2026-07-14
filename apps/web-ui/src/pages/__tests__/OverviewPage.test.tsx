import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import OverviewPage from "../OverviewPage.js";
import { mockFetchRoutes } from "../../test/mock-fetch.js";

const OVERVIEW_BODY = {
  northStar: { submitted: 3, interviews: 7, ratePerTen: 3.33 },
  fitnessHistory: [{ runAt: "2026-07-01T00:00:00.000Z", passed: 28, failed: 0, skipped: 0 }],
  inbox: { decideNow: 2, reviewSoon: 5, fyi: 9 },
  digestCount: 4,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OverviewPage", () => {
  it("shows a loading state, then renders north-star, fitness, and inbox summary stats", async () => {
    vi.stubGlobal("fetch", mockFetchRoutes({ "/api/overview": OVERVIEW_BODY }));
    render(<OverviewPage />);

    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);

    await waitFor(() => expect(screen.getByText("Overview")).toBeInTheDocument());
    expect(screen.getByText("3")).toBeInTheDocument(); // submitted
    expect(screen.getByText("7")).toBeInTheDocument(); // interviews
    expect(screen.getByText("3.33")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // decideNow
    expect(screen.getByText("9")).toBeInTheDocument(); // fyi
    expect(screen.getByText("4")).toBeInTheDocument(); // digestCount
  });

  it("renders an error banner when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "boom" } }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    render(<OverviewPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("boom"));
  });

  it("renders 'No fitness history available' when history is empty", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchRoutes({ "/api/overview": { ...OVERVIEW_BODY, fitnessHistory: [] } }),
    );
    render(<OverviewPage />);
    await waitFor(() => expect(screen.getByText(/No fitness history available/i)).toBeInTheDocument());
  });
});
