import fastify, { FastifyRequest } from "fastify";
import type Redis from "ioredis";

import { ForbiddenRequestError } from "@app/lib/errors";
import { ActorType, AuthMode } from "@app/services/auth/auth-type";
import { createMcpSessionService } from "@app/services/vaultix/mcp-session-service";
import type { VaultixReferenceService } from "@app/services/vaultix/reference-service";

import { registerVaultixRouter } from "./vaultix-router";

const uri = `ui://vaultix/references/v1/${"a".repeat(64)}.html`;
const extension = { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } };
const init = {
  protocolVersion: "2025-11-25",
  clientInfo: { name: "independent-host", version: "1" },
  capabilities: extension
};
const body = (method: string, params: unknown = {}) => ({ jsonrpc: "2.0", id: 1, method, params });
describe("negotiated Vaultix MCP Apps routes", () => {
  const values = new Map<string, string>();
  const cache = {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    eval: vi.fn(async (_script: string, _count: number, ...args: (string | number)[]) => {
      values.set(String(args[1]), String(args[2]));
      return 1;
    }),
    del: vi.fn(async (key: string) => Number(values.delete(key)))
  };
  const listProjects = vi.fn().mockResolvedValue({ projects: [], narration: "No apps." });
  const listReferences = vi.fn().mockResolvedValue({ references: [], nextOffset: null, narration: "Names only." });
  let revoked = false;
  const app = fastify();
  beforeAll(async () => {
    app.decorate("redis", cache as unknown as Redis);
    app.addHook("onRequest", async (request) => {
      const actor = request.headers.authorization;
      if (!actor || revoked) return;
      request.auth = { authMode: AuthMode.IDENTITY_ACCESS_TOKEN, actor: ActorType.IDENTITY } as FastifyRequest["auth"];
      request.permission = {
        type: ActorType.IDENTITY,
        id: actor,
        orgId: request.headers["test-org"] ?? "org-a",
        authMethod: null
      } as FastifyRequest["permission"];
    });
    await app.register(registerVaultixRouter, {
      prefix: "/vaultix",
      appResource: async () => ({ uri, text: "<!doctype html><title>Vaultix</title>" }),
      references: { listProjects, listReferences } as VaultixReferenceService
    });
  });
  afterAll(() => app.close());
  beforeEach(() => {
    values.clear();
    vi.clearAllMocks();
    revoked = false;
  });
  const post = (method: string, params: unknown = {}, headers: Record<string, string> = { authorization: "actor-a" }) =>
    app.inject({ method: "POST", url: "/vaultix/mcp", headers, payload: body(method, params) });
  const open = async () => {
    const response = await post("initialize", init);
    expect(response.statusCode).toBe(200);
    const id = String(response.headers["mcp-session-id"]);
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    expect(response.json()).toMatchObject({
      result: { capabilities: { resources: { subscribe: false }, extensions: extension.extensions } }
    });
    return { authorization: "actor-a", "mcp-session-id": id, "mcp-protocol-version": "2025-11-25" };
  };
  test("negotiates exact resources and tool metadata while preserving meaningful text", async () => {
    const headers = await open();
    const { tools } = (await post("tools/list", {}, headers)).json<{ result: { tools: { name: string }[] } }>().result;
    expect(tools.find((tool: { name: string }) => tool.name === "vaultix.projects.list")).toMatchObject({
      _meta: { ui: { resourceUri: uri } }
    });
    expect(
      (await post("resources/list", {}, headers)).json<{ result: { resources: unknown[] } }>().result.resources
    ).toHaveLength(1);
    const read = await post("resources/read", { uri }, headers);
    expect(read.json()).toMatchObject({
      result: {
        contents: [
          {
            uri,
            mimeType: "text/html;profile=mcp-app",
            _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } }
          }
        ]
      }
    });
    expect((await post("tools/call", { name: "vaultix.projects.list", arguments: {} }, headers)).json()).toMatchObject({
      result: {
        isError: false,
        content: [{ type: "text", text: JSON.stringify({ projects: [], narration: "No apps." }) }]
      }
    });
    const arbitrary = await post("resources/read", { uri: "file:///CANARY" }, headers);
    expect(arbitrary.json()).toMatchObject({ error: { code: -32602 } });
    expect(arbitrary.body).not.toContain("CANARY");
  });
  test("text, anonymous, malformed and non-negotiating clients receive no UI session or resource", async () => {
    await Promise.all(
      (
        [
          [{ ...init, capabilities: {} }, { authorization: "actor-a" }],
          [init, {}],
          [{ ...init, protocolVersion: 4 }, { authorization: "actor-a" }]
        ] as const
      ).map(async ([params, headers]) => {
        const response = await post("initialize", params, headers);
        expect(response.headers["mcp-session-id"]).toBeUndefined();
        expect(response.body).not.toContain("resources");
      })
    );
    expect((await post("resources/read", { uri })).json()).toMatchObject({ error: { code: -32601 } });
    expect((await post("tools/list")).body).not.toContain("resourceUri");
    expect(cache.eval).not.toHaveBeenCalled();
  });
  test("binds actor and organization, rechecks authentication, rejects protocol mismatch and expired context", async () => {
    const headers = await open();
    expect((await post("resources/list", {}, { ...headers, authorization: "actor-b" })).statusCode).toBe(404);
    expect((await post("resources/list", {}, { ...headers, "test-org": "org-b" })).statusCode).toBe(404);
    expect((await post("resources/list", {}, { ...headers, "mcp-protocol-version": "2024-11-05" })).statusCode).toBe(
      400
    );
    revoked = true;
    expect((await post("resources/list", {}, headers)).statusCode).toBe(401);
    revoked = false;
    const [key, raw] = [...values.entries()][0];
    values.set(key, JSON.stringify({ ...JSON.parse(raw), expiresAt: 0 }));
    expect((await post("resources/list", {}, headers)).statusCode).toBe(404);
    expect(listProjects).not.toHaveBeenCalled();
  });
  test("domain denial does not invalidate context or replay actions; DELETE retires it", async () => {
    const headers = await open();
    listProjects.mockRejectedValueOnce(new ForbiddenRequestError({ message: "CANARY" }));
    const denied = await post("tools/call", { name: "vaultix.projects.list", arguments: {} }, headers);
    expect(denied.statusCode).toBe(200);
    expect(denied.json()).toMatchObject({ result: { isError: true } });
    expect(denied.body).not.toContain("CANARY");
    expect(listProjects).toHaveBeenCalledTimes(1);
    expect((await post("ping", {}, headers)).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: "/vaultix/mcp", headers })).statusCode).toBe(204);
    expect((await post("ping", {}, headers)).statusCode).toBe(404);
  });
  test("cache outage and issuance budget are explicit failures without leaked dependency details", async () => {
    cache.eval.mockRejectedValueOnce(new Error("CANARY-cache-address"));
    const unavailable = await post("initialize", init);
    expect(unavailable.statusCode).toBe(503);
    expect(typeof unavailable.json<{ error: string }>().error).toBe("string");
    expect(unavailable.body).not.toContain("CANARY");
    cache.eval.mockResolvedValueOnce(0);
    const limited = await post("initialize", init);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("3600");
    const headers = await open();
    cache.get.mockRejectedValueOnce(new Error("CANARY"));
    expect((await post("ping", {}, headers)).statusCode).toBe(503);
  });
  test("a second service instance shares valid cache context but not another provenance", async () => {
    const binding = { authMode: "jwt", actor: "user", actorId: "user-a", orgId: "org-a", authMethod: "email" };
    const first = createMcpSessionService(cache);
    const second = createMcpSessionService(cache);
    const id = await first.create(binding, "2025-11-25");
    await expect(second.read(binding, id, "2025-11-25")).resolves.toMatchObject({ version: 1 });
    await expect(second.read({ ...binding, authMethod: "oidc" }, id, "2025-11-25")).rejects.toMatchObject({
      statusCode: 404
    });
  });
});
