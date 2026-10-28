import fastify from "fastify";

import { registerVaultixRouter } from "./vaultix-router";

describe("native Vaultix HTTP API", () => {
  const app = fastify();
  beforeAll(async () => {
    await app.register(registerVaultixRouter, { prefix: "/api/v1/vaultix" });
  });
  afterAll(async () => {
    await app.close();
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
});
