import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { getJson, writeJson, ApiError } from "../api.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("getJson", () => {
  let assignSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    assignSpy = vi.fn();
    // A plain object, not a spread of window.location (a host object whose
    // spread would lose its prototype) — only `assign` is ever called here.
    vi.stubGlobal("location", { assign: assignSpy });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("parses a successful response with the given schema", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ value: 42 })));
    const schema = z.object({ value: z.number() });
    const result = await getJson("/api/thing", schema);
    expect(result).toEqual({ value: 42 });
  });

  it("throws ApiError with the envelope's code/message on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: { code: "NOT_FOUND", message: "gone" } }, 404)),
    );
    await expect(getJson("/api/thing", z.object({}))).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "gone",
      status: 404,
    });
  });

  it("redirects to /login on a 401 without throwing an unhandled schema error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: { code: "UNAUTHORIZED", message: "x" } }, 401)));
    await expect(getJson("/api/thing", z.object({}))).rejects.toBeInstanceOf(ApiError);
    expect(assignSpy).toHaveBeenCalledWith("/login");
  });

  it("throws a generic ApiError when the error body doesn't match the envelope schema", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("plain text", { status: 500 })));
    await expect(getJson("/api/thing", z.object({}))).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      status: 500,
    });
  });

  it("passes credentials: same-origin on every request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    await getJson("/api/thing", z.object({}));
    expect(fetchMock).toHaveBeenCalledWith("/api/thing", expect.objectContaining({ credentials: "same-origin" }));
  });
});

describe("writeJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends the CSRF token as the X-CSRF-Token header and JSON-stringifies the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const schema = z.object({ ok: z.boolean() });
    await writeJson("/api/thing/1/status", "POST", "token-abc", { status: "interview" }, schema);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/thing/1/status",
      expect.objectContaining({
        method: "POST",
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- vitest's expect.objectContaining(...) is typed `any`; test-assertion value only.
        headers: expect.objectContaining({ "X-CSRF-Token": "token-abc", "Content-Type": "application/json" }),
        body: JSON.stringify({ status: "interview" }),
      }),
    );
  });

  it("supports PUT for full-document replace endpoints", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await writeJson("/api/settings", "PUT", "token-abc", {}, z.object({ ok: z.boolean() }));
    expect(fetchMock).toHaveBeenCalledWith("/api/settings", expect.objectContaining({ method: "PUT" }));
  });
});
