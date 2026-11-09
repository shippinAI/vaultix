import type { FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BadRequestError, ForbiddenRequestError, InternalServerError, UnauthorizedError } from "@app/lib/errors";

import { createVaultixSessionDispatch } from "./session-dispatch";

const request = {
  headers: { authorization: "Bearer token", "x-org-id": "spoofed", cookie: "jid=refresh" },
  ip: "203.0.113.9"
} as unknown as FastifyRequest;

const dispatch = createVaultixSessionDispatch("http://127.0.0.1:4040");

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status }));

afterEach(() => vi.restoreAllMocks());

describe("session dispatch", () => {
  it("returns real dates for the route's response schema", async () => {
    respond(200, [
      {
        id: "11111111-1111-4111-8111-111111111111",
        ip: "203.0.113.9",
        userAgent: null,
        refreshVersion: 2,
        accessVersion: 3,
        lastUsed: "2026-01-02T03:04:05.678Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        userId: "22222222-2222-4222-8222-222222222222"
      }
    ]);
    const [session] = await dispatch.list(request);
    expect(session.lastUsed).toBeInstanceOf(Date);
    expect(session.lastUsed.toISOString()).toBe("2026-01-02T03:04:05.678Z");
    expect(session.createdAt).toBeInstanceOf(Date);
    expect(session.updatedAt).toBeInstanceOf(Date);
    expect(session.userAgent).toBeNull();
  });

  it("forwards only the bearer and the socket address", async () => {
    const fetchMock = respond(200, []);
    await dispatch.list(request);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:4040/api/v2/users/me/sessions");
    expect(init?.method).toBe("GET");
    expect(init?.headers).toEqual({ authorization: "Bearer token", "x-real-ip": "203.0.113.9" });
  });

  it("revokes one session by an encoded ID", async () => {
    const fetchMock = respond(200, { message: "Successfully revoked session" });
    await expect(dispatch.revoke(request, "a/../b")).resolves.toEqual({ message: "Successfully revoked session" });
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://127.0.0.1:4040/api/v2/users/me/sessions/a%2F..%2Fb");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("revokes every session", async () => {
    const fetchMock = respond(200, { message: "Successfully revoked all sessions" });
    await expect(dispatch.revokeAll(request)).resolves.toEqual({ message: "Successfully revoked all sessions" });
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://127.0.0.1:4040/api/v2/users/me/sessions");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it.each([
    [400, BadRequestError],
    [401, UnauthorizedError],
    [403, ForbiddenRequestError],
    [500, InternalServerError]
  ])("maps a %i from the service", async (status, expected) => {
    respond(status, { error: "detail from the service" });
    await expect(dispatch.list(request)).rejects.toBeInstanceOf(expected);
  });

  it("fails closed when the service cannot be reached", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connection refused"));
    await expect(dispatch.revokeAll(request)).rejects.toBeInstanceOf(InternalServerError);
  });
});
