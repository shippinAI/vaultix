import cookie from "@fastify/cookie";
import fastify from "fastify";

import { fastifyErrHandler } from "@app/server/plugins/error-handler";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "@app/server/plugins/fastify-zod";

import { registerLoginRouter } from "./login-router";

vi.mock("@app/lib/config/env", () => ({
  getConfig: () => ({ HTTPS_ENABLED: false, OTEL_TELEMETRY_COLLECTION_ENABLED: false })
}));

describe("POST /api/v3/auth/login built-in password route", () => {
  const password = "fixture-password";
  const login = vi.fn(async () => ({
    tokens: { accessToken: "fixture-access", refreshToken: "fixture-refresh" },
    user: { id: "user-1", email: "person@example.com", username: "person" }
  }));
  const app = fastify()
    .setValidatorCompiler(validatorCompiler)
    .setSerializerCompiler(serializerCompiler)
    .withTypeProvider<ZodTypeProvider>();

  beforeAll(async () => {
    await app.register(cookie);
    app.decorate("services", {
      login: { login },
      telemetry: { identifyUser: vi.fn() }
    } as never);
    await app.register(fastifyErrHandler);
    await app.register(registerLoginRouter, { prefix: "/api/v3/auth" });
  });
  afterAll(() => app.close());
  beforeEach(() => vi.clearAllMocks());

  test("accepts a password login without an external issuer and does not echo the password", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v3/auth/login",
      headers: { "user-agent": "vaultix-test" },
      payload: { email: "person@example.com", password }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accessToken: "fixture-access" });
    expect(response.body).not.toContain(password);
    expect(response.body).not.toContain("fixture-refresh");
    expect(login).toHaveBeenCalledWith(
      expect.objectContaining({ email: "person@example.com", password, userAgent: "vaultix-test" })
    );
    expect(JSON.stringify(login.mock.calls)).not.toMatch(/nomen|issuer/i);
  });

  test("does not call the login service without a user agent", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v3/auth/login",
      headers: { "user-agent": "" },
      payload: { email: "person@example.com", password }
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.body).not.toContain(password);
    expect(login).not.toHaveBeenCalled();
  });
});
