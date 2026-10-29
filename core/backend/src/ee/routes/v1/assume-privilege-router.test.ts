import cookie from "@fastify/cookie";
import { fastifyRequestContext, requestContext } from "@fastify/request-context";
import fastify from "fastify";
import { vi } from "vitest";

import { RequestContextKey } from "@app/lib/request-context/request-context-keys";
import { injectAssumePrivilege } from "@app/server/plugins/auth/inject-assume-privilege";
import { serializerCompiler, validatorCompiler } from "@app/server/plugins/fastify-zod";
import { ActorType, AuthMode } from "@app/services/auth/auth-type";

import { registerAssumePrivilegeRouter } from "./assume-privilege-router";

vi.mock("@app/lib/config/env", () => ({ getConfig: () => ({ HTTPS_ENABLED: false }) }));
vi.mock("@app/server/config/rateLimiter", () => ({ writeLimit: {} }));

const grant = {
  projectId: "project-a",
  actorId: "target",
  actorType: ActorType.IDENTITY,
  requesterId: "requester",
  tokenVersionId: "session"
};

async function fixture(mode: "absent" | "valid" | "invalid" | "anonymous" | "audit-failure") {
  const app = fastify();
  const audit = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
  if (mode === "audit-failure") audit.mockRejectedValue(new Error("Disposable audit outage"));
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler((error: Error, _req, reply) => {
    let status = 500;
    if (error.name === "BadRequest") status = 400;
    if (error.name === "UnauthorizedError") status = 401;
    return reply.code(status).send({ error: error.name });
  });
  await app.register(cookie);
  await app.register(fastifyRequestContext);
  void Object.assign(app, {
    services: {
      assumePrivileges: {
        verifyAssumePrivilegeToken: async () => {
          throw new Error("Invalid fixture grant");
        }
      },
      auditLog: { createAuditLog: audit }
    }
  });
  app.addHook("onRequest", async (req) => {
    if (mode === "anonymous") return;
    Object.assign(req, {
      auth: { authMode: AuthMode.JWT, user: { id: "requester", username: "fixture@vaultix.invalid" } },
      permission: { orgId: "organization" },
      auditLogInfo: {}
    });
    if (mode === "valid" || mode === "audit-failure") {
      requestContext.set(RequestContextKey.AssumedPrivilegeDetails, grant);
    }
  });
  await app.register(injectAssumePrivilege);
  await app.register(registerAssumePrivilegeRouter, { prefix: "/api/v1/projects" });
  return { app, audit };
}

test.each(["absent", "invalid", "valid"] as const)(
  "authenticated exit clears /api cookie for %s grant",
  async (mode) => {
    const { app, audit } = await fixture(mode);
    try {
      const response = await app.inject({
        method: "DELETE",
        url: "/api/v1/projects/project-a/assume-privileges",
        headers: mode === "invalid" ? { cookie: "vaultix-project-assume-privileges=fixture" } : {}
      });
      expect(response.statusCode).toBe(200);
      const cleared = response.cookies.filter((item) => item.name === "vaultix-project-assume-privileges");
      expect(cleared.length).toBeGreaterThan(0);
      expect(cleared.every((item) => item.path === "/api" && item.value === "")).toBe(true);
      expect(audit).toHaveBeenCalledTimes(mode === "valid" ? 1 : 0);
      if (mode === "valid") {
        expect(audit.mock.calls[0]).toMatchObject([
          {
            event: {
              metadata: {
                projectId: "project-a",
                requesterId: "requester",
                targetActorId: "target"
              }
            }
          }
        ]);
      }
    } finally {
      await app.close();
    }
  }
);

test("a valid grant cannot be exited or audited against a different project", async () => {
  const { app, audit } = await fixture("valid");
  try {
    const response = await app.inject({ method: "DELETE", url: "/api/v1/projects/project-b/assume-privileges" });
    expect(response.statusCode).toBe(400);
    expect(response.cookies).toHaveLength(0);
    expect(audit).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

test("anonymous exit remains denied", async () => {
  const { app, audit } = await fixture("anonymous");
  try {
    const response = await app.inject({ method: "DELETE", url: "/api/v1/projects/project-a/assume-privileges" });
    expect(response.statusCode).toBe(401);
    expect(response.cookies).toHaveLength(0);
    expect(audit).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

test("audit failure is not reported as successful exit", async () => {
  const { app, audit } = await fixture("audit-failure");
  try {
    const response = await app.inject({ method: "DELETE", url: "/api/v1/projects/project-a/assume-privileges" });
    expect(response.statusCode).toBe(500);
    expect(typeof response.json<{ error: string }>().error).toBe("string");
    expect(audit).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
  }
});
