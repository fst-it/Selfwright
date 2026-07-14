import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QueuePage from "../QueuePage.js";
import { AuthProvider } from "../../lib/auth-context.js";
import { mockFetchRoutes } from "../../test/mock-fetch.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const QUEUE_BODY = {
  active: [{ id: "Q-001", company: "Gamma Inc", derived_role: "Senior Engineer", fit_score: 3.9 }],
  staleCount: 2,
  agingWindowDays: 30,
  contentHash: "queue-hash-abc123",
};

describe("QueuePage", () => {
  it("renders active entries and the stale count note", async () => {
    vi.stubGlobal("fetch", mockFetchRoutes({ "/api/queue": QUEUE_BODY }));
    render(
      <AuthProvider>
        <QueuePage />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText("Gamma Inc")).toBeInTheDocument());
    expect(screen.getByText(/2 stale/)).toBeInTheDocument();
  });

  it("promote: opens a confirm dialog, then POSTs /api/queue/:id/promote with the CSRF header and refetches", async () => {
    const fetchMock = mockFetchRoutes({
      "/api/queue": QUEUE_BODY,
      "/api/queue/Q-001/promote": { application: { id: "Q-001", company: "Gamma Inc", role: "Senior Engineer", status: "evaluating", dates: {} } },
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <QueuePage />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText("Gamma Inc")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Promote" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm promote" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/queue/Q-001/promote",
        expect.objectContaining({
          method: "POST",
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- vitest's expect.objectContaining(...) is typed `any`; test-assertion value only.
          headers: expect.objectContaining({ "X-CSRF-Token": "test-csrf-token" }),
          body: JSON.stringify({ contentHash: QUEUE_BODY.contentHash }),
        }),
      );
    });
  });

  it("dismiss: opens a confirm dialog with an honest no-resurface explanation, then POSTs /api/queue/:id/dismiss", async () => {
    const fetchMock = mockFetchRoutes({
      "/api/queue": QUEUE_BODY,
      "/api/queue/Q-001/dismiss": { dismissed: QUEUE_BODY.active[0] },
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <QueuePage />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText("Gamma Inc")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.getByText(/will not resurface/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm dismiss" }));

    await waitFor(() =>
      { expect(fetchMock).toHaveBeenCalledWith(
        "/api/queue/Q-001/dismiss",
        expect.objectContaining({ method: "POST" }),
      ); },
    );
  });

  it("shows 'Queue is empty' when there are no active entries", async () => {
    vi.stubGlobal("fetch", mockFetchRoutes({ "/api/queue": { active: [], staleCount: 0, agingWindowDays: 30, contentHash: null } }));
    render(
      <AuthProvider>
        <QueuePage />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText(/Queue is empty/i)).toBeInTheDocument());
  });

  it("sets data-density='compact' on the table wrapper when settings return compact density", async () => {
    vi.stubGlobal("fetch", mockFetchRoutes({
      "/api/queue": QUEUE_BODY,
      "/api/settings": { dashboard: { table_density: "compact" } },
    }));
    const { container } = render(
      <AuthProvider>
        <QueuePage />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText("Gamma Inc")).toBeInTheDocument());
    await waitFor(() => {
      const wrapper = container.querySelector('[data-density="compact"]');
      expect(wrapper).not.toBeNull();
    });
  });
});
