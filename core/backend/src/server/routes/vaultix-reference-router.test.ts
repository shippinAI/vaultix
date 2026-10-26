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
  test("unauthorized and missing resources are indistinguishable", async () => {
    listReferences.mockRejectedValueOnce(new ForbiddenRequestError({ message: "CANARY-other-tenant" }));
    const response = await app.inject({
      url: `/api/v1/vaultix/secret-references?projectId=${projectId}&environment=dev`,
      headers: { authorization: "Bearer test-fixture" }
    });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("CANARY");
    expect(auditReferences).not.toHaveBeenCalled();
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
