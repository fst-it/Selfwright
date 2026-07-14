import { useCallback, useEffect, useState } from "react";
import type { z } from "zod";
import { getJson, ApiError } from "./api.js";

export type QueryState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

/**
 * Fetch + validate a GET /api/* endpoint, re-running whenever `path` changes.
 * Returns a `refetch` callback so write actions (promote/dismiss/status
 * update/debrief) can refresh the page's data after a successful write
 * without a full reload.
 */
export function useApiQuery<T>(path: string, schema: z.ZodType<T>): QueryState<T> & { refetch: () => void } {
  const [state, setState] = useState<QueryState<T>>({ status: "loading" });
  const [version, setVersion] = useState(0);

  const load = useCallback(() => {
    let cancelled = false;
    setState({ status: "loading" });
    getJson(path, schema)
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof ApiError ? err.message : "Failed to load data";
        setState({ status: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [path, schema]);

  useEffect(() => load(), [load, version]);

  return { ...state, refetch: () => { setVersion((v) => v + 1); } };
}
