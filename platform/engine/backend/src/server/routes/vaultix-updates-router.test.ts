import fastify, { FastifyInstance, FastifyRequest } from "fastify";

import { ActorType, AuthMode } from "@app/services/auth/auth-type";

import { registerVaultixRouter } from "./vaultix-router";

describe("Vaultix release status HTTP boundary", () => {
  let app: FastifyInstance;
  const status = {
    schemaVersion: "vaultix.updates.v1",
    state: "unknown",
    currentVersion: "1.0.0",
    latestVersion: null,
    checkedAt: null,
    channel: "stable",
    releaseUrl: "https://github.com/shippinAI/vaultix/releases"
  } as const;
  const getStatus = vi.fn(async () => status);
  const refresh = vi.fn(async () => {});
  beforeEach(async () => {
    vi.clearAllMocks();
    app = fastify();
    // This isolated router fixture supplies only the two service methods it calls.
    const updateCheck = { getStatus, refresh } satisfies Pick<
      FastifyInstance["services"]["updateCheck"],
      "getStatus" | "refresh"
    >;
    app.decorate("services", { updateCheck } as unknown as FastifyInstance["services"]);
    app.addHook("onRequest", async (request) => {
      if (request.headers.authorization !== "Bearer fixture") return;
      request.auth = { authMode: AuthMode.JWT, actor: ActorType.USER } as FastifyRequest["auth"];
      request.permission = {
        type: ActorType.USER,
        id: "fixture-user",
        orgId: "fixture-org",
        authMethod: null
      } as FastifyRequest["permission"];
    });
    await app.register(registerVaultixRouter, { prefix: "/api/v1/vaultix" });
  });
  afterEach(() => app.close());
  test("anonymous reads and checks are denied without contacting the release service", async () => {
    await Promise.all(
      (["GET", "POST"] as const).map(async (method) => {
        const response = await app.inject({
          method,
          url: `/api/v1/vaultix/updates${method === "POST" ? "/check" : ""}`,
          ...(method === "POST" ? { payload: {} } : {})
        });
        expect(response.statusCode).toBe(401);
        expect(typeof response.json<{ error: string }>().error).toBe("string");
      })
    );
    expect(getStatus).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
  test("authenticated GET is cached metadata only; explicit POST refreshes metadata", async () => {
    const headers = { authorization: "Bearer fixture" };
    const read = await app.inject({ url: "/api/v1/vaultix/updates", headers });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(status);
    expect(refresh).not.toHaveBeenCalled();
    const checked = await app.inject({ method: "POST", url: "/api/v1/vaultix/updates/check", headers, payload: {} });
    expect(checked.statusCode).toBe(200);
    expect(checked.json()).toEqual(status);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  test("arbitrary destinations and value-bearing input never reach the service", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/vaultix/updates/check",
      headers: { authorization: "Bearer fixture" },
      payload: { url: "https://untrusted.invalid", value: "CANARY-SECRET" }
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain("CANARY");
    expect(refresh).not.toHaveBeenCalled();
  });
  test("cross-origin checks are denied before release access", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/vaultix/updates/check",
      headers: { authorization: "Bearer fixture", origin: "https://untrusted.invalid", host: "vaultix.example" },
      payload: {}
    });
    expect(response.statusCode).toBe(403);
    expect(refresh).not.toHaveBeenCalled();
  });
});
