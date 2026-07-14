import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { Layout } from "../Layout.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function Page({ heading }: { heading: string }) {
  return <h1>{heading}</h1>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Page heading="Overview" />} />
          <Route path="/pipeline" element={<Page heading="Pipeline" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("Layout", () => {
  it("renders semantic landmarks: a header/nav and a main region", () => {
    renderAt("/");
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /main navigation/i })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("renders a skip-to-main-content link as the first focusable element", () => {
    renderAt("/");
    expect(screen.getByRole("link", { name: /skip to main content/i })).toHaveAttribute(
      "href",
      "#main-content",
    );
  });

  it("marks the current route's nav link as active", () => {
    renderAt("/pipeline");
    expect(screen.getByRole("link", { name: "Pipeline" })).toHaveClass("text-link");
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveClass("text-link");
  });

  it("moves focus to the main landmark on route change (a11y requirement)", async () => {
    renderAt("/");
    const user = userEvent.setup();
    await user.click(screen.getByRole("link", { name: "Pipeline" }));
    await waitFor(() => expect(screen.getByRole("main")).toHaveFocus());
  });

  it("logout button POSTs /logout and navigates to /login", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302 }));
    vi.stubGlobal("fetch", fetchMock);
    const assignSpy = vi.fn();
    // A plain object, not a spread of window.location (a host object whose
    // spread would lose its prototype) — only `assign` is ever called here.
    vi.stubGlobal("location", { assign: assignSpy });

    renderAt("/");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /logout/i }));

    await waitFor(() => { expect(fetchMock).toHaveBeenCalledWith("/logout", expect.objectContaining({ method: "POST" })); });
    expect(assignSpy).toHaveBeenCalledWith("/login");
  });
});
