import { BadRequestError } from "@app/lib/errors";
import { writeLimit } from "@app/server/config/rateLimiter";
import { verifySuperAdmin } from "@app/server/plugins/auth/superAdmin";
import { verifyAuth } from "@app/server/plugins/auth/verify-auth";
import { AuthMode } from "@app/services/auth/auth-type";

const userIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Access domain (docs/0119). Account recovery without email: an instance administrator issues a
// one-use reset link and hands it to the person. Only a person's own sign-in may do this, never a
// machine identity, and the link is returned once and never stored in readable form.
export const registerAccessRouter = async (server: FastifyZodProvider) => {
  server.route({
    method: "POST",
    url: "/users/:userId/password-reset-links",
    config: { rateLimit: writeLimit },
    schema: { hide: false, tags: ["Vaultix access"], operationId: "createUserPasswordResetLink" },
    onRequest: (req, res, done) => {
      verifyAuth([AuthMode.JWT])(req, res, () => {
        verifySuperAdmin(req, res, done);
      });
    },
    handler: async (req, reply) => {
      const { userId } = req.params as { userId?: unknown };
      if (typeof userId !== "string" || !userIdPattern.test(userId)) {
        throw new BadRequestError({ message: `User ID '${String(userId)}' is not a valid ID.` });
      }
      const passwordResetLink = await server.services.accountRecovery.createResetLinkForUser({
        userId,
        issuedByUserId: req.permission.id
      });
      void reply.header("cache-control", "no-store");
      return reply.code(201).send({ passwordResetLink });
    }
  });
};
