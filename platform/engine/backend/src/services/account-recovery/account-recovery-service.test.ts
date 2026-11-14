import { beforeEach, expect, test, vi } from "vitest";

import { BadRequestError, NotFoundError } from "@app/lib/errors";

import { accountRecoveryServiceFactory } from "./account-recovery-service";

const mocks = vi.hoisted(() => ({ siteUrl: "https://vaultix.example" as string | undefined, info: vi.fn() }));
// This suite exercises the administrator reset link, so it cuts the unused mail and native crypto imports.
vi.mock("re2", () => ({ default: RegExp }));
vi.mock("@app/services/smtp/smtp-service", () => ({ SmtpTemplates: {} }));
vi.mock("@app/lib/crypto/cryptography", () => ({ crypto: {} }));
vi.mock("../auth/auth-fns", () => ({ validatePasswordResetAuthorization: vi.fn() }));
vi.mock("@app/lib/config/env", () => ({ getConfig: () => ({ SITE_URL: mocks.siteUrl }) }));
vi.mock("@app/lib/logger", () => ({ logger: { info: mocks.info, error: vi.fn() } }));

const service = (user: object | undefined) => {
  const tokenService = { createTokenForUser: vi.fn().mockResolvedValue("one-use-token") };
  const smtpService = { sendMail: vi.fn() };
  const factory = accountRecoveryServiceFactory({
    userDAL: { findById: vi.fn().mockResolvedValue(user) } as never,
    membershipUserDAL: { find: vi.fn() },
    tokenService: tokenService as never,
    smtpService: smtpService as never
  });
  return { factory, tokenService, smtpService };
};

beforeEach(() => {
  mocks.siteUrl = "https://vaultix.example";
  mocks.info.mockClear();
});

test("an administrator gets a one-use link to the reset page without any email", async () => {
  const { factory, tokenService, smtpService } = service({
    id: "u-1",
    username: "a+b@vaultix.invalid",
    isAccepted: true,
    isGhost: false
  });
  const link = await factory.createResetLinkForUser({ userId: "u-1", issuedByUserId: "admin-1" });
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
  expect(logged).toContain("[userId=u-1] [issuedByUserId=admin-1]");
  expect(logged).not.toContain("one-use-token");
});

test.each([
  ["a missing account", undefined, NotFoundError],
  ["a placeholder account", { id: "u-1", username: "ghost", isAccepted: true, isGhost: true }, NotFoundError],
  [
    "an unfinished signup",
    { id: "u-1", username: "new@vaultix.invalid", isAccepted: false, isGhost: false },
    BadRequestError
  ]
] as const)("%s is refused before a token exists", async (_name, user, error) => {
  const { factory, tokenService } = service(user);
  await expect(factory.createResetLinkForUser({ userId: "u-1", issuedByUserId: "admin-1" })).rejects.toBeInstanceOf(
    error
  );
  expect(tokenService.createTokenForUser).not.toHaveBeenCalled();
});

test("an instance without a site address cannot issue a link", async () => {
  mocks.siteUrl = undefined;
  const { factory, tokenService } = service({
    id: "u-1",
    username: "a@vaultix.invalid",
    isAccepted: true,
    isGhost: false
  });
  await expect(factory.createResetLinkForUser({ userId: "u-1", issuedByUserId: "admin-1" })).rejects.toThrow(
    /SITE_URL/
  );
  expect(tokenService.createTokenForUser).not.toHaveBeenCalled();
});
