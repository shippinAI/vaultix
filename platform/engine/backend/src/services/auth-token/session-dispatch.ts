import type { FastifyRequest } from "fastify";

import { TAuthTokenSessions } from "@app/db/schemas";
import { BadRequestError, ForbiddenRequestError, InternalServerError, UnauthorizedError } from "@app/lib/errors";

const SESSIONS_PATH = "/api/v2/users/me/sessions";
const LOGOUT_PATH = "/api/v1/auth/logout";

type TSessionWire = Omit<TAuthTokenSessions, "lastUsed" | "createdAt" | "updatedAt"> & {
  lastUsed: string;
  createdAt: string;
  updatedAt: string;
};

const failure = (status: number) => {
  if (status === 400) return new BadRequestError({ message: "Invalid session ID." });
  if (status === 401) return new UnauthorizedError({});
  if (status === 403) return new ForbiddenRequestError({});
  return new InternalServerError({});
};

// Only the verified bearer and the socket address cross to the loopback service.
const callSessions = async (baseUrl: string, request: FastifyRequest, method: "GET" | "DELETE", path: string) => {
  const headers: Record<string, string> = {};
  if (typeof request.headers.authorization === "string") headers.authorization = request.headers.authorization;
  if (request.ip) headers["x-real-ip"] = request.ip;
  let response: Response;
  try {
    response = await fetch(new URL(path, baseUrl), { method, headers, signal: AbortSignal.timeout(5000) });
  } catch {
    throw new InternalServerError({});
  }
  if (!response.ok) throw failure(response.status);
  return (await response.json()) as unknown;
};

export const createVaultixSessionDispatch = (baseUrl: string) => ({
  list: async (request: FastifyRequest): Promise<TAuthTokenSessions[]> => {
    const sessions = (await callSessions(baseUrl, request, "GET", SESSIONS_PATH)) as TSessionWire[];
    // The route's response schema serializes real dates.
    return sessions.map((session) => ({
      ...session,
      lastUsed: new Date(session.lastUsed),
      createdAt: new Date(session.createdAt),
      updatedAt: new Date(session.updatedAt)
    }));
  },
  revokeAll: (request: FastifyRequest) =>
    callSessions(baseUrl, request, "DELETE", SESSIONS_PATH) as Promise<{ message: string }>,
  revoke: (request: FastifyRequest, sessionId: string) =>
    callSessions(baseUrl, request, "DELETE", `${SESSIONS_PATH}/${encodeURIComponent(sessionId)}`) as Promise<{
      message: string;
    }>,
  // The refresh token is the only credential here. The caller clears the cookies whatever happens.
  logout: async (refreshToken: string | undefined) => {
    let response: Response;
    try {
      response = await fetch(new URL(LOGOUT_PATH, baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
        signal: AbortSignal.timeout(5000)
      });
    } catch {
      throw new InternalServerError({});
    }
    if (!response.ok) throw failure(response.status);
  }
});

export const sessionDispatchFromConfig = (config: {
  VAULTIX_SESSION_DISPATCH: "typescript" | "go";
  GOLANG_SIDECAR_URL?: string;
}) =>
  config.VAULTIX_SESSION_DISPATCH === "go"
    ? createVaultixSessionDispatch(config.GOLANG_SIDECAR_URL || "http://127.0.0.1:4040")
    : undefined;
