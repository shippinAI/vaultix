import { ForbiddenError } from "@casl/ability";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";

import {
  BadRequestError,
  ForbiddenRequestError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError
} from "@app/lib/errors";
import { ActorType, AuthMode } from "@app/services/auth/auth-type";
import { McpSessionError } from "@app/services/vaultix/mcp-session-service";
import type { createVaultixReferenceDispatch } from "@app/services/vaultix/reference-dispatch";
import { parseReferenceQuery } from "@app/services/vaultix/reference-input";
import type { VaultixReferenceService } from "@app/services/vaultix/reference-service";

// Shared by the main Vaultix router (/api/v1/vaultix) and the warp-point MCPs (/api/vx/v1/<domain>/mcp),
// so both surfaces admit the same actors, run the same handlers and fail the same way.

export type TVaultixReferenceOptions = {
  references?: VaultixReferenceService;
  referenceDispatch?: ReturnType<typeof createVaultixReferenceDispatch>;
  auditReferences?: (
    request: FastifyRequest,
    scope: { projectId: string; environment: string; secretPath: string; count: number }
  ) => Promise<void>;
};

// A signed-in Vaultix user or machine identity in an organization.
export const canReadVaultix = (request: FastifyRequest) =>
  Boolean(
    request.auth &&
      [AuthMode.JWT, AuthMode.IDENTITY_ACCESS_TOKEN].includes(request.auth.authMode) &&
      [ActorType.USER, ActorType.IDENTITY].includes(request.permission?.type) &&
      request.permission?.orgId
  );

// vaultix.projects.list and vaultix.secrets.references, the same for HTTP, the main MCP and warp points.
export const createReferenceActions =
  (options: TVaultixReferenceOptions) =>
  async (request: FastifyRequest, name: string, input: unknown, dispatch: "http" | "mcp" = "http") => {
    if (!canReadVaultix(request)) throw new UnauthorizedError();
    if (!options.references && !options.referenceDispatch) throw new NotFoundError({});
    const actor = {
      actor: request.permission.type,
      actorId: request.permission.id,
      actorOrgId: request.permission.orgId,
      actorAuthMethod: request.permission.authMethod
    };
    if (name === "vaultix.projects.list") {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length)
        throw new BadRequestError({ message: "This action accepts no arguments." });
      if (options.referenceDispatch) return options.referenceDispatch.listProjects(request, dispatch);
      return options.references?.listProjects(actor);
    }
    const query = parseReferenceQuery(input);
    if (options.referenceDispatch) return options.referenceDispatch.listReferences(request, query, dispatch);
    if (!options.references) throw new NotFoundError({});
    const result = await options.references.listReferences(actor, query);
    await options.auditReferences?.(request, { ...query, count: result.references.length });
    return result;
  };

// Expected failures carry a plain `error` string and never echo the cause; denied and missing look alike.
export const vaultixErrorHandler =
  (server: FastifyInstance) => (error: FastifyError | Error, _request: FastifyRequest, reply: FastifyReply) => {
    const code =
      error instanceof Error && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
    let status = code >= 400 && code < 500 ? code : 500;
    if (error instanceof McpSessionError) status = error.statusCode;
    else if (error instanceof UnauthorizedError || error instanceof jwt.JsonWebTokenError) status = 401;
    else if (error instanceof BadRequestError) status = 400;
    else if (error instanceof RateLimitError) status = 429;
    else if (
      error instanceof NotFoundError ||
      error instanceof ForbiddenRequestError ||
      error instanceof ForbiddenError
    )
      status = 404;
    if (status === 500)
      server.log.error({ errorType: error instanceof Error ? error.name : "Unknown" }, "Vaultix request failed");
    const messages: Record<number, string> = {
      401: "Sign in to access your vault.",
      404: "This resource is unavailable.",
      429: "Too many requests. Wait for the Retry-After interval and try again.",
      500: "Vaultix could not complete the request.",
      503: "Vaultix MCP is temporarily unavailable. Retry when the service recovers."
    };
    if (error instanceof McpSessionError && status === 429) void reply.header("Retry-After", "3600");
    return reply.code(status).send({ error: messages[status] ?? "Invalid Vaultix request." });
  };

// No caching, and no cross-origin browser requests. Returns the reply when it rejected the request.
export const guardVaultixRequest = (request: FastifyRequest, reply: FastifyReply) => {
  void reply.header("Cache-Control", "no-store");
  if (!request.headers.origin) return undefined;
  let origin: URL;
  try {
    origin = new URL(request.headers.origin);
  } catch {
    return reply.code(403).send({ error: "Invalid request origin." });
  }
  if (origin.host !== request.headers.host)
    return reply.code(403).send({ error: "Cross-origin Vaultix requests are not allowed." });
  return undefined;
};

// A domain action that was refused or given bad arguments is an MCP tool result, not an HTTP failure.
export const isDeniedAction = (error: unknown) =>
  error instanceof BadRequestError ||
  error instanceof NotFoundError ||
  error instanceof ForbiddenRequestError ||
  error instanceof ForbiddenError;
