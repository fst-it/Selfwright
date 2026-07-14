import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsPage from "../SettingsPage.js";
import { AuthProvider } from "../../lib/auth-context.js";
import { mockFetchRoutes } from "../../test/mock-fetch.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SettingsPage", () => {
  it("renders the current aging window and the full settings JSON", async () => {
    vi.stubGlobal("fetch", mockFetchRoutes({
      "/api/settings": { queue: { aging_window_days: 21 } },
      "/api/scan-targets": { targets: [] },
    }));
    render(
      <AuthProvider>
        <SettingsPage />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText(/days before a queue entry/i)).toHaveValue(21));
  });

  it("saves an updated aging window with the CSRF header", async () => {
    const fetchMock = mockFetchRoutes({
      "/api/settings": (init?: RequestInit) =>
        init?.method === "PUT"
          ? { settings: JSON.parse(init.body as string) as Record<string, unknown> }
          : { queue: { aging_window_days: 30 } },
      "/api/scan-targets": { targets: [] },
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <SettingsPage />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText(/days before a queue entry/i)).toHaveValue(30));

    const input = screen.getByLabelText(/days before a queue entry/i);
    await user.clear(input);
    await user.type(input, "14");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/settings",
        expect.objectContaining({
          method: "PUT",
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- vitest's expect.objectContaining(...) is typed `any`; test-assertion value only.
          headers: expect.objectContaining({ "X-CSRF-Token": "test-csrf-token" }),
        }),
      );
    });
  });

  it("shows a validation error for a non-positive aging window without calling the API", async () => {
    const fetchMock = mockFetchRoutes({
      "/api/settings": { queue: { aging_window_days: 30 } },
      "/api/scan-targets": { targets: [] },
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <SettingsPage />
      </AuthProvider>,
    );
    const input = await screen.findByLabelText(/days before a queue entry/i);
    await user.clear(input);
    await user.type(input, "0");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/positive integer/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/settings", expect.objectContaining({ method: "PUT" }));
  });

  it("renders the scan targets table when targets are present", async () => {
    vi.stubGlobal("fetch", mockFetchRoutes({
      "/api/settings": {},
      "/api/scan-targets": {
        targets: [
          { company: "Acme Corp", provider: "greenhouse" },
          { company: "Beta LLC", provider: "lever", disabled: true },
        ],
      },
    }));
    render(
      <AuthProvider>
        <SettingsPage />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());
    expect(screen.getByText("greenhouse")).toBeInTheDocument();
    expect(screen.getByText("Beta LLC")).toBeInTheDocument();
  });

  it("renders inbox and scan digest checkboxes checked by default when enabled_digests is absent", async () => {
    vi.stubGlobal("fetch", mockFetchRoutes({
      "/api/settings": {},
      "/api/scan-targets": { targets: [] },
    }));
    render(
      <AuthProvider>
        <SettingsPage />
      </AuthProvider>,
    );
    const inboxBox = await screen.findByRole("checkbox", { name: /inbox digest/i });
    const scanBox  = screen.getByRole("checkbox", { name: /scan digest/i });
    expect(inboxBox).toBeChecked();
    expect(scanBox).toBeChecked();
  });

  it("includes enabled_digests in the PUT body when inbox digest is unchecked", async () => {
    let capturedDigests: string[] | undefined = undefined;
    vi.stubGlobal("fetch", mockFetchRoutes({
      "/api/settings": (init?: RequestInit) => {
        if (init?.method === "PUT") {
          const parsed = JSON.parse(init.body as string) as {
            notifications?: { enabled_digests?: string[] };
          };
          capturedDigests = parsed.notifications?.enabled_digests;
          return { settings: parsed as Record<string, unknown> };
        }
        return {};
      },
      "/api/scan-targets": { targets: [] },
    }));
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <SettingsPage />
      </AuthProvider>,
    );

    const inboxBox = await screen.findByRole("checkbox", { name: /inbox digest/i });
    await user.click(inboxBox);
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(capturedDigests).toEqual(["scan"]);
    });
  });

  it("toggles a scan target's disabled flag and saves via PUT /api/scan-targets", async () => {
    const fetchMock = mockFetchRoutes({
      "/api/settings": {},
      "/api/scan-targets": (init?: RequestInit) =>
        init?.method === "PUT"
          ? { targets: (JSON.parse(init.body as string) as { targets: unknown[] }).targets }
          : { targets: [{ company: "Acme Corp", provider: "greenhouse", disabled: false }] },
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <SettingsPage />
      </AuthProvider>,
    );

    const checkbox = await screen.findByRole("checkbox", { name: /disable acme corp/i });
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    expect(checkbox).toBeChecked();

    await user.click(screen.getByRole("button", { name: /save targets/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/scan-targets",
        expect.objectContaining({
          method: "PUT",
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- vitest objectContaining typed any
          headers: expect.objectContaining({ "X-CSRF-Token": "test-csrf-token" }),
        }),
      );
    });
  });
});
