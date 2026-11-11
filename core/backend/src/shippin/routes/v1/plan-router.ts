import { z } from "zod";

import { readLimit } from "@app/server/config/rateLimiter";
import { verifyAuth } from "@app/server/plugins/auth/verify-auth";
import { AuthMode } from "@app/services/auth/auth-type";

// The features this organization has. The UI reads this to show what is available.
export const registerPlanRouter = async (server: FastifyZodProvider) => {
  server.route({
    method: "GET",
    url: "/:organizationId/plan",
    config: { rateLimit: readLimit },
    schema: {
      params: z.object({ organizationId: z.string().trim() }),
      querystring: z.object({
        refreshCache: z
          .enum(["true", "false"])
          .default("false")
          .transform((value) => value === "true")
      }),
      response: { 200: z.object({ plan: z.any() }) }
    },
    onRequest: verifyAuth([AuthMode.JWT, AuthMode.IDENTITY_ACCESS_TOKEN]),
    handler: async (req) => {
      const plan = await server.services.feature.getOrgPlan({
        actorId: req.permission.id,
        actor: req.permission.type,
        actorOrgId: req.permission.orgId,
        rootOrgId: req.permission.rootOrgId,
        actorAuthMethod: req.permission.authMethod,
        orgId: req.params.organizationId,
        refreshCache: req.query.refreshCache
      });
      return { plan };
    }
  });
};
