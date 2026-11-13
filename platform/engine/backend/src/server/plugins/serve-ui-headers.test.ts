import helmet from "@fastify/helmet";
import fastify, { FastifyInstance } from "fastify";

import { integrationPageHeaders } from "./serve-ui-headers";

const servers: FastifyInstance[] = [];
const createServer = async () => {
  const app = fastify();
  servers.push(app);
  await app.register(helmet, { contentSecurityPolicy: false });
  app.get("/*", (request, reply) => {
    void reply.headers(integrationPageHeaders(request.url)).type("text/html").send("<!doctype html>");
  });
  return app;
};
afterEach(async () => {
  await Promise.all(servers.splice(0).map((app) => app.close()));
});

describe("integration page headers", () => {
  test.each([
    "/integrations/save-secret",
    "/integrations/save-secret/",
    "/integrations/save-secret?v=1&source=nomen&nonce=AbCdEfGhIjKlMnOpQrStUv"
  ])("%s cannot be framed, sends no referrer and keeps its opener", async (url) => {
    const app = await createServer();
    const response = await app.inject({ method: "GET", url });
    expect(response.headers["content-security-policy"]).toBe("frame-ancestors 'none'");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["cross-origin-opener-policy"]).toBe("unsafe-none");
  });

  test.each([
    "/",
    "/login",
    "/integrations/save-secretx",
    "/integrations",
    "/organizations/x/integrations/save-secret"
  ])("%s keeps the application defaults", async (url) => {
    const app = await createServer();
    const response = await app.inject({ method: "GET", url });
    expect(response.headers["content-security-policy"]).toBeUndefined();
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(response.headers["cross-origin-opener-policy"]).toBe("same-origin");
  });
});
