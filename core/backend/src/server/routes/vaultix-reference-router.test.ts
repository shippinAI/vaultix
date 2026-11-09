import fastify, { FastifyRequest } from "fastify";

import { ForbiddenRequestError } from "@app/lib/errors";
import { ActorType, AuthMode } from "@app/services/auth/auth-type";
import type { VaultixReferenceService } from "@app/services/vaultix/reference-service";

import { registerVaultixRouter } from "./vaultix-router";

const projectId = "11111111-1111-4111-8111-111111111111";
const input = { projectId, environment: "dev" };
const result = {
  projectId,
  environment: "dev",
  secretPath: "/",
  references: [],
  nextOffset: null,
  narration: "Names only."
};
describe("Vaultix shared reference actions", () => {
  const listReferences = vi.fn().mockResolvedValue(result);
  const listProjects = vi.fn().mockResolvedValue({ projects: [], narration: "Apps." });
  const auditReferences = vi.fn().mockResolvedValue(undefined);
  const app = fastify();
  beforeAll(async () => {
    app.addHook("onRequest", async (request) => {
      if (request.headers.authorization === "Bearer test-fixture") {
        request.auth = {
          authMode: AuthMode.IDENTITY_ACCESS_TOKEN,
          actor: ActorType.IDENTITY
        } as FastifyRequest["auth"];
        request.permission = {
          type: ActorType.IDENTITY,
          id: "actor-from-auth",
          orgId: "org-from-auth",
          authMethod: null
        } as FastifyRequest["permission"];
      }
    });
    await app.register(registerVaultixRouter, {
      prefix: "/api/v1/vaultix",
      references: { listReferences, listProjects } as VaultixReferenceService,
      auditReferences
    });
  });
  afterAll(() => app.close());
  beforeEach(() => vi.clearAllMocks());
  test("unauthenticated tenant reads fail on HTTP and MCP", async () => {
    const responses = await Promise.all([
      app.inject(`/api/v1/vaultix/secret-references?projectId=${projectId}&environment=dev`),
      app.inject({
        method: "POST",
        url: "/api/v1/vaultix/mcp",
        payload: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "vaultix.secrets.references", arguments: input }
        }
      })
    ]);
    responses.forEach((response) => {
      expect(response.statusCode).toBe(401);
      expect(typeof response.json<{ error: string }>().error).toBe("string");
    });
    expect(listReferences).not.toHaveBeenCalled();
  });
  test("UI and MCP share actor, validation, output, and audit", async () => {
    const headers = { authorization: "Bearer test-fixture" };
    const http = await app.inject({
      url: `/api/v1/vaultix/secret-references?projectId=${projectId}&environment=dev`,
      headers
    });
    const mcp = await app.inject({
      method: "POST",
      url: "/api/v1/vaultix/mcp",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "vaultix.secrets.references", arguments: input }
      }
    });
    expect(http.statusCode).toBe(200);
    expect(JSON.parse(mcp.json<{ result: { content: { text: string }[] } }>().result.content[0].text)).toEqual(
      http.json()
    );
    expect(listReferences).toHaveBeenCalledTimes(2);
    expect(listReferences).toHaveBeenCalledWith(
      { actor: ActorType.IDENTITY, actorId: "actor-from-auth", actorOrgId: "org-from-auth", actorAuthMethod: null },
      { ...input, secretPath: "/", offset: 0, limit: 50 }
    );
    expect(auditReferences).toHaveBeenCalledTimes(2);
  });
  test("anonymous tool discovery lists guidance only", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/vaultix/mcp",
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }
    });
    const { result: listed } = response.json<{
      result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] };
    }>();
    const { tools } = listed;
    expect(tools.map((tool) => tool.name)).toEqual([
      "vaultix.guidance.get",
      "vaultix.catalog.get",
      "vaultix.configure.show",
      "vaultix.connections.get",
      "vaultix.specialist.instructions",
      "vaultix.learning.profile.get"
    ]);
    expect(tools.every((tool) => tool.annotations.readOnlyHint)).toBe(true);
    expect(response.body).not.toContain("vaultix.projects.list");
    expect(response.body).not.toContain("vaultix.secrets.references");
    expect(response.headers["mcp-session-id"]).toBeUndefined();
  });

  test("unauthorized and missing resources are indistinguishable", async () => {
    listReferences.mockRejectedValueOnce(new ForbiddenRequestError({ message: "CANARY-other-tenant" }));
    const response = await app.inject({
      url: `/api/v1/vaultix/secret-references?projectId=${projectId}&environment=dev`,
      headers: { authorization: "Bearer test-fixture" }
    });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("CANARY");
    expect(auditReferences).not.toHaveBeenCalled();
    listReferences.mockRejectedValueOnce(new ForbiddenRequestError({ message: "CANARY-other-tenant" }));
    const mcp = await app.inject({
      method: "POST",
      url: "/api/v1/vaultix/mcp",
      headers: { authorization: "Bearer test-fixture" },
      payload: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "vaultix.secrets.references", arguments: input }
      }
    });
    expect(mcp.statusCode).toBe(404);
    expect(mcp.body).not.toContain("CANARY");
  });
  test("untrusted tenant and value arguments never reach the engine", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/vaultix/mcp",
      headers: { authorization: "Bearer test-fixture" },
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "vaultix.secrets.references", arguments: { ...input, orgId: "CANARY" } }
      }
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain("CANARY");
    expect(listReferences).not.toHaveBeenCalled();
  });
});

describe("served reference rate limit", () => {
  const app = fastify();
  const listReferences = vi.fn().mockResolvedValue(result);
  const listProjects = vi.fn().mockResolvedValue({ projects: [], narration: "Apps." });
  beforeAll(async () => {
    app.addHook("onRequest", async (request) => {
      const { authorization } = request.headers;
      if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
        request.auth = { authMode: AuthMode.JWT, actor: ActorType.USER } as FastifyRequest["auth"];
        request.permission = {
          type: ActorType.USER,
          id: authorization,
          orgId: "org-from-auth",
          authMethod: "email"
        } as FastifyRequest["permission"];
      }
    });
    await app.register(registerVaultixRouter, {
      prefix: "/api/v1/vaultix",
      references: { listReferences, listProjects } as VaultixReferenceService
    });
  });
  afterAll(() => app.close());

  test("allows 60 project reads per client IP and keeps reference reads on a separate IP budget", async () => {
    const read = async (
      attempt: number,
      url: string,
      authorization: string,
      remoteAddress: string
    ): Promise<number> => {
      const response = await app.inject({ url, headers: { authorization }, remoteAddress });
      if (attempt === 59) return response.statusCode;
      expect(response.statusCode).toBe(200);
      return read(attempt + 1, url, authorization, remoteAddress);
    };
    const projects = `/api/v1/vaultix/projects`;
    const references = `/api/v1/vaultix/secret-references?projectId=${projectId}&environment=dev`;
    expect(await read(0, projects, "Bearer actor-a", "203.0.113.10")).toBe(200);
    const sameAddressOtherActor = await app.inject({
      url: projects,
      headers: { authorization: "Bearer actor-b" },
      remoteAddress: "203.0.113.10"
    });
    expect(sameAddressOtherActor.statusCode).toBe(429);
    expect(typeof sameAddressOtherActor.json<{ error: unknown }>().error).toBe("string");
    const otherAddress = await app.inject({
      url: projects,
      headers: { authorization: "Bearer actor-a" },
      remoteAddress: "203.0.113.11"
    });
    expect(otherAddress.statusCode).toBe(200);
    const sameAddressReferences = await app.inject({
      url: references,
      headers: { authorization: "Bearer actor-a" },
      remoteAddress: "203.0.113.10"
    });
    expect(sameAddressReferences.statusCode).toBe(200);
  });
});
