// Thin fetch wrapper for the /api/* JSON contract (T5.10). Every response is
// validated with the exact zod schema published by @selfwright/api-contract
// before the caller ever sees it — the cockpit consumes ONLY /api/*, never a
// direct core/adapter import, so this file (plus the schemas it imports) is
// the entire boundary between the UI and the server.
import type { z } from "zod";
import { ApiErrorEnvelopeSchema } from "@selfwright/api-contract";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Session expiry -> clean redirect to login (design requirement #3). A 401
 * from any /api/* call means the session cookie is gone or expired; there is
 * nothing a client-side route can recover from, so this is a full-page
 * navigation to the (still server-rendered) /login page, not a client route.
 */
function redirectToLogin(): never {
  window.location.assign("/login");
  throw new ApiError("UNAUTHORIZED", "Authentication required", 401);
}

async function request(path: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(path, { ...init, credentials: "same-origin" });
  if (res.status === 401) {
    redirectToLogin();
  }

  const contentType = res.headers.get("content-type") ?? "";
  const body: unknown = contentType.includes("application/json") ? await res.json() : null;

  if (!res.ok) {
    const parsed = ApiErrorEnvelopeSchema.safeParse(body);
    if (parsed.success) {
      throw new ApiError(parsed.data.error.code, parsed.data.error.message, res.status);
    }
    throw new ApiError("INTERNAL_ERROR", `Request failed with status ${String(res.status)}`, res.status);
  }

  return body;
}

/** GET a /api/* endpoint and validate the response with its published schema. */
export async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const body = await request(path, { method: "GET" });
  return schema.parse(body);
}

/**
 * POST/PUT a /api/* write endpoint with the session's CSRF token attached as
 * the X-CSRF-Token header (ADR 0023) and validate the response with its
 * published schema.
 */
export async function writeJson<T>(
  path: string,
  method: "POST" | "PUT",
  csrfToken: string,
  payload: unknown,
  schema: z.ZodType<T>,
): Promise<T> {
  const body = await request(path, {
    method,
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify(payload),
  });
  return schema.parse(body);
}
