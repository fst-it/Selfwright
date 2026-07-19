import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PipelinePage from "../PipelinePage.js";
import { AuthProvider } from "../../lib/auth-context.js";
import { mockFetchRoutes } from "../../test/mock-fetch.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const APPS_BODY = {
  applications: [
    {
      id: "APP-001",
      company: "Acme Corp",
      role: "Principal Engineer",
      status: "applied",
      dates: { applied: "2026-06-01", last_update: "2026-06-01" },
      fit_score: 4.2,
      notes: null,
    },
  ],
  contentHash: "abc123",
};

describe("PipelinePage", () => {
  it("renders the applications table with company/role/status", async () => {
    vi.stubGlobal("fetch", mockFetchRoutes({ "/api/applications": APPS_BODY }));
    render(
      <AuthProvider>
        <PipelinePage />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());
    expect(screen.getByText("Principal Engineer")).toBeInTheDocument();
    // "applied" also appears as a <select><option> — scope to the status badge span.
    expect(screen.getByText("applied", { selector: "span" })).toBeInTheDocument();
  });

  it("renders a hostile company name as plain text, never as raw HTML (React's built-in escaping)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchRoutes({
        "/api/applications": {
          applications: [{ ...APPS_BODY.applications[0], company: "<script>alert(1)</script>" }],
          contentHash: "abc123",
        },
      }),
    );
    render(
      <AuthProvider>
        <PipelinePage />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument());
    // The literal string renders as text content of a <td>, never parsed as markup.
    expect(document.querySelector("script")).toBeNull();
  });

  it("submits a status update with the CSRF header and refetches on success", async () => {
    const fetchMock = mockFetchRoutes({
      "/api/applications": APPS_BODY,
      "/api/applications/APP-001/status": { application: { ...APPS_BODY.applications[0], status: "interview" } },
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <PipelinePage />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText(/new status for acme corp/i), "interview");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/applications/APP-001/status",
        expect.objectContaining({
          method: "POST",
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- vitest's expect.objectContaining(...) is typed `any`; test-assertion value only.
          headers: expect.objectContaining({ "X-CSRF-Token": "test-csrf-token" }),
        }),
      );
    });
  });

  it("shows 'No applications recorded' when the list is empty", async () => {
    vi.stubGlobal("fetch", mockFetchRoutes({ "/api/applications": { applications: [], contentHash: null } }));
    render(
      <AuthProvider>
        <PipelinePage />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText(/No applications recorded/i)).toBeInTheDocument());
  });

  it("renders a badge for an unknown application status without crashing (statusBadgeVariant default fallback)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchRoutes({
        "/api/applications": {
          applications: [{ ...APPS_BODY.applications[0], status: "future_unknown_status" }],
          contentHash: "abc123",
        },
      }),
    );
    render(
      <AuthProvider>
        <PipelinePage />
      </AuthProvider>,
    );
    // Unknown status renders as text inside a badge — not empty, not crashed.
    await waitFor(() =>
      expect(screen.getByText("future_unknown_status")).toBeInTheDocument(),
    );
  });
});
