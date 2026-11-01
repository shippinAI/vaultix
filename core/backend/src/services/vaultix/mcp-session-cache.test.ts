import { randomUUID } from "node:crypto";

import Redis from "ioredis";

import { createMcpSessionService } from "./mcp-session-service";

// Explicit disposable-cache acceptance. Unit fixtures cannot establish Lua/TTL behavior.
describe.skipIf(!process.env.VAULTIX_TEST_MCP_CACHE_URL)("MCP sessions on an actual disposable cache", () => {
  const cache = new Redis(process.env.VAULTIX_TEST_MCP_CACHE_URL ?? "redis://127.0.0.1:6379", {
    lazyConnect: true,
    retryStrategy: () => null
  });
  afterAll(() => cache.disconnect());
  test("atomic concurrent quota, shared replicas, expiry and retirement", async () => {
    const binding = { authMode: "jwt", actor: "user", actorId: randomUUID(), orgId: randomUUID(), authMethod: "email" };
    const first = createMcpSessionService(cache);
    const second = createMcpSessionService(cache);
    const issued = await Promise.allSettled(Array.from({ length: 12 }, () => first.create(binding, "2025-11-25")));
    const accepted = issued.filter((value): value is PromiseFulfilledResult<string> => value.status === "fulfilled");
    expect(accepted).toHaveLength(8);
    issued
      .filter((value) => value.status === "rejected")
      .forEach((value) => {
        if (value.status === "rejected") expect(value.reason).toMatchObject({ statusCode: 429 });
      });
    const id = accepted[0].value;
    await expect(second.read(binding, id, "2025-11-25")).resolves.toMatchObject({ version: 1 });
    await expect(second.read({ ...binding, orgId: randomUUID() }, id, "2025-11-25")).rejects.toMatchObject({
      statusCode: 404
    });
    const expired = createMcpSessionService(cache, () => Date.now() + 4 * 60 * 60 * 1000 + 1);
    await expect(expired.read(binding, id, "2025-11-25")).rejects.toMatchObject({ statusCode: 404 });
    const keys = await cache.keys(`vaultix:mcp:v1:*:session:${id}`);
    expect(keys).toHaveLength(1);
    expect(await cache.ttl(keys[0])).toBeGreaterThan(14300);
    await first.remove(binding, id);
    await expect(second.read(binding, id, "2025-11-25")).rejects.toMatchObject({ statusCode: 404 });
  });
});
