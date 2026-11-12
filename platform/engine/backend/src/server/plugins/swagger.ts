import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import fp from "fastify-plugin";

import { learningContextSchema } from "@app/services/vaultix/learning-input";
import { referenceTools } from "@app/services/vaultix/reference-input";

import { jsonSchemaTransform } from "./fastify-zod";

export const fastifySwagger = fp(async (fastify) => {
  await fastify.register(swagger, {
    transform: (input) => {
      const result = jsonSchemaTransform(input);
      if (input.url === "/api/v1/vaultix/secret-references") {
        // Document the same catalog schema used by MCP. Runtime validation is explicit.
        result.schema = { ...result.schema, querystring: referenceTools[1].inputSchema };
      }
      if (input.url === "/api/v1/vaultix/learning-context") {
        // Authored parser validates this JSON Schema contract before the legacy compiler.
        result.schema = { ...result.schema, body: learningContextSchema };
      }
      return result;
    },
    openapi: {
      info: {
        title: "Vaultix API",
        description:
          "Vaultix secrets and security API. Software capabilities are included; authentication, permissions and approvals still apply. Clyffy uses the metadata-only /api/v1/vaultix actions. Existing value-returning compatibility routes are for trusted application clients, never AI tools.",
        version: "1.0.0",
        contact: { name: "Vaultix by AngryVibes LLC", url: "https://shippin.ai" }
      },
      servers: [
        {
          url: "/",
          description: "This Vaultix instance"
        }
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description: "An access token in Vaultix"
          }
        }
      }
    }
  });

  await fastify.register(swaggerUI, {
    routePrefix: "/api/docs",
    theme: { title: "Vaultix API" }
  });
});
