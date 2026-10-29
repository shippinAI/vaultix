/* eslint-disable no-await-in-loop -- Sequential requests verify the exact admission boundary. */
import fastify, { FastifyInstance } from "fastify";

import { RateLimitError } from "@app/lib/errors";
import { mfaRateLimit } from "@app/server/config/rateLimiter";
import { registerVaultixRouter } from "@app/server/routes/vaultix-router";

import { fastifyIp } from "./ip";
import { productionRateLimit } from "./production-rate-limit";

const mocks = vi.hoisted(() => ({
  config: { isProductionMode: true, isRedisConfigured: true, isCloud: false },
  buildRedis: vi.fn()
}));
vi.mock("@app/lib/config/env", () => ({ getConfig: () => mocks.config }));
vi.mock("@app/lib/config/redis", () => ({ buildRedisFromConfig: mocks.buildRedis }));

const servers: FastifyInstance[] = [];
let keys: string[];
let disconnected: ReturnType<typeof vi.fn>;
let failed: boolean;
beforeEach(() => {
  mocks.config.isProductionMode = true;
  mocks.config.isRedisConfigured = true;
  keys = [];
  failed = false;
  disconnected = vi.fn();
  const counters = new Map<string, number>();
  mocks.buildRedis.mockReset().mockReturnValue({
    disconnect: disconnected,
    rateLimit: (
      key: string,
      _window: number,
      _max: number,
      _continue: boolean,
      _backoff: boolean,
      callback: (error: Error | null, result?: number[]) => void
    ) => {
      keys.push(key);
      const count = (counters.get(key) ?? 0) + 1;
      counters.set(key, count);
      callback(failed ? new Error("fixture cache unavailable") : null, [count, 30000]);
    }
  });
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((app) => app.close()));
});
const create = async () => {
  const app = fastify();
  servers.push(app);
  await app.register(fastifyIp);
  await app.register(productionRateLimit);
  await app.register(registerVaultixRouter, { prefix: "/api/v1/vaultix" });
  return app;
};

describe("production request admission", () => {
  test("shares native budgets and returns 429 across replicas without a cloud license", async () => {
    const apps = [await create(), await create()];
    for (let index = 0; index < 120; index += 1) {
      const response = await apps[index % 2].inject("/api/v1/vaultix/catalog");
      expect(response.statusCode).toBe(200);
    }
    expect(keys).toHaveLength(120);
    for (const app of apps) {
      const denied = await app.inject("/api/v1/vaultix/catalog");
      expect(denied.statusCode).toBe(429);
      expect(denied.json<{ error: string }>().error).toContain("Too many requests");
      expect(denied.headers["retry-after"]).toBe("30");
      expect((await app.inject("/api/v1/vaultix/product")).statusCode).toBe(200);
    }
  });
  test("fails closed without reflecting cache diagnostics", async () => {
    const app = await create();
    failed = true;
    const response = await app.inject("/api/v1/vaultix/catalog");
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "Vaultix could not complete the request." });
  });
  test("bounds admission cache commands and releases its dedicated client", async () => {
    const app = await create();
    expect(mocks.buildRedis).toHaveBeenCalledWith(mocks.config, "rate-limiter", {
      commandTimeout: 2000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false
    });
    await app.close();
    expect(disconnected).toHaveBeenCalledOnce();
  });
  test("keeps development native limits local", async () => {
    mocks.config.isProductionMode = false;
    const app = await create();
    expect((await app.inject("/api/v1/vaultix/catalog")).statusCode).toBe(200);
    expect(mocks.buildRedis).not.toHaveBeenCalled();
  });
  test("refuses a production local-memory fallback", async () => {
    mocks.config.isRedisConfigured = false;
    await expect(create()).rejects.toThrow("Production request limits require a configured Vaultix cache");
    expect(mocks.buildRedis).not.toHaveBeenCalled();
  });
  test("keeps MFA credentials out of shared cache keys and preserves per-token isolation", async () => {
    const app = await create();
    app.setErrorHandler((error: Error, _request, reply) =>
      reply.code(error instanceof RateLimitError ? 429 : 500).send({ error: error.name })
    );
    app.decorateRequest("rateLimits");
    app.addHook("onRequest", async (request) => {
      request.rateLimits = { mfaRateLimit: 1 } as typeof request.rateLimits;
    });
    app.post("/mfa", { config: { rateLimit: mfaRateLimit } }, async () => ({ ok: true }));
    const first = {
      method: "POST" as const,
      url: "/mfa",
      headers: { authorization: "Bearer fixture-sensitive-token-a" }
    };
    expect((await app.inject(first)).statusCode).toBe(200);
    expect((await app.inject(first)).statusCode).toBe(429);
    expect(
      (await app.inject({ ...first, headers: { authorization: "Bearer fixture-sensitive-token-b" } })).statusCode
    ).toBe(200);
    expect((await app.inject({ method: "POST", url: "/mfa" })).statusCode).toBe(200);
    expect(keys[0]).toEqual(keys[1]);
    expect(keys[0]).not.toEqual(keys[2]);
    expect(keys.join(" ")).not.toContain("fixture-sensitive-token");
    expect(keys[0]).toMatch(/token:[a-f0-9]{64}$/);
    expect(keys[3]).toContain("127.0.0.1");
  });
});
