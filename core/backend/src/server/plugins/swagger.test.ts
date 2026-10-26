import fastify from "fastify";

import { registerVaultixRouter } from "@app/server/routes/vaultix-router";

import { vaultixProductIdentity } from "./product-identity";
import { fastifySwagger } from "./swagger";

test("existing API documentation identifies the current Vaultix instance and exposes native actions", async () => {
  const app = fastify();
  try {
    await app.register(fastifySwagger);
    await app.register(vaultixProductIdentity);
    await app.register(registerVaultixRouter, {
      prefix: "/api/v1/vaultix",
      references: {
        listProjects: async () => {
          throw new Error("Documentation must not execute actions");
        },
        listReferences: async () => {
          throw new Error("Documentation must not execute actions");
        }
      }
    });
    await app.ready();
    const response = await app.inject("/api/docs/json");
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-vaultix-product"]).toBe("Vaultix");
    expect(response.headers["x-vaultix-feature-policy"]).toBe("included");
    const spec = response.json<{
      info: { title: string; version: string };
      servers: { url: string; description: string }[];
      paths: Record<
        string,
        Record<
          string,
          {
            tags?: string[];
            summary?: string;
            parameters?: { name: string; in: string; required: boolean }[];
          }
        >
      >;
    }>();
    expect(spec.info).toMatchObject({ title: "Vaultix API", version: "1.0.0" });
    expect(spec.servers).toEqual([{ url: "/", description: "This Vaultix instance" }]);
    expect(spec.paths["/api/v1/vaultix/connections"].get.tags).toContain("Vaultix");
    expect(spec.paths["/api/v1/vaultix/mcp"].post.summary).toContain("Clyffy");
    expect(spec.paths["/api/v1/vaultix/secret-references"].get.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "projectId", in: "query", required: true }),
        expect.objectContaining({ name: "environment", in: "query", required: true })
      ])
    );
    expect(response.body).not.toContain("Production server (EU)");
  } finally {
    await app.close();
  }
});
