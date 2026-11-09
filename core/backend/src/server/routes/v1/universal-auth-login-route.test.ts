import fastify from "fastify";

import { fastifyErrHandler } from "@app/server/plugins/error-handler";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "@app/server/plugins/fastify-zod";

import { registerIdentityUaRouter } from "./identity-universal-auth-router";

vi.mock("@app/lib/config/env", () => ({
  getConfig: () => ({ OTEL_TELEMETRY_COLLECTION_ENABLED: false })
}));

describe("POST /api/v1/auth/universal-auth/login", () => {
  const clientSecret = "fixture-client-secret";
  const login = vi.fn(async () => ({
    identityUa: { identityId: "identity-1", id: "ua-1" },
    accessToken: "fixture-access",
    identityAccessToken: { id: "iat-1" },
    validClientSecretInfo: { id: "secret-row" },
    identity: { name: "workload", orgId: "org-1" },
    accessTokenTTL: 60,
    accessTokenMaxTTL: 120
  }));
  const app = fastify()
    .setValidatorCompiler(validatorCompiler)
    .setSerializerCompiler(serializerCompiler)
    .withTypeProvider<ZodTypeProvider>();

  beforeAll(async () => {
    app.decorate("services", {
      identityUa: { login },
      auditLog: { createAuditLog: vi.fn() },
      telemetry: { sendPostHogEvents: vi.fn(async () => undefined) }
    } as never);
    app.addHook("onRequest", async (request) => {
      request.auditLogInfo = {
        userAgent: "vaultix-test",
        userAgentType: "cli",
        ipAddress: "127.0.0.1"
      } as typeof request.auditLogInfo;
    });
    await app.register(fastifyErrHandler);
    await app.register(registerIdentityUaRouter, { prefix: "/api/v1/auth" });
  });
  afterAll(() => app.close());
  beforeEach(() => vi.clearAllMocks());

  test("exchanges a machine identity without an external issuer and does not echo the secret", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/universal-auth/login",
      payload: { clientId: "fixture-client", clientSecret }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      accessToken: "fixture-access",
      tokenType: "Bearer",
      expiresIn: 60,
      accessTokenMaxTTL: 120
    });
    expect(response.body).not.toContain(clientSecret);
    expect(login).toHaveBeenCalledWith(expect.objectContaining({ clientId: "fixture-client", clientSecret }));
    expect(JSON.stringify(login.mock.calls)).not.toMatch(/nomen|openid-configuration/i);
  });
});
