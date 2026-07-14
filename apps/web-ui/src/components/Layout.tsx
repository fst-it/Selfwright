import { useEffect, useRef } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { cn } from "../lib/utils.js";

const NAV_ITEMS = [
  { to: "/", label: "Overview", end: true },
  { to: "/inbox", label: "Inbox", end: false },
  { to: "/pipeline", label: "Pipeline", end: false },
  { to: "/queue", label: "Queue", end: false },
  { to: "/coaching", label: "Coaching", end: false },
  { to: "/content", label: "Content", end: false },
  { to: "/reporting", label: "Reporting", end: false },
  { to: "/settings", label: "Settings", end: false },
] as const;

async function logout(): Promise<void> {
  await fetch("/logout", { method: "POST", credentials: "same-origin" });
  window.location.assign("/login");
}

export function Layout() {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  // Focus management on route change (a11y requirement): move focus to the
  // main landmark so assistive tech announces the new page, matching what a
  // full page navigation would have done under the old SSR dashboard.
  useEffect(() => {
    mainRef.current?.focus();
  }, [location.pathname]);

  return (
    <div className="min-h-full">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      <header className="border-b border-border bg-surface">
        <nav
          aria-label="Main navigation"
          className="mx-auto flex max-w-5xl flex-wrap items-center gap-1 px-4 py-3"
        >
          <img src="/brand-icon.png" alt="Selfwright" className="mr-2 h-7 w-7 rounded-full" />
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "rounded-md px-2.5 py-1.5 text-sm text-muted hover:bg-background hover:text-foreground",
                  // text-link, not text-primary: see tailwind.config.ts (verified contrast).
                  isActive && "bg-primary/15 text-link",
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-md border border-border px-2.5 py-1.5 text-sm text-muted hover:border-muted hover:text-foreground"
          >
            Logout
          </button>
        </nav>
      </header>
      <main
        id="main-content"
        ref={mainRef}
        tabIndex={-1}
        className="mx-auto max-w-5xl px-4 py-6 focus:outline-none"
      >
        <Outlet />
      </main>
    </div>
  );
}
