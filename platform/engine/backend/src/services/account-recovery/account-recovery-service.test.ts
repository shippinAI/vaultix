import { beforeEach, expect, test, vi } from "vitest";

import { BadRequestError, ForbiddenRequestError, NotFoundError } from "@app/lib/errors";
import { ActorType } from "@app/services/auth/auth-type";
import { EventType } from "@app/shippin/services/audit-log/audit-log-types";

import { accountRecoveryServiceFactory } from "./account-recovery-service";

const mocks = vi.hoisted(() => ({
  siteUrl: "https://vaultix.example" as string | undefined,
  info: vi.fn(),
  consumeHostRecoveryCode: vi.fn()
}));
// This suite exercises reset links without email, so it cuts the unused mail and native crypto imports.
vi.mock("re2", () => ({ default: RegExp }));
vi.mock("@app/services/smtp/smtp-service", () => ({ SmtpTemplates: {} }));
vi.mock("@app/lib/crypto/cryptography", () => ({ crypto: {} }));
vi.mock("../auth/auth-fns", () => ({ validatePasswordResetAuthorization: vi.fn() }));
vi.mock("./host-recovery-code", () => ({ consumeHostRecoveryCode: mocks.consumeHostRecoveryCode }));
vi.mock("@app/lib/config/env", () => ({ getConfig: () => ({ SITE_URL: mocks.siteUrl }) }));
vi.mock("@app/lib/logger", () => ({ logger: { info: mocks.info, error: vi.fn() } }));

const administrator = {
  ipAddress: "203.0.113.7",
  userAgent: "test",
  userAgentType: "other",
  actor: { type: ActorType.USER, metadata: { userId: "admin-1", email: "admin@vaultix.invalid", username: "admin" } }
} as never;
const host = { ipAddress: "127.0.0.1", userAgent: "node", userAgentType: "other" } as never;

const person = { id: "u-1", username: "a+b@vaultix.invalid", email: "a+b@vaultix.invalid", isAccepted: true };

const service = ({ user, owners = [] }: { user?: object; owners?: object[] }) => {
  const tokenService = { createTokenForUser: vi.fn().mockResolvedValue("one-use-token") };
  const smtpService = { sendMail: vi.fn() };
  const auditLogService = { createAuditLog: vi.fn().mockResolvedValue(undefined) };
  const factory = accountRecoveryServiceFactory({
    userDAL: { findById: vi.fn().mockResolvedValue(user), find: vi.fn().mockResolvedValue(owners) } as never,
    membershipUserDAL: { find: vi.fn().mockResolvedValue([{ scopeOrgId: "org-1" }, { scopeOrgId: "org-1" }]) },
    tokenService: tokenService as never,
    smtpService: smtpService as never,
    auditLogService
  });
  return { factory, tokenService, smtpService, auditLogService };
};

beforeEach(() => {
  mocks.siteUrl = "https://vaultix.example";
  mocks.info.mockClear();
  mocks.consumeHostRecoveryCode.mockReset().mockResolvedValue(undefined);
});

test("an administrator gets a one-use link to the reset page without any email", async () => {
  const { factory, tokenService, smtpService } = service({ user: { ...person, isGhost: false } });
  const link = await factory.createResetLinkForUser({ userId: "u-1", auditLogInfo: administrator });
  const url = new URL(link.url);
  expect(url.origin + url.pathname).toBe("https://vaultix.example/account-recovery-reset");
  expect(url.searchParams.get("token")).toBe("one-use-token");
  expect(url.searchParams.get("to")).toBe("a+b@vaultix.invalid");
  expect(link.username).toBe("a+b@vaultix.invalid");
  expect(new Date(link.expiresAt).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
  expect(tokenService.createTokenForUser).toHaveBeenCalledTimes(1);
  expect((tokenService.createTokenForUser.mock.calls[0] as [{ userId: string }])[0].userId).toBe("u-1");
  expect(smtpService.sendMail).not.toHaveBeenCalled();
  const logged = mocks.info.mock.calls.map((call) => String(call[0])).join("\n");
  expect(logged).toContain("[origin=administrator] [userId=u-1] [issuedByUserId=admin-1]");
  expect(logged).not.toContain("one-use-token");
});

test("each organization the person belongs to records who issued the link, once", async () => {
  const { factory, auditLogService } = service({ user: { ...person, isGhost: false } });
  await factory.createResetLinkForUser({ userId: "u-1", auditLogInfo: administrator });
  expect(auditLogService.createAuditLog).toHaveBeenCalledTimes(1);
  const [entry] = auditLogService.createAuditLog.mock.calls[0] as [
    { orgId: string; actor: { type: string }; event: { type: string; metadata: object } }
  ];
  expect(entry.orgId).toBe("org-1");
  expect(entry.actor.type).toBe(ActorType.USER);
  expect(entry.event).toEqual({
    type: EventType.ISSUE_PASSWORD_RESET_LINK,
    metadata: { userId: "u-1", username: "a+b@vaultix.invalid", origin: "administrator" }
  });
  expect(JSON.stringify(entry)).not.toContain("one-use-token");
});

test.each([
  ["a missing account", undefined, NotFoundError],
  ["a placeholder account", { ...person, isGhost: true }, NotFoundError],
  ["an unfinished signup", { ...person, isAccepted: false, isGhost: false }, BadRequestError]
] as const)("%s is refused before a token exists", async (_name, user, error) => {
  const { factory, tokenService } = service({ user });
  await expect(factory.createResetLinkForUser({ userId: "u-1", auditLogInfo: administrator })).rejects.toBeInstanceOf(
    error
  );
  expect(tokenService.createTokenForUser).not.toHaveBeenCalled();
});

test("an instance without a site address cannot issue a link", async () => {
  mocks.siteUrl = undefined;
  const { factory, tokenService } = service({ user: { ...person, isGhost: false } });
  await expect(factory.createResetLinkForUser({ userId: "u-1", auditLogInfo: administrator })).rejects.toThrow(
    /SITE_URL/
  );
  expect(tokenService.createTokenForUser).not.toHaveBeenCalled();
});

test("the host recovers the only instance administrator, recorded as the platform", async () => {
  const { factory, auditLogService } = service({ owners: [person] });
  const link = await factory.createOwnerResetLinkFromHost({ hostCode: "code", auditLogInfo: host });
  expect(mocks.consumeHostRecoveryCode).toHaveBeenCalledWith("code");
  expect(new URL(link.url).searchParams.get("to")).toBe("a+b@vaultix.invalid");
  const [entry] = auditLogService.createAuditLog.mock.calls[0] as [{ actor: { type: string }; event: object }];
  expect(entry.actor.type).toBe(ActorType.PLATFORM);
  expect(entry.event).toMatchObject({ metadata: { origin: "host" } });
});

test("several instance administrators need an email to choose one", async () => {
  const second = { ...person, id: "u-2", username: "c@vaultix.invalid", email: "c@vaultix.invalid" };
  const { factory, tokenService } = service({ owners: [person, second] });
  await expect(factory.createOwnerResetLinkFromHost({ hostCode: "code", auditLogInfo: host })).rejects.toThrow(
    /--email/
  );
  expect(tokenService.createTokenForUser).not.toHaveBeenCalled();
  const link = await factory.createOwnerResetLinkFromHost({
    hostCode: "code",
    email: "C@vaultix.invalid",
    auditLogInfo: host
  });
  expect(new URL(link.url).searchParams.get("to")).toBe("c@vaultix.invalid");
});

test("an email that is not an instance administrator is refused", async () => {
  const { factory, tokenService } = service({ owners: [person] });
  await expect(
    factory.createOwnerResetLinkFromHost({ hostCode: "code", email: "else@vaultix.invalid", auditLogInfo: host })
  ).rejects.toBeInstanceOf(NotFoundError);
  expect(tokenService.createTokenForUser).not.toHaveBeenCalled();
});

test("without the host's code nothing is looked up or issued", async () => {
  mocks.consumeHostRecoveryCode.mockRejectedValue(new ForbiddenRequestError({ message: "no" }));
  const { factory, tokenService } = service({ owners: [person] });
  await expect(factory.createOwnerResetLinkFromHost({ hostCode: "guess", auditLogInfo: host })).rejects.toBeInstanceOf(
    ForbiddenRequestError
  );
  expect(tokenService.createTokenForUser).not.toHaveBeenCalled();
});
