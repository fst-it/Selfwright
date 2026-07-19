import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import ContentPage from "../ContentPage.js";
import { mockFetchRoutes } from "../../test/mock-fetch.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ContentPage", () => {
  it("renders the digest list and the latest digest inline", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchRoutes({
        "/api/content": {
          digests: ["2026-07-01-week.md"],
          latestDigest: { file: "2026-07-01-week.md", content: "# Week digest\n\nSome content." },
        },
      }),
    );
    render(<ContentPage />);
    await waitFor(() => expect(screen.getByText("2026-07-01-week.md")).toBeInTheDocument());
    expect(screen.getByText(/Some content/)).toBeInTheDocument();
  });

  it("shows 'No content digests found' when empty", async () => {
    vi.stubGlobal("fetch", mockFetchRoutes({ "/api/content": { digests: [], latestDigest: null } }));
    render(<ContentPage />);
    await waitFor(() => expect(screen.getByText(/No content digests found/i)).toBeInTheDocument());
  });
});
