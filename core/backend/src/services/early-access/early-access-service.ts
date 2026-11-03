import { Knex } from "knex";

import { TOrganizations, TSuperAdmin } from "@app/db/schemas";
import { BadRequestError, ForbiddenRequestError, NotFoundError, RateLimitError } from "@app/lib/errors";
import { OrgServiceActor } from "@app/lib/types";
import { isDisposableEmail } from "@app/lib/validator/validate-email";
import { TOrganizationInvitation } from "@app/services/super-admin/organization-invitation";

import { TEarlyAccessDALFactory } from "./early-access-dal";
import { TEarlyAccessListFilter, TEarlyAccessSubmission } from "./early-access-types";

// Bounds what an unauthenticated form can add to the store, whatever the per-address limit lets through.
export const MAX_PENDING_EARLY_ACCESS_REQUESTS = 10_000;

export type TEarlyAccessServiceFactory = ReturnType<typeof earlyAccessServiceFactory>;

type TEarlyAccessServiceFactoryDep = {
  earlyAccessDAL: Pick<
    TEarlyAccessDALFactory,
    "insertIfNew" | "countByStatus" | "list" | "findById" | "review" | "deleteById"
  >;
  getServerCfg: () => Promise<Pick<TSuperAdmin, "earlyAccessRequestsEnabled">>;
  createOrganization: (
    dto: { name: string; inviteAdminEmails: string[] },
    actor: OrgServiceActor,
    onOrganizationCreated: (organization: TOrganizations, tx: Knex) => Promise<void>
  ) => Promise<{ organization: TOrganizations; invitations: TOrganizationInvitation[] }>;
};

const requestNotFound = () => new NotFoundError({ message: "This early access request no longer exists." });
const alreadyInvited = () => new BadRequestError({ message: "This request has already been invited." });

export const earlyAccessServiceFactory = ({
  earlyAccessDAL,
  getServerCfg,
  createOrganization
}: TEarlyAccessServiceFactoryDep) => {
  const isAcceptingRequests = async () => Boolean((await getServerCfg()).earlyAccessRequestsEnabled);

  // Answers the same way for a new and a repeat address, so the form cannot be used to learn
  // who has already asked. Nothing is mailed, so it cannot be aimed at someone else's inbox.
  const submitRequest = async (submission: TEarlyAccessSubmission | null) => {
    if (!(await isAcceptingRequests()))
      throw new ForbiddenRequestError({ message: "Early access requests are closed." });
    if (!submission) return;
    if (await isDisposableEmail(submission.email))
      throw new BadRequestError({
        message: "Use an email address you will keep. Disposable addresses are not accepted."
      });
    if ((await earlyAccessDAL.countByStatus("pending")) >= MAX_PENDING_EARLY_ACCESS_REQUESTS)
      throw new RateLimitError({ message: "Early access requests are paused right now. Please try again later." });
    await earlyAccessDAL.insertIfNew(submission);
  };

  const listRequests = async (filter: TEarlyAccessListFilter) => {
    const [page, pendingCount] = await Promise.all([
      earlyAccessDAL.list(filter),
      earlyAccessDAL.countByStatus("pending")
    ]);
    return { ...page, pendingCount };
  };

  // Creating the organization and recording the decision commit together, so a retried or
  // concurrent invite cannot leave a second organization behind.
  const inviteRequest = async (requestId: string, organizationName: string, actor: OrgServiceActor) => {
    const request = await earlyAccessDAL.findById(requestId);
    if (!request) throw requestNotFound();
    if (request.status === "invited") throw alreadyInvited();
    let invited = request;
    const { organization, invitations } = await createOrganization(
      { name: organizationName, inviteAdminEmails: [request.email] },
      actor,
      async (createdOrganization, tx) => {
        const reviewed = await earlyAccessDAL.review(
          requestId,
          {
            from: ["pending", "declined"],
            status: "invited",
            reviewedByUserId: actor.id,
            invitedOrgId: createdOrganization.id
          },
          tx
        );
        if (!reviewed) throw alreadyInvited();
        invited = reviewed;
      }
    );
    return { request: invited, organization, invitation: invitations[0] };
  };

  const declineRequest = async (requestId: string, actor: OrgServiceActor) => {
    const reviewed = await earlyAccessDAL.review(requestId, {
      from: ["pending"],
      status: "declined",
      reviewedByUserId: actor.id
    });
    if (!reviewed) throw new BadRequestError({ message: "Only a pending request can be declined." });
    return reviewed;
  };

  const deleteRequest = async (requestId: string) => {
    const request = await earlyAccessDAL.findById(requestId);
    if (!request) throw requestNotFound();
    return earlyAccessDAL.deleteById(requestId);
  };

  return { isAcceptingRequests, submitRequest, listRequests, inviteRequest, declineRequest, deleteRequest };
};
