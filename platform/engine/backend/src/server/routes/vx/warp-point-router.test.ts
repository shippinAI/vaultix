import fastify, { FastifyRequest } from "fastify";

import { ForbiddenRequestError } from "@app/lib/errors";
import { ActorType, AuthMode } from "@app/services/auth/auth-type";
import type { VaultixReferenceService } from "@app/services/vaultix/reference-service";

import { registerVaultixRouter } from "../vaultix-router";
import { registerWarpPointRouter } from "./warp-point-router";

const projectId = "11111111-1111-4111-8111-111111111111";
const references = {
  projectId,
  environment: "dev",
  secretPath: "/",
  references: [],
  nextOffset: null,
  narration: "Names only."
};
const signedIn = { authorization: "Bearer test-fixture" };

type TRpc = {
  result?: { tools?: { name: string }[]; content?: { text: string }[]; isError?: boolean };
  error?: unknown;
};

describe("Vaultix warp points", () => {
  const listReferences = vi.fn().mockResolvedValue(references);
  const listProjects = vi.fn().mockResolvedValue({ projects: [], narration: "Apps." });
  const auditReferences = vi.fn().mockResolvedValue(undefined);
  const listImportProviders = vi
    .fn()
    .mockResolvedValue([
      { provider: "doppler", connections: [], unavailableReason: null, lifecycle: ["review"], referenceSafe: true }
    ]);
  const getStatus = vi.fn().mockResolvedValue({ schemaVersion: "vaultix.updates.v1", state: "current" });
  const app = fastify();
  const options = { references: { listReferences, listProjects } as VaultixReferenceService, auditReferences };

  beforeAll(async () => {
    app.decorate("services", { migration: { listImportProviders }, updateCheck: { getStatus } } as never);
    app.addHook("onRequest", async (request) => {
      if (request.headers.authorization === signedIn.authorization) {
        request.auth = { authMode: AuthMode.JWT, actor: ActorType.USER } as FastifyRequest["auth"];
        request.permission = {
          type: ActorType.USER,
          id: "actor-from-auth",
          orgId: "org-from-auth",
          authMethod: null
        } as FastifyRequest["permission"];
      }
    });
    await app.register(registerVaultixRouter, { prefix: "/api/v1/vaultix", ...options });
    await app.register(registerWarpPointRouter, { prefix: "/api/vx/v1", ...options });
  });
  afterAll(() => app.close());
  beforeEach(() => vi.clearAllMocks());

  const rpc = async (domain: string, method: string, params?: unknown, headers: Record<string, string> = {}) =>
    app.inject({
      method: "POST",
      url: `/api/vx/v1/${domain}/mcp`,
      headers,
      payload: { jsonrpc: "2.0", id: 1, method, params }
    });
  const names = async (domain: string, headers?: Record<string, string>) =>
    ((await rpc(domain, "tools/list", {}, headers)).json<TRpc>().result?.tools ?? []).map((tool) => tool.name);

  test("each live warp point lists only its own domain's tools", async () => {
    expect(await names("auth")).toEqual(["vaultix.auth.options.get"]);
    expect(await names("experience")).toEqual([
      "vaultix.guidance.get",
      "vaultix.configure.show",
      "vaultix.learning.profile.get"
    ]);
    expect(await names("ai")).toEqual(["vaultix.connections.get", "vaultix.specialist.instructions"]);
    expect(await names("secrets", signedIn)).toEqual(["vaultix.secrets.references"]);
    expect(await names("workspace", signedIn)).toEqual(["vaultix.projects.list"]);
    expect(await names("connect", signedIn)).toEqual(["vaultix.connect.imports.providers"]);
    expect(await names("operate", signedIn)).toEqual(["vaultix.operate.updates.status"]);
  });

  test("a warp point is stateless and serves no views, even to a client that asks for them", async () => {
    const init = await rpc(
      "secrets",
      "initialize",
      {
        protocolVersion: "2025-11-25",
        clientInfo: { name: "codex", version: "1" },
        capabilities: {
          extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } }
        }
      },
      signedIn
    );
    expect(init.headers["mcp-session-id"]).toBeUndefined();
    expect(init.body).not.toContain("resources");
    expect((await rpc("secrets", "tools/list", {}, signedIn)).body).not.toContain("resourceUri");
    expect((await rpc("secrets", "resources/list", {}, signedIn)).json()).toMatchObject({ error: { code: -32601 } });
  });

  test("signed-in tools are hidden and refused until the client signs in", async () => {
    expect(await names("secrets")).toEqual([]);
    const response = await rpc("secrets", "tools/call", {
      name: "vaultix.secrets.references",
      arguments: { projectId, environment: "dev" }
    });
    expect(response.statusCode).toBe(401);
    expect(typeof response.json<{ error: string }>().error).toBe("string");
    expect(listReferences).not.toHaveBeenCalled();
  });

  test("a warp point runs the same handler and audit as the main MCP", async () => {
    const params = { name: "vaultix.secrets.references", arguments: { projectId, environment: "dev" } };
    const warp = await rpc("secrets", "tools/call", params, signedIn);
    const main = await app.inject({
      method: "POST",
      url: "/api/v1/vaultix/mcp",
      headers: signedIn,
      payload: { jsonrpc: "2.0", id: 1, method: "tools/call", params }
    });
    expect(warp.json<TRpc>().result?.content?.[0].text).toBe(main.json<TRpc>().result?.content?.[0].text);
    expect(listReferences).toHaveBeenCalledTimes(2);
    expect(auditReferences).toHaveBeenCalledTimes(2);
  });

  test("another domain's tool is unknown on this warp point", async () => {
    const response = await rpc("secrets", "tools/call", { name: "vaultix.projects.list", arguments: {} }, signedIn);
    expect(response.json()).toMatchObject({ error: { message: "Unknown Vaultix tool." } });
    expect(listProjects).not.toHaveBeenCalled();
  });

  test("connect and operate tools return metadata and refuse bad arguments as tool errors", async () => {
    const providers = await rpc(
      "connect",
      "tools/call",
      { name: "vaultix.connect.imports.providers", arguments: { projectId } },
      signedIn
    );
    expect(JSON.parse(providers.json<TRpc>().result?.content?.[0].text ?? "{}")).toMatchObject({
      providers: [{ provider: "doppler" }]
    });
    const [[providerCall]] = listImportProviders.mock.calls as [
      [{ actor: { id: string; orgId: string }; projectId: string }]
    ];
    expect(providerCall.actor).toMatchObject({ id: "actor-from-auth", orgId: "org-from-auth" });
    expect(providerCall.projectId).toBe(projectId);
    const invalid = await rpc(
      "connect",
      "tools/call",
      { name: "vaultix.connect.imports.providers", arguments: { value: "CANARY-SECRET" } },
      signedIn
    );
    expect(invalid.statusCode).toBe(200);
    expect(invalid.json<TRpc>().result?.isError).toBe(true);
    expect(invalid.body).not.toContain("CANARY-SECRET");
    const status = await rpc(
      "operate",
      "tools/call",
      { name: "vaultix.operate.updates.status", arguments: {} },
      signedIn
    );
    expect(JSON.parse(status.json<TRpc>().result?.content?.[0].text ?? "{}")).toMatchObject({ state: "current" });
  });

  test("a denied resource is a tool error that looks like a missing one", async () => {
    listReferences.mockRejectedValueOnce(new ForbiddenRequestError({ message: "CANARY-other-tenant" }));
    const response = await rpc(
      "secrets",
      "tools/call",
      { name: "vaultix.secrets.references", arguments: { projectId, environment: "dev" } },
      signedIn
    );
    expect(response.json<TRpc>().result).toMatchObject({ isError: true });
    expect(response.body).toContain("This resource is unavailable.");
    expect(response.body).not.toContain("CANARY");
  });

  test("initialize names the warp point and points back to the main MCP", async () => {
    const response = await rpc("auth", "initialize", {
      protocolVersion: "2025-11-25",
      clientInfo: { name: "codex", version: "1" },
      capabilities: {}
    });
    expect(response.json()).toMatchObject({ result: { serverInfo: { name: "vaultix-auth" } } });
    expect(response.body).toContain("/api/v1/vaultix/mcp");
    expect(response.headers["mcp-session-id"]).toBeUndefined();
  });

  test("planned warp points, sessions, queries, GET and cross-origin requests fail plainly", async () => {
    const planned = await rpc("pki", "tools/list", {});
    expect(planned.statusCode).toBe(404);
    expect(planned.json<{ error: string }>().error).toContain("planned");
    const session = await rpc("auth", "tools/list", {}, { "mcp-session-id": "anything" });
    expect(session.statusCode).toBe(400);
    expect(typeof session.json<{ error: string }>().error).toBe("string");
    const query = await app.inject({ method: "POST", url: "/api/vx/v1/auth/mcp?x=1", payload: {} });
    expect(query.statusCode).toBe(400);
    const get = await app.inject({ method: "GET", url: "/api/vx/v1/auth/mcp" });
    expect(get.statusCode).toBe(405);
    expect(get.headers.allow).toBe("POST");
    const crossOrigin = await app.inject({
      method: "POST",
      url: "/api/vx/v1/auth/mcp",
      headers: { origin: "https://elsewhere.example", host: "vaultix.example" },
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" }
    });
    expect(crossOrigin.statusCode).toBe(403);
  });
});
