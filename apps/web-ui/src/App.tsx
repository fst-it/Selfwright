import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./lib/auth-context.js";
import { Layout } from "./components/Layout.js";
import OverviewPage from "./pages/OverviewPage.js";
import InboxPage from "./pages/InboxPage.js";
import PipelinePage from "./pages/PipelinePage.js";
import QueuePage from "./pages/QueuePage.js";
import CoachingPage from "./pages/CoachingPage.js";
import ContentPage from "./pages/ContentPage.js";
import ReportingPage from "./pages/ReportingPage.js";
import SettingsPage from "./pages/SettingsPage.js";
import { SettingsContractSchema } from "@selfwright/api-contract";

// Login stays server-side (apps/web/src/auth.ts's SSR /login page) — the
// Hono auth middleware guards every non-public path (including this SPA's
// static bundle) before any client route ever loads, so an unauthenticated
// visitor is redirected to /login before React mounts. This router therefore
// only ever needs authenticated routes.

// The landing page the owner has configured in settings.yml (dashboard.landing_page).
// "overview" is the default; non-null once settings are fetched.
const VALID_PAGES = ["overview","inbox","pipeline","queue","coaching","content","reporting","settings"] as const;
type Page = typeof VALID_PAGES[number];

function isValidPage(v: unknown): v is Page {
  return typeof v === "string" && (VALID_PAGES as readonly string[]).includes(v);
}

/** Reads dashboard settings once on mount (best-effort, never crashes). */
function useAppSettings(): { landingPage: Page; themeReady: boolean } {
  const [landingPage, setLandingPage] = useState<Page>("overview");
  const [themeReady, setThemeReady] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then<unknown>((r) => (r.ok ? r.json() : {}))
      .then((raw: unknown) => {
        const parsed = SettingsContractSchema.safeParse(raw);
        if (!parsed.success) return;
        const { dashboard } = parsed.data;
        // Apply theme to root — the CSS uses :root[data-theme="light|dark"]
        if (dashboard?.theme === "light" || dashboard?.theme === "dark") {
          document.documentElement.setAttribute("data-theme", dashboard.theme);
        } else {
          // "system" = let prefers-color-scheme handle it (remove explicit attribute)
          document.documentElement.removeAttribute("data-theme");
        }
        if (isValidPage(dashboard?.landing_page)) {
          setLandingPage(dashboard.landing_page);
        }
      })
      .catch(() => {
        // Best-effort: settings unavailable (not logged in yet, or network error).
        // Keep defaults — SPA still loads normally.
      })
      .finally(() => {
        setThemeReady(true);
      });
  }, []);

  return { landingPage, themeReady };
}

export default function App() {
  const { landingPage } = useAppSettings();

  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route
              index
              element={
                landingPage === "overview"
                  ? <OverviewPage />
                  : <Navigate to={`/${landingPage}`} replace />
              }
            />
            <Route path="inbox" element={<InboxPage />} />
            <Route path="pipeline" element={<PipelinePage />} />
            <Route path="queue" element={<QueuePage />} />
            <Route path="coaching" element={<CoachingPage />} />
            <Route path="content" element={<ContentPage />} />
            <Route path="reporting" element={<ReportingPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
