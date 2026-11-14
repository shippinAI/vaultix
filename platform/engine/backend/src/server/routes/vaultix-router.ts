import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { getConfig } from "@app/lib/config/env";
import { BadRequestError, UnauthorizedError } from "@app/lib/errors";
import { getVaultixAuthConfig } from "@app/services/vaultix/auth-config";
import {
  buildVaultixLearningMemory,
  getVaultixCatalog,
  getVaultixConfigure,
  getVaultixConnections,
  getVaultixProduct,
  specialistInstructions
} from "@app/services/vaultix/catalog";
import { getVaultixGuidance } from "@app/services/vaultix/guidance";
import { parseLearningContext } from "@app/services/vaultix/learning-input";
import { handleVaultixMcp } from "@app/services/vaultix/mcp";
import { loadMcpAppResource, McpAppResource, requestsMcpApp } from "@app/services/vaultix/mcp-app-resource";
import { anonymousMcpSessionRule } from "@app/services/vaultix/mcp-session-contract";
import { createMcpSessionService, McpSessionBinding, McpSessionError } from "@app/services/vaultix/mcp-session-service";
import { referenceTools } from "@app/services/vaultix/reference-input";

import {
  canReadVaultix as canRead,
  createReferenceActions,
  guardVaultixRequest,
  isDeniedAction,
  TVaultixReferenceOptions,
  vaultixErrorHandler
} from "./vaultix-shared";

export const registerVaultixRouter = async (
  server: FastifyInstance,
  options: TVaultixReferenceOptions & { appResource?: () => Promise<McpAppResource | undefined> }
) => {
  const appResource = (options.appResource ?? loadMcpAppResource)();
  const runAction = createReferenceActions(options);
  // Production inherits the shared cache-backed limiter. Development and isolated
  // route tests retain local limits without registering a second production budget.
  if (!server.hasDecorator("rateLimit")) {
    await server.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  }
  server.setErrorHandler(vaultixErrorHandler(server));

  const sessionBinding = (request: FastifyRequest): McpSessionBinding => {
    if (!canRead(request)) throw new UnauthorizedError();
    return {
      authMode: request.auth.authMode,
      actor: request.permission.type,
      actorId: request.permission.id,
      orgId: request.permission.orgId,
      authMethod: request.permission.authMethod ?? null
    };
  };
  const sessions = () => {
    if (!server.hasDecorator("redis") || !server.redis) throw new McpSessionError(503);
    return createMcpSessionService(server.redis);
  };

  server.addHook("onRequest", async (request, reply) => {
    const rejected = guardVaultixRequest(request, reply);
    if (rejected) return rejected;
    if (
      !request.routeOptions.url?.endsWith("/secret-references") &&
      Object.keys((request.query ?? {}) as object).length
    ) {
      return reply.code(400).send({ error: "Vaultix guidance endpoints accept no query parameters." });
    }
  });

  const reads = [
    ["/guidance", getVaultixGuidance],
    ["/product", getVaultixProduct],
    ["/catalog", getVaultixCatalog],
    ["/configure", getVaultixConfigure],
    ["/connections", getVaultixConnections],
    ["/ai/instructions", () => ({ instructions: specialistInstructions })]
  ] as const;
  server.get(
    "/auth/config",
    {
      schema: {
        hide: false,
        tags: ["Vaultix"],
        summary: "Read implemented Vaultix login methods"
      },
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } }
    },
    async () => getVaultixAuthConfig(getConfig()?.SITE_URL, process.env.NOMEN_OIDC_ISSUER)
  );

  reads.forEach(([url, handler]) =>
    server.get(
      url,
      {
        schema: { hide: false, tags: ["Vaultix"], summary: `Read Vaultix ${url.slice(1)}` },
        config: { rateLimit: { max: 120, timeWindow: "1 minute" } }
      },
      async () => handler()
    )
  );

  server.get(
    "/updates",
    {
      schema: {
        tags: ["Vaultix"],
        operationId: "getVaultixUpdateStatus",
        summary: "Read cached Vaultix release status",
        security: [{ bearerAuth: [] }]
      },
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } }
    },
    async (request) => {
      if (!canRead(request)) throw new UnauthorizedError();
      return server.services.updateCheck.getStatus();
    }
  );
  server.post(
    "/updates/check",
    {
      bodyLimit: 1024,
      schema: {
        tags: ["Vaultix"],
        operationId: "checkVaultixUpdates",
        summary: "Refresh stable release metadata without installing software",
        security: [{ bearerAuth: [] }]
      },
      config: { rateLimit: { max: 2, timeWindow: "1 minute" } }
    },
    async (request) => {
      if (!canRead(request)) throw new UnauthorizedError();
      if (
        !request.body ||
        typeof request.body !== "object" ||
        Array.isArray(request.body) ||
        Object.keys(request.body).length
      )
        throw new BadRequestError({ message: "Update checks accept an empty object." });
      await server.services.updateCheck.refresh();
      return server.services.updateCheck.getStatus();
    }
  );

  server.post(
    "/learning-context",
    {
      bodyLimit: 16 * 1024,
      preValidation: async (request, reply) => {
        if (!parseLearningContext(request.body))
          return reply.code(400).send({
            error:
              "Use supported context names and a whole interaction count from 0 to 1000000. Never send secret values."
          });
      },
      schema: {
        hide: false,
        tags: ["Vaultix"],
        summary: "Build a temporary teaching profile from caller-supplied names",
        description:
          "Public, stateless guidance. Does not read projects, store history, verify skill or grant access. Never send credentials or secret values."
      },
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } }
    },
    async (request, reply) => {
      const context = parseLearningContext(request.body);
      if (!context) throw new BadRequestError({ message: "Invalid teaching context." });
      return reply.send(buildVaultixLearningMemory(context));
    }
  );

  if (options.references || options.referenceDispatch) {
    server.get(
      "/projects",
      {
        schema: {
          hide: false,
          tags: ["Vaultix"],
          summary: "List authorized Vaultix projects",
          security: [{ bearerAuth: [] }]
        },
        config: { rateLimit: { max: 60, timeWindow: "1 minute" } }
      },
      async (request) => runAction(request, "vaultix.projects.list", {})
    );
    server.get(
      "/secret-references",
      {
        schema: {
          hide: false,
          tags: ["Vaultix"],
          summary: "List authorized secret references without values",
          security: [{ bearerAuth: [] }]
        },
        config: { rateLimit: { max: 60, timeWindow: "1 minute" } }
      },
      async (request) => runAction(request, "vaultix.secrets.references", request.query)
    );
  }

  server.post(
    "/mcp",
    {
      bodyLimit: 16 * 1024,
      schema: {
        hide: false,
        tags: ["Vaultix"],
        summary: "Clyffy source actions over MCP",
        description:
          "Public catalog and connection guidance. Authenticated project/reference actions reuse the UI service. No secret values or mutations."
      },
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } }
    },
    async (request, reply) => {
      const sessionId = request.headers["mcp-session-id"];
      const body = request.body as { method?: unknown } | undefined;
      if (sessionId !== undefined && typeof sessionId !== "string") throw new McpSessionError(404);
      if (sessionId !== undefined) {
        await sessions().read(sessionBinding(request), sessionId, request.headers["mcp-protocol-version"]);
        if (body?.method === "initialize") throw new McpSessionError(400);
      }
      const referenceActions = Boolean(options.references || options.referenceDispatch);
      const wantsApp = requestsMcpApp(request.body) && canRead(request) && referenceActions;
      const resource = sessionId !== undefined || wantsApp ? await appResource : undefined;
      const response = await Promise.resolve(
        handleVaultixMcp(
          request.body,
          referenceActions
            ? {
                tools: canRead(request) ? referenceTools : [],
                names: referenceTools.map((tool) => tool.name),
                call: (name, args) => runAction(request, name, args, "mcp")
              }
            : undefined,
          resource ? [resource] : []
        )
      ).catch((error: unknown) => {
        // HTTP 404 is reserved for expired/mismatched MCP sessions. A denied
        // domain action is a tool result, not a request to reinitialize/replay.
        if (sessionId === undefined || !isDeniedAction(error)) throw error;
        return {
          jsonrpc: "2.0",
          id: (request.body as { id: string | number }).id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  error instanceof BadRequestError
                    ? "Invalid Vaultix action arguments."
                    : "This resource is unavailable."
              }
            ]
          }
        };
      });
      if (response === undefined) return reply.code(202).send();
      if (
        wantsApp &&
        resource &&
        "result" in response &&
        response.result &&
        typeof response.result === "object" &&
        "protocolVersion" in response.result &&
        typeof response.result.protocolVersion === "string"
      ) {
        const id = await sessions().create(sessionBinding(request), response.result.protocolVersion);
        void reply.header("Mcp-Session-Id", id);
      }
      return reply.send(response);
    }
  );

  server.route({
    method: ["GET"],
    url: "/mcp",
    config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    handler: async (_request, reply) =>
      reply
        .header("Allow", "POST")
        .code(405)
        .send({ error: `Use POST for Vaultix MCP. ${anonymousMcpSessionRule}` })
  });
  server.delete("/mcp", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
    const id = request.headers["mcp-session-id"];
    if (id === undefined)
      return reply.header("Allow", "POST").code(405).send({ error: "Specify an MCP session to close." });
    if (typeof id !== "string") throw new McpSessionError(404);
    const binding = sessionBinding(request);
    const service = sessions();
    await service.read(binding, id, request.headers["mcp-protocol-version"]);
    await service.remove(binding, id);
    return reply.code(204).send();
  });
};
