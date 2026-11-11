import type { FastifyReply, FastifyRequest } from "fastify";

import { getConfig } from "@app/lib/config/env";
import { readLimit, writeLimit } from "@app/server/config/rateLimiter";
import { verifyAuth } from "@app/server/plugins/auth/verify-auth";
import { AuthMode } from "@app/services/auth/auth-type";

// The assistant (docs/0123) is served by the loopback Go service. This router only forwards the
// verified bearer, the socket address and a bounded JSON body; Go authenticates again and owns
// every rule. Answers, including errors, pass through unchanged.

const sidecarUrl = () => getConfig().GOLANG_SIDECAR_URL || "http://127.0.0.1:4040";

const forward = (timeoutMs: number) => async (request: FastifyRequest, reply: FastifyReply) => {
  const headers: Record<string, string> = { accept: "application/json" };
  if (typeof request.headers.authorization === "string") headers.authorization = request.headers.authorization;
  if (request.ip) headers["x-real-ip"] = request.ip;
  const hasBody = request.method !== "GET" && request.method !== "DELETE" && request.body !== undefined;
  if (hasBody) headers["content-type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(new URL(request.url, sidecarUrl()), {
      method: request.method,
      headers,
      body: hasBody ? JSON.stringify(request.body) : undefined,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    return reply.code(503).send({
      statusCode: 503,
      error: "ServiceUnavailable",
      message: "The Vaultix assistant service is not responding. Try again in a moment."
    });
  }
  const text = await response.text();
  void reply.code(response.status).header("cache-control", "no-store");
  if (!text) return reply.send();
  return reply.type("application/json").send(text);
};

export const registerAssistantRouter = async (server: FastifyZodProvider) => {
  const auth = verifyAuth([AuthMode.JWT]);
  const routes: { method: "GET" | "POST" | "PATCH" | "DELETE"; url: string; timeoutMs: number; bodyLimit?: number }[] = [
    { method: "GET", url: "/assistant", timeoutMs: 15_000 },
    { method: "POST", url: "/messages", timeoutMs: 120_000, bodyLimit: 256 * 1024 },
    { method: "GET", url: "/providers", timeoutMs: 15_000 },
    { method: "POST", url: "/providers", timeoutMs: 15_000, bodyLimit: 32 * 1024 },
    { method: "PATCH", url: "/providers/:providerId", timeoutMs: 15_000, bodyLimit: 32 * 1024 },
    { method: "DELETE", url: "/providers/:providerId", timeoutMs: 15_000 },
    { method: "POST", url: "/providers/:providerId/test", timeoutMs: 60_000, bodyLimit: 1024 },
    { method: "GET", url: "/personas", timeoutMs: 15_000 },
    { method: "POST", url: "/personas", timeoutMs: 15_000, bodyLimit: 32 * 1024 },
    { method: "PATCH", url: "/personas/:slug", timeoutMs: 15_000, bodyLimit: 32 * 1024 },
    { method: "DELETE", url: "/personas/:slug", timeoutMs: 15_000 },
    { method: "POST", url: "/personas/:slug/reset", timeoutMs: 15_000, bodyLimit: 1024 }
  ];
  for (const route of routes) {
    server.route({
      method: route.method,
      url: route.url,
      bodyLimit: route.bodyLimit,
      config: { rateLimit: route.method === "GET" ? readLimit : writeLimit },
      schema: { hide: false, tags: ["Vaultix assistant"] },
      onRequest: auth,
      handler: forward(route.timeoutMs)
    });
  }
};
