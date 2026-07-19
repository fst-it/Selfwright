import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CoachingPage from "../CoachingPage.js";
import { AuthProvider } from "../../lib/auth-context.js";
import { mockFetchRoutes } from "../../test/mock-fetch.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const COACHING_BODY = {
  debriefs: [{ application_id: "APP-002", date: "2026-06-15", round: "hiring manager", notes: "went okay" }],
  hasArchetype: true,
  nextDrill: {
    topicId: "system-design",
    kind: "gap",
    evidenceBundle: [{ id: "EVD-1", score: 0.9, tag: "hard", why: "relevant" }],
  },
  drillFiles: ["2026-06-01-drill.md"],
  prepPacks: ["target-co"],
};

describe("CoachingPage", () => {
  it("renders debriefs, next drill, drill files, and prep packs", async () => {
    vi.stubGlobal("fetch", mockFetchRoutes({ "/api/coaching": COACHING_BODY }));
    render(
      <AuthProvider>
        <CoachingPage />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText(/APP-002 — 2026-06-15/)).toBeInTheDocument());
    expect(screen.getByText("system-design")).toBeInTheDocument();
    expect(screen.getByText("2026-06-01-drill.md")).toBeInTheDocument();
    expect(screen.getByText("target-co")).toBeInTheDocument();
  });

  it("shows 'No archetypes configured' when hasArchetype is false", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchRoutes({ "/api/coaching": { ...COACHING_BODY, hasArchetype: false, nextDrill: null } }),
    );
    render(
      <AuthProvider>
        <CoachingPage />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText(/No archetypes configured/i)).toBeInTheDocument());
  });

  it("submits a debrief with the CSRF header and refetches", async () => {
    const fetchMock = mockFetchRoutes({
      "/api/coaching": { ...COACHING_BODY, debriefs: [] },
      "/api/debriefs": { debrief: { application_id: "APP-003", date: "2026-07-01" } },
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <CoachingPage />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText(/application id/i)).toBeInTheDocument());

    await user.type(screen.getByLabelText(/application id/i), "APP-003");
    await user.type(screen.getByLabelText(/interview date/i), "2026-07-01");
    await user.click(screen.getByRole("button", { name: /save debrief/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/debriefs",
        expect.objectContaining({
          method: "POST",
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- vitest's expect.objectContaining(...) is typed `any`; test-assertion value only.
          headers: expect.objectContaining({ "X-CSRF-Token": "test-csrf-token" }),
        }),
      );
    });
  });
});
