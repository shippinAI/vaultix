import type { FastifyRequest } from "fastify";

import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError
} from "@app/lib/errors";

import type { ReferenceQuery } from "./reference-service";

export const vaultixDispatchHeader = "x-vaultix-dispatch";

const failure = (status: number) => {
  if (status === 401) return new UnauthorizedError({});
  if (status === 400) return new BadRequestError({});
  if (status === 403 || status === 404) return new NotFoundError({});
  if (status === 429) return new RateLimitError({});
  return new InternalServerError({});
};

const callReference = async (
  baseUrl: string,
  request: FastifyRequest,
  path: string,
  query: Record<string, string> | undefined,
  dispatch: "http" | "mcp"
) => {
  const url = new URL(path, baseUrl);
  if (query) {
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  }
  const headers: Record<string, string> = {};
  if (typeof request.headers.authorization === "string") headers.authorization = request.headers.authorization;
  if (request.ip) headers["x-real-ip"] = request.ip;
  if (dispatch === "mcp") headers[vaultixDispatchHeader] = "mcp";
  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
  } catch {
    throw new InternalServerError({});
  }
  if (!response.ok) throw failure(response.status);
  return (await response.json()) as unknown;
};

// The public ingress forwards only the verified bearer and the socket address.
// Actor and organization headers on the caller request are not copied.
export const createVaultixReferenceDispatch = (baseUrl: string) => ({
  listProjects: (request: FastifyRequest, dispatch: "http" | "mcp" = "http") =>
    callReference(baseUrl, request, "/api/v1/vaultix/projects", undefined, dispatch),
  listReferences: (request: FastifyRequest, query: ReferenceQuery, dispatch: "http" | "mcp" = "http") =>
    callReference(
      baseUrl,
      request,
      "/api/v1/vaultix/secret-references",
      {
        projectId: query.projectId,
        environment: query.environment,
        secretPath: query.secretPath,
        offset: String(query.offset),
        limit: String(query.limit)
      },
      dispatch
    )
});

export const waitForVaultixSidecar = async (baseUrl: string) => {
  const health = new URL("/api/v1/platform/projects/health", baseUrl);
  const attempt = async (remaining: number): Promise<void> => {
    try {
      const response = await fetch(health, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // The sidecar process is still opening its loopback port.
    }
    if (remaining <= 0) throw new InternalServerError({ message: "The reference service is not available." });
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
    await attempt(remaining - 1);
  };
  await attempt(150);
};
