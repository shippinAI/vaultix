import { ForbiddenError } from "@casl/ability";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";

import { BadRequestError, ForbiddenRequestError, NotFoundError, UnauthorizedError } from "@app/lib/errors";
import { ActorType, AuthMode } from "@app/services/auth/auth-type";
import {
  getVaultixCatalog,
  getVaultixConfigure,
  getVaultixProduct,
  specialistInstructions
} from "@app/services/vaultix/catalog";
import { handleVaultixMcp } from "@app/services/vaultix/mcp";
import { parseReferenceQuery, referenceTools } from "@app/services/vaultix/reference-input";
import type { VaultixReferenceService } from "@app/services/vaultix/reference-service";

export const registerVaultixRouter = async (
  server: FastifyInstance,
  options: {
    references?: VaultixReferenceService;
    auditReferences?: (
      request: FastifyRequest,
      scope: { projectId: string; environment: string; secretPath: string; count: number }
    ) => Promise<void>;
  }
) => {
  const canRead = (request: FastifyRequest) =>
    Boolean(
      request.auth &&
        [AuthMode.JWT, AuthMode.IDENTITY_ACCESS_TOKEN].includes(request.auth.authMode) &&
        [ActorType.USER, ActorType.IDENTITY].includes(request.permission?.type) &&
        request.permission?.orgId
    );
  const runAction = async (request: FastifyRequest, name: string, input: unknown) => {
    if (!canRead(request)) throw new UnauthorizedError();
    if (!options.references) throw new NotFoundError({});
    const actor = {
      actor: request.permission.type,
      actorId: request.permission.id,
      actorOrgId: request.permission.orgId,
      actorAuthMethod: request.permission.authMethod
    };
    if (name === "vaultix.projects.list") {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length)
        throw new BadRequestError({ message: "This action accepts no arguments." });
      return options.references.listProjects(actor);
    }
    const query = parseReferenceQuery(input);
    const result = await options.references.listReferences(actor, query);
    await options.auditReferences?.(request, { ...query, count: result.references.length });
    return result;
  };
  await server.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  server.setErrorHandler((error, _request, reply) => {
    const code =
      error instanceof Error && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
    let status = code >= 400 && code < 500 ? code : 500;
    if (error instanceof UnauthorizedError || error instanceof jwt.JsonWebTokenError) status = 401;
    else if (error instanceof BadRequestError) status = 400;
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
      500: "Vaultix could not complete the request."
    };
    return reply.code(status).send({ error: messages[status] ?? "Invalid Vaultix request." });
  });

  server.addHook("onRequest", async (request, reply) => {
    void reply.header("Cache-Control", "no-store");
    if (request.headers.origin) {
      let origin: URL;
      try {
        origin = new URL(request.headers.origin);
      } catch {
        return reply.code(403).send({ error: "Invalid request origin." });
      }
      if (origin.host !== request.headers.host)
        return reply.code(403).send({ error: "Cross-origin Vaultix requests are not allowed." });
    }
    if (
      !request.routeOptions.url?.endsWith("/secret-references") &&
      Object.keys((request.query ?? {}) as object).length
    ) {
      return reply.code(400).send({ error: "Vaultix guidance endpoints accept no query parameters." });
    }
  });

  const reads = [
    ["/product", getVaultixProduct],
    ["/catalog", getVaultixCatalog],
    ["/configure", getVaultixConfigure],
    ["/ai/instructions", () => ({ instructions: specialistInstructions })]
  ] as const;
  reads.forEach(([url, handler]) =>
    server.get(
      url,
      {
        config: { rateLimit: { max: 120, timeWindow: "1 minute" } }
      },
      async () => handler()
    )
  );

  if (options.references) {
    server.get("/projects", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request) =>
      runAction(request, "vaultix.projects.list", {})
    );
    server.get("/secret-references", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request) =>
      runAction(request, "vaultix.secrets.references", request.query)
    );
  }

  server.post(
    "/mcp",
    {
      bodyLimit: 16 * 1024,
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } }
    },
    async (request, reply) => {
      const response = await handleVaultixMcp(
        request.body,
        options.references
          ? {
              tools: canRead(request) ? referenceTools : [],
              names: referenceTools.map((tool) => tool.name),
              call: (name, args) => runAction(request, name, args)
            }
          : undefined
      );
      if (response === undefined) return reply.code(202).send();
      return reply.send(response);
    }
  );

  server.route({
    method: ["GET", "DELETE"],
    url: "/mcp",
    handler: async (_request, reply) =>
      reply.header("Allow", "POST").code(405).send({ error: "Use POST for the stateless Vaultix MCP endpoint." })
  });
};
