import rateLimit from "@fastify/rate-limit";
import fastify, { FastifyInstance } from "fastify";

import { registerVaultixRouter } from "@app/server/routes/vaultix-router";

import { fastifyIp, resolveProxyTrust } from "./ip";

const servers: FastifyInstance[] = [];
const createServer = async (trustedProxyCidrs?: string) => {
  const app = fastify({ trustProxy: resolveProxyTrust(trustedProxyCidrs) });
  servers.push(app);
  await app.register(fastifyIp);
  app.get("/address", async (request) => ({
    ip: request.ip,
    realIp: request.realIp,
    host: request.host,
    protocol: request.protocol
  }));
  return app;
};
afterEach(async () => {
  await Promise.all(servers.splice(0).map((app) => app.close()));
});

const forwardedHeaders = [
  "cf-connecting-ip",
  "cf-pseudo-ipv4",
  "x-client-ip",
  "x-envoy-external-address",
  "x-forwarded-for",
  "fastly-client-ip",
  "true-client-ip",
  "x-real-ip",
  "x-cluser-client-ip",
  "forwarded-for",
  "x-forwarded",
  "forwarded",
  "x-appengine-user-ip"
];

describe("Vaultix proxy authority", () => {
  test.each(forwardedHeaders)("ignores untrusted %s for both address consumers", async (header) => {
    const app = await createServer();
    const response = await app.inject({
      url: "/address",
      remoteAddress: "203.0.113.20",
      headers: { [header]: "198.51.100.99" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ip: "203.0.113.20", realIp: "203.0.113.20" });
  });
  test.each([undefined, "", "   "])(
    "unset/blank trust also ignores forwarded host and protocol: %s",
    async (config) => {
      const app = await createServer(config);
      const response = await app.inject({
        url: "/address",
        remoteAddress: "203.0.113.20",
        headers: {
          host: "vaultix.example",
          "x-forwarded-for": "198.51.100.99",
          "cf-connecting-ip": "198.51.100.88",
          "x-forwarded-host": "forged.invalid",
          "x-forwarded-proto": "https"
        }
      });
      expect(response.json()).toEqual({
        ip: "203.0.113.20",
        realIp: "203.0.113.20",
        host: "vaultix.example",
        protocol: "http"
      });
    }
  );
  test("untrusted peers cannot use a configured proxy chain", async () => {
    const app = await createServer("192.0.2.10/32");
    const response = await app.inject({
      url: "/address",
      remoteAddress: "203.0.113.20",
      headers: { "x-forwarded-for": "198.51.100.99, 192.0.2.10", "cf-connecting-ip": "198.51.100.88" }
    });
    expect(response.json()).toMatchObject({ ip: "203.0.113.20", realIp: "203.0.113.20" });
  });
  test("trusted hops stop at the nearest untrusted address and ignore vendor-header precedence", async () => {
    const app = await createServer(" 192.0.2.10/32, 192.0.2.11/32 ");
    const response = await app.inject({
      url: "/address",
      remoteAddress: "192.0.2.10",
      headers: {
        "x-forwarded-for": "198.51.100.99, 203.0.113.20, 192.0.2.11",
        "cf-connecting-ip": "198.51.100.88",
        "x-forwarded-host": "vaultix.example",
        "x-forwarded-proto": "https"
      }
    });
    expect(response.json()).toEqual({
      ip: "203.0.113.20",
      realIp: "203.0.113.20",
      host: "vaultix.example",
      protocol: "https"
    });
  });
  test.each([
    ["2001:db8:1::/64", "2001:db8:1::1", "2001:db8:2::1"],
    ["192.0.2.10/32", "::ffff:192.0.2.10", "203.0.113.20"],
    ["loopback", "::1", "203.0.113.20"]
  ])("supports configured IPv6, mapped IPv4 and named ranges: %s", async (trust, peer, client) => {
    const app = await createServer(trust);
    const response = await app.inject({ url: "/address", remoteAddress: peer, headers: { "x-forwarded-for": client } });
    expect(response.json()).toMatchObject({ ip: client, realIp: client });
  });
  test("trusted peers without forwarding metadata retain their socket address", async () => {
    const app = await createServer("192.0.2.10/32");
    const response = await app.inject({
      url: "/address",
      remoteAddress: "192.0.2.10",
      headers: { "cf-connecting-ip": "198.51.100.88" }
    });
    expect(response.json()).toMatchObject({ ip: "192.0.2.10", realIp: "192.0.2.10" });
  });
  test("invalid configured ranges fail startup rather than reverting to trust-all", () => {
    expect(() => fastify({ trustProxy: resolveProxyTrust("not-a-network") })).toThrow();
  });
  test("forged headers do not reset the actual native guidance limit", async () => {
    const app = await createServer();
    await app.register(registerVaultixRouter, { prefix: "/api/v1/vaultix" });
    for (let i = 0; i < 121; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- Count the ordered requests in one rate window.
      const response = await app.inject({
        url: "/api/v1/vaultix/catalog",
        remoteAddress: "203.0.113.20",
        headers: { "x-forwarded-for": `198.51.100.${i}`, "cf-connecting-ip": `198.51.100.${i}` }
      });
      expect(response.statusCode).toBe(i < 120 ? 200 : 429);
      if (i === 120) {
        expect(typeof response.json<{ error: unknown }>().error).toBe("string");
        expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
      }
    }
  });
  test("explicit proxy clients retain independent realIp rate buckets", async () => {
    const app = await createServer("192.0.2.10/32");
    await app.register(rateLimit, { max: 2, timeWindow: "1 minute", keyGenerator: (request) => request.realIp });
    app.get("/limited", async () => ({ ok: true }));
    for (const client of ["203.0.113.20", "203.0.113.21"]) {
      for (const expected of [200, 200, 429]) {
        // eslint-disable-next-line no-await-in-loop -- Assert each client exhausts only its own bucket.
        const response = await app.inject({
          url: "/limited",
          remoteAddress: "192.0.2.10",
          headers: { "x-forwarded-for": client }
        });
        expect(response.statusCode).toBe(expected);
      }
    }
  });
});
