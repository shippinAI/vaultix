import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import fastify, { type FastifyRequest } from "fastify";

import { ActorType, AuthMode } from "@app/services/auth/auth-type";
import { createVaultixReferenceDispatch } from "@app/services/vaultix/reference-dispatch";

import { registerVaultixRouter } from "./vaultix-router";

const projectId = "11111111-1111-4111-8111-111111111111";

test("public reference dispatch uses the native route and ignores actor headers", async () => {
  const seen: {
    url?: string;
    authorization?: string;
    actor?: string;
    org?: string;
    dispatch?: string;
    realIp?: string;
  }[] = [];
  const native = createServer((request, response) => {
    seen.push({
      url: request.url,
      authorization: request.headers.authorization,
      actor: request.headers["x-actor-id"] as string | undefined,
      org: request.headers["x-org-id"] as string | undefined,
      dispatch: request.headers["x-vaultix-dispatch"] as string | undefined,
      realIp: request.headers["x-real-ip"] as string | undefined
    });
    response.setHeader("content-type", "application/json");
    if (request.url?.includes("foreign")) {
      response.writeHead(404);
      response.end(JSON.stringify({ error: "This resource is unavailable." }));
      return;
    }
    response.writeHead(200);
    response.end(
      JSON.stringify({
        narration: "These secret names are safe to reference. Their values stay in your vault.",
        references: [{ name: "VISIBLE" }],
        projectId,
        environment: "dev",
        secretPath: "/",
        nextOffset: null
      })
    );
  });
  await new Promise<void>((resolve) => {
    native.listen(0, "127.0.0.1", () => resolve());
  });
  const address = native.address() as AddressInfo;
  const app = fastify();
  const audits: string[] = [];
  app.addHook("onRequest", async (request) => {
    if (request.headers.authorization === "Bearer good") {
      request.auth = { authMode: AuthMode.JWT, actor: ActorType.USER } as FastifyRequest["auth"];
      request.permission = {
        type: ActorType.USER,
        id: "actor-from-auth",
        orgId: "org-from-auth",
        authMethod: "email"
      } as FastifyRequest["permission"];
    }
  });
  await app.register(registerVaultixRouter, {
    prefix: "/api/v1/vaultix",
    referenceDispatch: createVaultixReferenceDispatch(`http://127.0.0.1:${address.port}`),
    auditReferences: async () => {
      audits.push("typescript");
    }
  });
  try {
    const denied = await app.inject({
      url: `/api/v1/vaultix/secret-references?projectId=${projectId}&environment=dev`,
      headers: { "x-actor-id": "forged-actor", "x-org-id": "forged-org" }
    });
    expect(denied.statusCode).toBe(401);
    expect(denied.json()).toEqual({ error: "Sign in to access your vault." });
    expect(seen).toHaveLength(0);

    const allowed = await app.inject({
      url: `/api/v1/vaultix/secret-references?projectId=${projectId}&environment=dev`,
      headers: {
        authorization: "Bearer good",
        "x-actor-id": "forged-actor",
        "x-org-id": "forged-org",
        "x-vaultix-dispatch": "mcp"
      },
      remoteAddress: "203.0.113.20"
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.body).not.toContain("CANARY");
    expect(allowed.json()).toMatchObject({ references: [{ name: "VISIBLE" }] });
    expect(seen[0]).toMatchObject({
      authorization: "Bearer good",
      realIp: "203.0.113.20",
      actor: undefined,
      org: undefined,
      dispatch: undefined
    });

    const mcp = await app.inject({
      method: "POST",
      url: "/api/v1/vaultix/mcp",
      headers: { authorization: "Bearer good", "x-actor-id": "forged-actor", "x-vaultix-dispatch": "forged" },
      remoteAddress: "203.0.113.20",
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "vaultix.secrets.references", arguments: { projectId, environment: "dev" } }
      }
    });
    expect(mcp.statusCode).toBe(200);
    expect(seen[1]?.dispatch).toBe("mcp");
    expect(seen[1]?.actor).toBeUndefined();
    expect(audits).toHaveLength(0);

    const foreign = await app.inject({
      url: `/api/v1/vaultix/secret-references?projectId=${projectId}&environment=foreign`,
      headers: { authorization: "Bearer good" }
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toEqual({ error: "This resource is unavailable." });
  } finally {
    await app.close();
    await new Promise<void>((resolve, reject) => {
      native.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
