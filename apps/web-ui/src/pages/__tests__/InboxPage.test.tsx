import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import InboxPage from "../InboxPage.js";
import { mockFetchRoutes } from "../../test/mock-fetch.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("InboxPage", () => {
  it("renders the three tiers with their items", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchRoutes({
        "/api/inbox": {
          asOf: "2026-07-13T00:00:00.000Z",
          decideNow: [{ kind: "application", id: "A-1", title: "Acme — Engineer", detail: "Interview scheduled" }],
          reviewSoon: [{ kind: "queue", id: "Q-1", title: "Beta — Staff Engineer", detail: "High-fit queue entry" }],
          fyi: [],
        },
      }),
    );
    render(<InboxPage />);
    await waitFor(() => expect(screen.getByText("Acme — Engineer")).toBeInTheDocument());
    expect(screen.getByText("Interview scheduled")).toBeInTheDocument();
    expect(screen.getByText("Beta — Staff Engineer")).toBeInTheDocument();
    expect(screen.getByText("Nothing here.")).toBeInTheDocument();
  });
});
