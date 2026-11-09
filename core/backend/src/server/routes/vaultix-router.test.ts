import fastify from "fastify";

import { getVaultixAuthConfig, publicInstanceURL } from "@app/services/vaultix/auth-config";
import type { VaultixReferenceService } from "@app/services/vaultix/reference-service";
import type { VaultixLearningMemory } from "@app/services/vaultix/catalog";

import { registerVaultixRouter } from "./vaultix-router";

describe("native Vaultix HTTP API", () => {
  const app = fastify();
  beforeAll(async () => {
    await app.register(registerVaultixRouter, { prefix: "/api/v1/vaultix" });
  });
  afterAll(async () => {
    await app.close();
  });

  test("publishes built-in headless login without requiring SSO", async () => {
    const previous = process.env.NOMEN_OIDC_ISSUER;
    delete process.env.NOMEN_OIDC_ISSUER;
    const response = await app.inject("/api/v1/vaultix/auth/config");
    if (previous === undefined) delete process.env.NOMEN_OIDC_ISSUER;
    else process.env.NOMEN_OIDC_ISSUER = previous;
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(getVaultixAuthConfig(undefined));
    const body = response.json<{
      profiles: { id: string; requiresExternalIssuer: boolean; loginPath?: string }[];
      cli: { headless: string[]; headlessRequiresSso: boolean; interactiveTerminalDefault: string };
    }>();
    expect(body.profiles.map((profile) => profile.id)).toEqual([
      "builtin-password",
      "builtin-universal",
      "builtin-token"
    ]);
    expect(body.profiles.every((profile) => profile.requiresExternalIssuer === false)).toBe(true);
    expect(body.profiles.find((profile) => profile.id === "builtin-universal")?.loginPath).toBe(
      "/api/v1/auth/universal-auth/login"
    );
    expect(body.cli.headlessRequiresSso).toBe(false);
    expect(body.cli.headless).toEqual(["token", "universal"]);
    expect(body.cli.interactiveTerminalDefault).toBe("sso");
    expect(response.body).not.toContain("device_code");
    expect(response.body).not.toContain("auth.shippin.ai");
    process.env.NOMEN_OIDC_ISSUER = "https://user:secret@issuer.example/path";
    const configured = await app.inject("/api/v1/vaultix/auth/config");
    delete process.env.NOMEN_OIDC_ISSUER;
    if (previous !== undefined) process.env.NOMEN_OIDC_ISSUER = previous;
    expect(configured.json()).toEqual(getVaultixAuthConfig(undefined, "https://user:secret@issuer.example/path"));
    expect(configured.body).toContain("https://issuer.example");
    expect(configured.body).not.toContain("secret");
    expect(publicInstanceURL("https://user:secret@vaultix.example/path?token=1")).toBe("https://vaultix.example");
    expect(publicInstanceURL("not a url")).toBe("");
  });

  test("serves catalog and product identity on the core API", async () => {
    const product = await app.inject("/api/v1/vaultix/product");
    expect(product.statusCode).toBe(200);
    expect(product.json()).toMatchObject({
      product: "Vaultix",
      featurePolicy: "included",
      enterpriseParity: "in-progress"
    });
    const catalog = await app.inject("/api/v1/vaultix/catalog");
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json()).toMatchObject({ source: "catalog" });
    expect(catalog.json<{ didYouKnow: { id: string }[] }>().didYouKnow.length).toBeGreaterThan(0);
    expect(catalog.json<{ knowledgeDrops: { id: string }[] }>().knowledgeDrops.length).toBeGreaterThan(0);
    expect(catalog.json<{ enterpriseCapabilities: { id: string }[] }>().enterpriseCapabilities.length).toBeGreaterThan(
      0
    );
  });
  test("shares authored learning through HTTP and MCP without implying verified parity", async () => {
    const document = (await app.inject("/api/v1/vaultix/catalog")).json<{
      didYouKnow: { source: string; context: string[] }[];
      knowledgeDrops: { source: string; context: string[] }[];
      enterpriseCapabilities: { featurePolicy: string; reviewStatus: string }[];
    }>();
    for (const signal of [...document.didYouKnow, ...document.knowledgeDrops]) {
      expect(signal.source).toBe("catalog");
      expect(signal.context.every((area) => ["references", "connections"].includes(area))).toBe(true);
    }
    for (const capability of document.enterpriseCapabilities) {
      expect(capability).toMatchObject({ featurePolicy: "included", reviewStatus: "in-progress" });
    }
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/vaultix/mcp",
      payload: { jsonrpc: "2.0", id: 20, method: "tools/call", params: { name: "vaultix.catalog.get", arguments: {} } }
    });
    expect(JSON.parse(response.json<{ result: { content: { text: string }[] } }>().result.content[0].text)).toEqual(
      document
    );
  });
  test("rejects query parameters and cross-origin requests with plain errors", async () => {
    await Promise.all(
      [
        { url: "/api/v1/vaultix/catalog?value=CANARY-SECRET" },
        { url: "/api/v1/vaultix/guidance?value=CANARY-SECRET" },
        { url: "/api/v1/vaultix/catalog", headers: { host: "vaultix.example", origin: "https://evil.example" } }
      ].map(async (options) => {
        const response = await app.inject(options);
        expect(response.statusCode).toBeGreaterThanOrEqual(400);
        expect(typeof response.json<{ error: unknown }>().error).toBe("string");
        expect(response.body).not.toContain("CANARY-SECRET");
      })
    );
  });
  test("serves the same authored teaching document through HTTP and MCP", async () => {
    const response = await app.inject("/api/v1/vaultix/guidance");
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      schemaVersion: "vaultix.guidance.v1",
      source: "catalog",
      a2uiVersion: "0.9.1"
    });
    const mcp = await app.inject({
      method: "POST",
      url: "/api/v1/vaultix/mcp",
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "vaultix.guidance.get", arguments: {} }
      }
    });
    expect(JSON.parse(mcp.json<{ result: { content: { text: string }[] } }>().result.content[0].text)).toEqual(
      response.json()
    );
    const denied = await app.inject({
      method: "POST",
      url: "/api/v1/vaultix/mcp",
      payload: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "vaultix.guidance.get", arguments: { value: "CANARY-SECRET" } }
      }
    });
    expect(denied.json<{ error: { code: number } }>().error.code).toBe(-32602);
    expect(denied.body).not.toContain("CANARY-SECRET");
  });
  test("generates a learning profile from the current user context", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/vaultix/learning-context",
      payload: {
        area: "references",
        project: "payments",
        environment: "production",
        path: "/service/api",
        action: "Show References",
        interactions: 4
      }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      schemaVersion: "vaultix.learning.v1",
      skillLevel: "advanced"
    });
    expect(response.body).not.toContain("secret");
  });

  test("supports the learning profile tool with explicit context arguments", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/vaultix/mcp",
      payload: {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "vaultix.learning.profile.get",
          arguments: {
            area: "connections",
            project: "billing",
            environment: "staging",
            interactions: 2
          }
        }
      }
    });
    expect(response.statusCode).toBe(200);
    const data = JSON.parse(
      response.json<{ result: { content: Array<{ text: string }> } }>().result.content[0].text
    ) as VaultixLearningMemory;
    expect(data).toMatchObject({
      schemaVersion: "vaultix.learning.v1",
      skillLevel: "intermediate"
    });
    expect(data.trackedContext).toEqual(expect.arrayContaining(["connections", "billing", "staging"]));
  });

  test("bounds body sizes and acknowledges MCP notifications", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/vaultix/mcp",
      payload: { jsonrpc: "2.0", method: "notifications/initialized" }
    });
    expect(response.statusCode).toBe(202);
    expect(response.body).toBe("");
    const large = await app.inject({
      method: "POST",
      url: "/api/v1/vaultix/mcp",
      payload: { value: "x".repeat(20000) }
    });
    expect(large.statusCode).toBe(413);
    expect(typeof large.json<{ error: unknown }>().error).toBe("string");
  });

  test("does not serve the UI as an MCP event stream", async () => {
    const response = await app.inject("/api/v1/vaultix/mcp");
    expect(response.statusCode).toBe(405);
    expect(response.headers.allow).toBe("POST");
    expect(typeof response.json<{ error: unknown }>().error).toBe("string");
  });

  test("ignores spoofed actor and address headers on an unauthenticated reference read", async () => {
    const guarded = fastify();
    let reads = 0;
    let audits = 0;
    await guarded.register(registerVaultixRouter, {
      prefix: "/api/v1/vaultix",
      references: {
        listProjects: async () => {
          reads += 1;
          return { projects: [] };
        },
        listReferences: async () => {
          reads += 1;
          return { references: [{ name: "CANARY-SECRET", value: "CANARY-VALUE", comment: "CANARY-COMMENT" }] };
        }
      } as unknown as VaultixReferenceService,
      auditReferences: async () => {
        audits += 1;
      }
    });
    const headers = {
      "x-real-ip": "198.51.100.7",
      "x-forwarded-for": "198.51.100.7",
      "x-actor-id": "forged-actor",
      "x-org-id": "forged-org",
      authorization: "Bearer not-a-session"
    };
    const response = await guarded.inject({ url: "/api/v1/vaultix/secret-references", headers });
    const mcp = await guarded.inject({
      method: "POST",
      url: "/api/v1/vaultix/mcp",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "vaultix.secrets.references", arguments: { projectId: "forged-project" } }
      }
    });
    expect(response.statusCode).toBe(401);
    expect(mcp.statusCode).toBeGreaterThanOrEqual(400);
    expect(reads).toBe(0);
    expect(audits).toBe(0);
    expect(response.body).not.toContain("CANARY-VALUE");
    expect(mcp.body).not.toContain("CANARY-VALUE");
    expect(response.body).not.toContain("forged-actor");
    await guarded.close();
  });

  test("enforces the public guidance rate limit", async () => {
    const limited = fastify();
    await limited.register(registerVaultixRouter, { prefix: "/api/v1/vaultix" });
    const readUntilLimited = async (attempt: number): Promise<{ statusCode: number; body: string }> => {
      const response = await limited.inject("/api/v1/vaultix/catalog");
      if (response.statusCode === 429 || attempt === 120) return response;
      expect(response.statusCode).toBe(200);
      return readUntilLimited(attempt + 1);
    };
    const response = await readUntilLimited(0);
    expect(response.statusCode).toBe(429);
    expect(typeof JSON.parse(response.body).error).toBe("string");
    await limited.close();
  });
});
