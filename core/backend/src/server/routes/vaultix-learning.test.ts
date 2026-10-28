import fastify from "fastify";

import { validatorCompiler } from "@app/server/plugins/fastify-zod";
import type { VaultixLearningMemory } from "@app/services/vaultix/catalog";
import { learningContextSchema, parseLearningContext } from "@app/services/vaultix/learning-input";

import { registerVaultixRouter } from "./vaultix-router";

describe("bounded public teaching context", () => {
  const app = fastify();
  app.setValidatorCompiler(validatorCompiler);
  const call = (args: unknown) =>
    app.inject({
      method: "POST",
      url: "/mcp",
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "vaultix.learning.profile.get", arguments: args }
      }
    });
  beforeAll(async () => {
    await app.register(registerVaultixRouter);
  });
  afterAll(async () => {
    await app.close();
  });

  test.each([
    null,
    [],
    "CANARY-SECRET",
    { project: 42 },
    { path: {} },
    { connection: [] },
    { area: "unknown" },
    { project: "x".repeat(129) },
    { path: "x".repeat(1025) },
    { search: "x".repeat(257) },
    { interactions: "2" },
    { interactions: -1 },
    { interactions: 1.5 },
    { interactions: 1000001 },
    { value: "CANARY-SECRET" },
    { project: "payments", actorOrgId: "CANARY-SECRET" }
  ])("rejects malformed input on HTTP and MCP without reflecting it: %j", async (input) => {
    const response = await app.inject({
      method: "POST",
      url: "/learning-context",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(input)
    });
    expect(response.statusCode).toBe(400);
    expect(typeof response.json<{ error: unknown }>().error).toBe("string");
    expect(response.body).not.toContain("CANARY-SECRET");
    const mcp = await call(input);
    expect(mcp.statusCode).toBe(200);
    expect(mcp.json()).toMatchObject({ error: { code: -32602 } });
    expect(mcp.body).not.toContain("CANARY-SECRET");
  });

  test("publishes the accepted schema and produces matching HTTP/MCP profiles", async () => {
    const listing = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: { jsonrpc: "2.0", id: 2, method: "tools/list" }
    });
    const tool = listing
      .json<{ result: { tools: { name: string; inputSchema: unknown }[] } }>()
      .result.tools.find(({ name }) => name === "vaultix.learning.profile.get");
    expect(tool?.inputSchema).toEqual(learningContextSchema);
    const context = { area: "references", project: "payments", environment: "staging", interactions: 2 };
    const http = await app.inject({ method: "POST", url: "/learning-context", payload: context });
    const mcp = await call(context);
    const result = JSON.parse(
      mcp.json<{ result: { content: { text: string }[] } }>().result.content[0].text
    ) as VaultixLearningMemory;
    expect(http.statusCode).toBe(200);
    expect(result).toMatchObject({
      schemaVersion: "vaultix.learning.v1",
      skillLevel: "intermediate",
      trackedContext: ["references", "payments", "staging"]
    });
    expect(http.json()).toMatchObject({ skillLevel: result.skillLevel, trackedContext: result.trackedContext });
    expect(http.headers["cache-control"]).toBe("no-store");
  });

  test("rejects nonfinite numbers and preserves JSON Schema Unicode length semantics", () => {
    for (const interactions of [NaN, Infinity, -Infinity])
      expect(parseLearningContext({ interactions })).toBeUndefined();
    expect(parseLearningContext({ project: "🌱".repeat(128), interactions: 1000000 })).toBeDefined();
    expect(parseLearningContext({ project: "🌱".repeat(129) })).toBeUndefined();
  });

  test("bounds HTTP context bodies and retains empty-context compatibility", async () => {
    const large = await app.inject({
      method: "POST",
      url: "/learning-context",
      payload: { project: "x".repeat(20000) }
    });
    expect(large.statusCode).toBe(413);
    expect(typeof large.json<{ error: unknown }>().error).toBe("string");
    const empty = await call(undefined);
    expect(JSON.parse(empty.json<{ result: { content: { text: string }[] } }>().result.content[0].text)).toMatchObject({
      skillLevel: "starter",
      trackedContext: [],
      recentEvents: []
    });
  });
});
