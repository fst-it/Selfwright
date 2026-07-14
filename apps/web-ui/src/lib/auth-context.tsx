// Fetches the session's CSRF token once from GET /api/meta and holds it for
// every write in the tree (design requirement #3: "CSRF token fetched once
// from /api/meta and attached to all writes"). Login itself stays server-side
// (SSR /login page, untouched by this app) — this context only ever runs once
// a session cookie already exists, since /api/meta sits behind authMiddleware
// like every other /api/* route and a 401 here redirects to /login via
// lib/api.ts's request() helper.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { MetaResponseSchema, type MetaResponse } from "@selfwright/api-contract";
import { getJson } from "./api.js";

type AuthState =
  | { status: "loading" }
  | { status: "ready"; meta: MetaResponse }
  | { status: "error"; message: string };

const AuthContext = createContext<AuthState>({ status: "loading" });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    getJson("/api/meta", MetaResponseSchema)
      .then((meta) => {
        if (!cancelled) setState({ status: "ready", meta });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: err instanceof Error ? err.message : "Failed to load session" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

/** The session's CSRF token, or null while still loading / on error. */
export function useCsrfToken(): string | null {
  const state = useContext(AuthContext);
  return state.status === "ready" ? state.meta.csrfToken : null;
}

export function useAuthState(): AuthState {
  return useContext(AuthContext);
}
