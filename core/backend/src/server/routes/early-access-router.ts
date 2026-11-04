import type { FastifyInstance, FastifyReply, FastifyRequest, HookHandlerDoneFunction } from "fastify";

import { BadRequestError } from "@app/lib/errors";
import { earlyAccessRequestLimit, readLimit, writeLimit } from "@app/server/config/rateLimiter";
import { verifySuperAdmin } from "@app/server/plugins/auth/superAdmin";
import { verifyAuth } from "@app/server/plugins/auth/verify-auth";
import { AuthMode } from "@app/services/auth/auth-type";
import {
  parseEarlyAccessBulkDelete,
  parseEarlyAccessInvite,
  parseEarlyAccessListQuery,
  parseEarlyAccessRequestId,
  parseEarlyAccessSubmission
} from "@app/services/early-access/early-access-input";
import type { TEarlyAccessServiceFactory } from "@app/services/early-access/early-access-service";

const SUBMISSION_BODY_LIMIT = 16 * 1024;
const JSON_BODY = /^application\/json\s*(?:;|$)/i;

const verifyInstanceAdmin = (req: FastifyRequest, res: FastifyReply, done: HookHandlerDoneFunction) => {
  verifyAuth([AuthMode.JWT])(req, res, () => {
    verifySuperAdmin(req, res, done);
  });
};

export const registerEarlyAccessRouter = async (
  server: FastifyInstance,
  { service }: { service: TEarlyAccessServiceFactory }
) => {
  // Responses carry contact details and invitation links.
  server.addHook("onRequest", async (_request, reply) => {
    void reply.header("Cache-Control", "no-store");
  });

  server.route({
    method: "GET",
    url: "/status",
    config: { rateLimit: readLimit },
    handler: async () => ({ acceptingRequests: await service.isAcceptingRequests() })
  });

  server.route({
    method: "POST",
    url: "/requests",
    bodyLimit: SUBMISSION_BODY_LIMIT,
    config: { rateLimit: earlyAccessRequestLimit },
    handler: async (req) => {
      // Any site can post a form here without a preflight, spending its visitors' allowance.
      if (!JSON_BODY.test(req.headers["content-type"] ?? ""))
        throw new BadRequestError({ message: "Send the request as a JSON object." });
      await service.submitRequest(parseEarlyAccessSubmission(req.body));
      return { received: true };
    }
  });

  server.route({
    method: "GET",
    url: "/requests",
    config: { rateLimit: readLimit },
    onRequest: verifyInstanceAdmin,
    handler: async (req) => service.listRequests(parseEarlyAccessListQuery(req.query))
  });

  server.route({
    method: "POST",
    url: "/requests/:requestId/invite",
    config: { rateLimit: writeLimit },
    onRequest: verifyInstanceAdmin,
    handler: async (req) => {
      const { organizationName } = parseEarlyAccessInvite(req.body);
      return service.inviteRequest(parseEarlyAccessRequestId(req.params), organizationName, req.permission);
    }
  });

  server.route({
    method: "POST",
    url: "/requests/:requestId/reissue-invitation",
    config: { rateLimit: writeLimit },
    onRequest: verifyInstanceAdmin,
    handler: async (req) => ({
      invitation: await service.reissueInvitation(parseEarlyAccessRequestId(req.params), req.permission)
    })
  });

  server.route({
    method: "POST",
    url: "/requests/delete-matching",
    config: { rateLimit: writeLimit },
    onRequest: verifyInstanceAdmin,
    handler: async (req) => service.deleteMatchingRequests(parseEarlyAccessBulkDelete(req.body))
  });

  server.route({
    method: "POST",
    url: "/requests/:requestId/decline",
    config: { rateLimit: writeLimit },
    onRequest: verifyInstanceAdmin,
    handler: async (req) => ({
      request: await service.declineRequest(parseEarlyAccessRequestId(req.params), req.permission)
    })
  });

  server.route({
    method: "DELETE",
    url: "/requests/:requestId",
    config: { rateLimit: writeLimit },
    onRequest: verifyInstanceAdmin,
    handler: async (req) => ({ request: await service.deleteRequest(parseEarlyAccessRequestId(req.params)) })
  });
};
