import type { IncomingHttpHeaders } from "node:http";

import fastify from "fastify";

import { forwardToGoSidecar } from "./go-sidecar-forwarding";
import { shadowToGoSidecar } from "./go-sidecar-shadowing";
import { fastifyIp, resolveProxyTrust } from "./ip";
import { sidecarRequestHeaders } from "./sidecar-request-headers";

vi.mock("@app/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

test("normalizes conflicting header casing and preserves unrelated authentication headers", () => {
  const result = sidecarRequestHeaders(
    {
      "X-Real-IP": "forged",
      "x-real-ip": "forged",
      "True-Client-IP": "forged",
      Forwarded: "forged",
      "CF-Connecting-IP": "forged",
      Authorization: "Bearer fixture",
      "x-request-id": "forged",
      "x-custom-list": ["one", "two"]
    },
    "request-owned",
    "203.0.113.20"
  );
  expect(result).toEqual({
    "x-request-id": "request-owned",
    "x-real-ip": "203.0.113.20",
    "x-forwarded-for": "203.0.113.20",
    authorization: "Bearer fixture",
    "x-custom-list": ["one", "two"]
  });
});

test.each(["forward", "shadow"])(
  "%s transport sends a single owned address to the internal HTTP peer",
  async (mode) => {
    const target = fastify();
    const proxy = fastify({ trustProxy: resolveProxyTrust(), genReqId: () => "request-owned" });
    let captured: { headers: IncomingHttpHeaders; raw: string[] } | undefined;
    vi.stubEnv("NO_PROXY", "127.0.0.1");
    try {
      target.get("/api/v4/secrets", async (request) => {
        captured = { headers: request.headers, raw: request.raw.rawHeaders };
        return { ok: true };
      });
      const sidecarUrl = await target.listen({ host: "127.0.0.1", port: 0 });
      await proxy.register(fastifyIp);
      if (mode === "forward") await proxy.register(forwardToGoSidecar, { sidecarUrl });
      else await proxy.register(shadowToGoSidecar, { sidecarUrl, sampleRate: 100 });
      proxy.get("/api/v4/secrets", async () => ({ ok: true }));
      const response = await proxy.inject({
        url: "/api/v4/secrets",
        remoteAddress: "203.0.113.20",
        headers: {
          "x-real-ip": "198.51.100.77",
          "x-forwarded-for": "198.51.100.77",
          "cf-connecting-ip": "198.51.100.77",
          "true-client-ip": "198.51.100.77",
          forwarded: "for=198.51.100.77",
          "x-request-id": "caller-chosen",
          authorization: "Bearer fixture"
        }
      });
      expect(response.statusCode).toBe(200);
      await vi.waitFor(() => expect(captured).toBeDefined());
      expect(captured?.headers).toMatchObject({
        "x-real-ip": "203.0.113.20",
        "x-forwarded-for": "203.0.113.20",
        "x-request-id": "request-owned",
        authorization: "Bearer fixture"
      });
      expect(captured?.headers["true-client-ip"]).toBeUndefined();
      expect(captured?.headers["cf-connecting-ip"]).toBeUndefined();
      expect(captured?.headers.forwarded).toBeUndefined();
      expect(
        captured?.raw.filter((header, index) => index % 2 === 0 && header.toLowerCase() === "x-real-ip")
      ).toHaveLength(1);
    } finally {
      await proxy.close();
      await target.close();
      vi.unstubAllEnvs();
    }
  }
);
