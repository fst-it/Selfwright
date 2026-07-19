import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App from "../App.js";
import { mockFetchRoutes } from "../test/mock-fetch.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("mounts the router shell and renders the Overview page by default", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchRoutes({
        "/api/overview": {
          northStar: { submitted: 0, interviews: 0, ratePerTen: null },
          fitnessHistory: [],
          inbox: { decideNow: 0, reviewSoon: 0, fyi: 0 },
          digestCount: 0,
        },
      }),
    );
    render(<App />);
    expect(screen.getByRole("navigation", { name: /main navigation/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument());
  });
});
