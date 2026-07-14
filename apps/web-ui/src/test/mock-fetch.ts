import { vi } from "vitest";

type RouteHandler = ((init?: RequestInit) => unknown) | Record<string, unknown> | unknown[];

const DEFAULT_META = {
  contractVersion: "1.0.0",
  platformVersion: "0.6.0",
  status: "ok",
  csrfToken: "test-csrf-token",
};

function toUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/**
 * A minimal path-routed fetch mock for component tests. Every test needs
 * GET /api/meta mocked (AuthProvider fetches it on mount) — included by
 * default so individual tests only need to declare the routes they exercise.
 */
export function mockFetchRoutes(routes: Record<string, RouteHandler>): ReturnType<typeof vi.fn> {
  const withMeta: Record<string, RouteHandler> = { "/api/meta": DEFAULT_META, ...routes };
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = toUrl(input);
    const path = url.split("?")[0] ?? url;
    const handler = withMeta[path];
    if (handler === undefined) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: `no mock for ${path}` } }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    const body = typeof handler === "function" ? handler(init) : handler;
    return Promise.resolve(
      new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
  });
}
