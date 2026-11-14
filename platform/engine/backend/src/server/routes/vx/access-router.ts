import { BadRequestError } from "@app/lib/errors";
import { writeLimit } from "@app/server/config/rateLimiter";
import { verifySuperAdmin } from "@app/server/plugins/auth/superAdmin";
import { verifyAuth } from "@app/server/plugins/auth/verify-auth";
import { AuthMode } from "@app/services/auth/auth-type";

const userIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Access domain (docs/0119). Account recovery without email: an instance administrator issues a
// one-use reset link and hands it to the person, and the host operator can do the same for an
// instance administrator. The link is returned once and never stored in readable form.
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
        auditLogInfo: req.auditLogInfo
      });
      void reply.header("cache-control", "no-store");
      return reply.code(201).send({ passwordResetLink });
    }
  });

  // Owner recovery from the host. Called only by `vaultix server owner-reset-link` from inside the
  // running container; the one-use code it presents exists only in a file that command just wrote,
  // so the route opens nothing for anyone without command access to the container.
  server.route({
    method: "POST",
    url: "/owner-password-reset-links",
    config: { rateLimit: writeLimit },
    schema: { hide: false, tags: ["Vaultix access"], operationId: "createOwnerPasswordResetLinkFromHost" },
    handler: async (req, reply) => {
      const body = (req.body ?? {}) as { hostCode?: unknown; email?: unknown };
      if (typeof body.hostCode !== "string" || body.hostCode.length > 256) {
        throw new BadRequestError({ message: "A host recovery code is required." });
      }
      if (
        body.email !== undefined &&
        (typeof body.email !== "string" || !body.email.trim() || body.email.length > 320)
      ) {
        throw new BadRequestError({ message: "The email to recover must be a non-empty address." });
      }
      const { ipAddress, userAgent, userAgentType } = req.auditLogInfo;
      const passwordResetLink = await server.services.accountRecovery.createOwnerResetLinkFromHost({
        hostCode: body.hostCode,
        email: typeof body.email === "string" ? body.email.trim() : undefined,
        auditLogInfo: { ipAddress, userAgent, userAgentType }
      });
      void reply.header("cache-control", "no-store");
      return reply.code(201).send({ passwordResetLink });
    }
  });
};
