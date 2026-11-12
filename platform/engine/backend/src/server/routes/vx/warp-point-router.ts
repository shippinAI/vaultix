import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { BadRequestError, NotFoundError, UnauthorizedError } from "@app/lib/errors";
import { vaultixTools } from "@app/services/vaultix/catalog";
import { handleVaultixMcp, TMcpSurface } from "@app/services/vaultix/mcp";
import { referenceTools } from "@app/services/vaultix/reference-input";
import { findWarpPoint, MAIN_MCP_PATH, TWarpPoint, VAULTIX_DOMAINS } from "@app/services/vaultix/warp-points";

import {
  canReadVaultix,
  createReferenceActions,
  guardVaultixRequest,
  isDeniedAction,
  TVaultixReferenceOptions,
  vaultixErrorHandler
} from "../vaultix-shared";

// Warp points (docs/0120): one MCP per domain at /api/vx/v1/<domain>/mcp. Each lists and runs only
// its own domain's tools, through the same handlers, permissions and audit as the UI and the main
// MCP. Warp points are stateless: no MCP session, no app resource.

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

// Domain tools that live only on their warp point.
const warpOnlyTools = [
  {
    name: "vaultix.connect.imports.providers",
    description:
      "List the providers Vaultix imports from (Doppler, and Infisical or another Vaultix) with the app connections you may use for each. Names and IDs only; no credentials or secret values. Review and import stay in the Vaultix UI, where a person approves them.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          minLength: 1,
          maxLength: 64,
          description: "Destination project, to list only connections usable there."
        }
      },
      additionalProperties: false
    },
    annotations: readOnly
  },
  {
    name: "vaultix.operate.updates.status",
    description:
      "Read this instance's cached release status: current version, latest stable release and whether an update is available. Installs nothing.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: readOnly
  }
];

const actionTools = [...referenceTools, ...warpOnlyTools];
const guidanceNames = new Set(vaultixTools.map((tool) => tool.name));

const surfaceFor = (point: TWarpPoint): TMcpSurface => ({
  serverName: `vaultix-${point.domain}`,
  instructions: [
    `# Vaultix ${point.title} warp point`,
    point.summary,
    `This MCP lists only ${point.domain} tools. The main MCP, ${MAIN_MCP_PATH}, lists every warp point (vaultix.warp.list) and how to sign in (vaultix.auth.options.get).`,
    "Work with names, IDs and references. Never ask for, accept or return secret values, tokens or keys.",
    "Signed-in tools run with the caller's own permissions and appear once the client is signed in. A refused or invalid action comes back as a tool error."
  ].join("\n"),
  guidance: point.tools.map((tool) => tool.name).filter((name) => guidanceNames.has(name))
});

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const noArguments = (args: unknown) => {
  if (!isPlainObject(args) || Object.keys(args).length)
    throw new BadRequestError({ message: "This action accepts no arguments." });
};

const providerArguments = (args: unknown) => {
  if (!isPlainObject(args) || Object.keys(args).some((key) => key !== "projectId"))
    throw new BadRequestError({ message: "Only projectId is accepted." });
  if (args.projectId === undefined) return undefined;
  const projectId = typeof args.projectId === "string" ? args.projectId.trim() : "";
  if (!projectId || projectId.length > 64)
    throw new BadRequestError({ message: "projectId must be 1 to 64 characters." });
  return projectId;
};

export const registerWarpPointRouter = async (server: FastifyInstance, options: TVaultixReferenceOptions) => {
  const runReference = createReferenceActions(options);

  const runTool = async (request: FastifyRequest, name: string, args: unknown) => {
    if (name === "vaultix.projects.list" || name === "vaultix.secrets.references")
      return runReference(request, name, args, "mcp");
    if (!canReadVaultix(request)) throw new UnauthorizedError();
    if (name === "vaultix.connect.imports.providers") {
      const projectId = providerArguments(args);
      return {
        providers: await server.services.migration.listImportProviders({ actor: request.permission, projectId })
      };
    }
    if (name === "vaultix.operate.updates.status") {
      noArguments(args);
      return server.services.updateCheck.getStatus();
    }
    throw new NotFoundError({});
  };

  if (!server.hasDecorator("rateLimit")) {
    await server.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  }
  server.setErrorHandler(vaultixErrorHandler(server));
  server.addHook("onRequest", async (request, reply) => {
    const rejected = guardVaultixRequest(request, reply);
    if (rejected) return rejected;
    if (Object.keys((request.query ?? {}) as object).length)
      return reply.code(400).send({ error: "Warp points accept no query parameters." });
  });

  for (const domain of VAULTIX_DOMAINS) {
    const point = findWarpPoint(domain);
    if (!point) throw new Error(`Warp point ${domain} is not registered`);
    const surface = surfaceFor(point);
    const tools = actionTools.filter((tool) => point.tools.some((entry) => entry.name === tool.name));

    server.post(
      `/${domain}/mcp`,
      {
        bodyLimit: 16 * 1024,
        schema: {
          hide: false,
          tags: ["Vaultix"],
          summary: `Vaultix ${point.title} warp point (MCP)`,
          description: `${point.summary} Lists and runs only ${domain} tools. ${point.status === "live" ? "Live." : "Planned: answers 404 until it is live."}`
        },
        config: { rateLimit: { max: 120, timeWindow: "1 minute" } }
      },
      async (request, reply) => {
        if (point.status !== "live")
          return reply.code(404).send({
            error: `The ${domain} warp point is planned and not live yet. vaultix.warp.list on ${MAIN_MCP_PATH} lists the live ones.`
          });
        if (request.headers["mcp-session-id"] !== undefined)
          return reply.code(400).send({ error: "Warp points are stateless. Send requests without Mcp-Session-Id." });
        const response = await Promise.resolve(
          handleVaultixMcp(
            request.body,
            {
              // Signed-in tools are listed only to a signed-in client, as on the main MCP.
              tools: canReadVaultix(request) ? tools : [],
              names: tools.map((tool) => tool.name),
              call: (name, args) => runTool(request, name, args)
            },
            undefined,
            surface
          )
        ).catch((error: unknown) => {
          // A refused or invalid action is a tool result; signing in stays an HTTP 401.
          if (!isDeniedAction(error)) throw error;
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
        return reply.send(response);
      }
    );
    server.get(
      `/${domain}/mcp`,
      { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
      async (_request, reply) =>
        reply.header("Allow", "POST").code(405).send({ error: "Use POST for a Vaultix warp point." })
    );
  }
};
