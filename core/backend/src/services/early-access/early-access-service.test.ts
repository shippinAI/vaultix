import { beforeEach, describe, expect, it, vi } from "vitest";

import { BadRequestError, ForbiddenRequestError, NotFoundError, RateLimitError } from "@app/lib/errors";
import { OrgServiceActor } from "@app/lib/types";

import { earlyAccessServiceFactory, MAX_PENDING_EARLY_ACCESS_REQUESTS } from "./early-access-service";

// The real list is exercised against the packaged image, where it also has its deployed line endings.
vi.mock("@app/lib/validator/validate-email", () => ({
  isDisposableEmail: async (email: string) => email.endsWith("@mailinator.com")
}));

const actor = { id: "admin-id" } as OrgServiceActor;
const submission = { email: "person@example.com", name: null, organization: null, useCase: null };
const organization = { id: "org-id", name: "Acme" };
const pendingRequest = { id: "request-id", email: "person@example.com", status: "pending" };

const setup = ({
  enabled = true,
  pending = 0,
  request = pendingRequest as object | null,
  organizations = [] as string[]
} = {}) => {
  const earlyAccessDAL = {
    insertIfNew: vi.fn().mockResolvedValue(undefined),
    countByStatus: vi.fn().mockResolvedValue(pending),
    list: vi.fn().mockResolvedValue({ requests: [], totalCount: 0 }),
    findById: vi.fn().mockResolvedValue(request),
    review: vi.fn().mockResolvedValue({ ...pendingRequest, status: "invited" }),
    deleteById: vi.fn().mockResolvedValue(request),
    deleteMatching: vi.fn().mockResolvedValue(3)
  };
  const tx = { name: "tx" };
  // Stands in for the real transaction: the callback's throw must escape, as it would roll back.
  const createOrganization = vi.fn(
    async (_dto: unknown, _actor: unknown, onOrganizationCreated: (org: object, trx: object) => Promise<void>) => {
      await onOrganizationCreated(organization, tx);
      return { organization, invitations: [{ email: "person@example.com", delivery: "link", link: "https://link" }] };
    }
  );
  const reissueOrganizationInvitation = vi.fn().mockResolvedValue({ email: "person@example.com", delivery: "email" });
  const service = earlyAccessServiceFactory({
    earlyAccessDAL,
    getServerCfg: async () => ({ earlyAccessRequestsEnabled: enabled }),
    // @ts-expect-error the fixture organization carries only the fields under test
    createOrganization,
    findUserOrganizationIds: async () => organizations,
    reissueOrganizationInvitation
  });
  return { service, earlyAccessDAL, createOrganization, reissueOrganizationInvitation, tx };
};

describe("submitRequest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores a request while the form is open", async () => {
    const { service, earlyAccessDAL } = setup();
    await service.submitRequest(submission);
    expect(earlyAccessDAL.insertIfNew).toHaveBeenCalledWith(submission);
  });

  it("refuses and stores nothing while the form is closed", async () => {
    const { service, earlyAccessDAL } = setup({ enabled: false });
    await expect(service.submitRequest(submission)).rejects.toBeInstanceOf(ForbiddenRequestError);
    expect(earlyAccessDAL.insertIfNew).not.toHaveBeenCalled();
  });

  it("stores nothing for an automated submission and does not reveal that", async () => {
    const { service, earlyAccessDAL } = setup();
    await expect(service.submitRequest(null)).resolves.toBeUndefined();
    expect(earlyAccessDAL.insertIfNew).not.toHaveBeenCalled();
  });

  it("rejects a disposable address", async () => {
    const { service, earlyAccessDAL } = setup();
    await expect(service.submitRequest({ ...submission, email: "someone@mailinator.com" })).rejects.toBeInstanceOf(
      BadRequestError
    );
    expect(earlyAccessDAL.insertIfNew).not.toHaveBeenCalled();
  });

  it("pauses once the pending queue is full", async () => {
    const { service, earlyAccessDAL } = setup({ pending: MAX_PENDING_EARLY_ACCESS_REQUESTS });
    await expect(service.submitRequest(submission)).rejects.toBeInstanceOf(RateLimitError);
    expect(earlyAccessDAL.insertIfNew).not.toHaveBeenCalled();
  });
});

describe("inviteRequest", () => {
  it("records the decision inside the transaction that creates the organization", async () => {
    const { service, earlyAccessDAL, createOrganization, tx } = setup();
    const result = await service.inviteRequest("request-id", "Acme", actor);
    expect(createOrganization).toHaveBeenCalledWith(
      { name: "Acme", inviteAdminEmails: ["person@example.com"] },
      actor,
      expect.any(Function)
    );
    expect(earlyAccessDAL.review).toHaveBeenCalledWith(
      "request-id",
      { from: ["pending", "declined"], status: "invited", reviewedByUserId: "admin-id", invitedOrgId: "org-id" },
      tx
    );
    expect(result.request.status).toBe("invited");
    expect(result.invitation).toEqual({ email: "person@example.com", delivery: "link", link: "https://link" });
  });

  it("rolls back the organization when another reviewer got there first", async () => {
    const { service, earlyAccessDAL, createOrganization } = setup();
    earlyAccessDAL.review.mockResolvedValue(undefined);
    await expect(service.inviteRequest("request-id", "Acme", actor)).rejects.toThrow("already been invited");
    expect(createOrganization).toHaveBeenCalledOnce();
  });

  it("does not start for a request already invited", async () => {
    const { service, createOrganization } = setup({ request: { ...pendingRequest, status: "invited" } });
    await expect(service.inviteRequest("request-id", "Acme", actor)).rejects.toBeInstanceOf(BadRequestError);
    expect(createOrganization).not.toHaveBeenCalled();
  });

  it("can invite someone who was declined earlier", async () => {
    const { service } = setup({ request: { ...pendingRequest, status: "declined" } });
    await expect(service.inviteRequest("request-id", "Acme", actor)).resolves.toMatchObject({ organization });
  });

  it("reports a request that no longer exists", async () => {
    const { service, createOrganization } = setup({ request: null });
    await expect(service.inviteRequest("request-id", "Acme", actor)).rejects.toBeInstanceOf(NotFoundError);
    expect(createOrganization).not.toHaveBeenCalled();
  });

  it("refuses an address with another organization, because a link could open it", async () => {
    const { service, createOrganization } = setup({ organizations: ["other-org"] });
    await expect(service.inviteRequest("request-id", "Acme", actor)).rejects.toThrow("another organization");
    expect(createOrganization).not.toHaveBeenCalled();
  });

  it("reports a concurrent loser as already invited rather than a database failure", async () => {
    const { service, earlyAccessDAL, createOrganization } = setup();
    createOrganization.mockRejectedValueOnce(new Error("duplicate key value violates unique constraint"));
    earlyAccessDAL.findById
      .mockResolvedValueOnce(pendingRequest)
      .mockResolvedValueOnce({ ...pendingRequest, status: "invited" });
    await expect(service.inviteRequest("request-id", "Acme", actor)).rejects.toThrow("already been invited");
  });

  it("keeps any other failure as it was", async () => {
    const { service, earlyAccessDAL, createOrganization } = setup();
    const failure = new Error("database unavailable");
    createOrganization.mockRejectedValueOnce(failure);
    earlyAccessDAL.findById.mockResolvedValue(pendingRequest);
    await expect(service.inviteRequest("request-id", "Acme", actor)).rejects.toBe(failure);
  });
});

describe("reissueInvitation", () => {
  const invitedRequest = { ...pendingRequest, status: "invited", invitedOrgId: "org-id" };

  it("issues a new invitation for the organization on the request", async () => {
    const { service, reissueOrganizationInvitation } = setup({ request: invitedRequest, organizations: ["org-id"] });
    await expect(service.reissueInvitation("request-id", actor)).resolves.toMatchObject({ delivery: "email" });
    expect(reissueOrganizationInvitation).toHaveBeenCalledWith(
      { organizationId: "org-id", email: "person@example.com" },
      actor
    );
  });

  it("refuses once the address has picked up another organization", async () => {
    const { service, reissueOrganizationInvitation } = setup({
      request: invitedRequest,
      organizations: ["org-id", "other-org"]
    });
    await expect(service.reissueInvitation("request-id", actor)).rejects.toThrow("another organization");
    expect(reissueOrganizationInvitation).not.toHaveBeenCalled();
  });

  it.each([
    ["pending", pendingRequest],
    ["declined", { ...pendingRequest, status: "declined" }],
    ["invited, with its organization since deleted", { ...pendingRequest, status: "invited", invitedOrgId: null }]
  ])("refuses a request that is %s", async (_label, request) => {
    const { service, reissueOrganizationInvitation } = setup({ request });
    await expect(service.reissueInvitation("request-id", actor)).rejects.toBeInstanceOf(BadRequestError);
    expect(reissueOrganizationInvitation).not.toHaveBeenCalled();
  });

  it("reports a request that no longer exists", async () => {
    const { service } = setup({ request: null });
    await expect(service.reissueInvitation("request-id", actor)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("deleteMatchingRequests", () => {
  it("passes the filter through and reports how many went", async () => {
    const { service, earlyAccessDAL } = setup();
    const filter = { status: "pending" as const, search: "spam" };
    await expect(service.deleteMatchingRequests(filter)).resolves.toEqual({ deletedCount: 3 });
    expect(earlyAccessDAL.deleteMatching).toHaveBeenCalledWith(filter);
  });
});

describe("declineRequest and deleteRequest", () => {
  it("declines only from pending", async () => {
    const { service, earlyAccessDAL } = setup();
    await service.declineRequest("request-id", actor);
    expect(earlyAccessDAL.review).toHaveBeenCalledWith("request-id", {
      from: ["pending"],
      status: "declined",
      reviewedByUserId: "admin-id"
    });
    earlyAccessDAL.review.mockResolvedValue(undefined);
    await expect(service.declineRequest("request-id", actor)).rejects.toBeInstanceOf(BadRequestError);
  });

  it("deletes an existing request and reports a missing one", async () => {
    const { service, earlyAccessDAL } = setup();
    await service.deleteRequest("request-id");
    expect(earlyAccessDAL.deleteById).toHaveBeenCalledWith("request-id");
    earlyAccessDAL.findById.mockResolvedValue(undefined);
    await expect(service.deleteRequest("request-id")).rejects.toBeInstanceOf(NotFoundError);
  });
});
