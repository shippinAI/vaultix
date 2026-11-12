import { beforeEach, expect, test, vi } from "vitest";

import { ForbiddenRequestError } from "@app/lib/errors";

import { authSignupServiceFactory } from "./auth-signup-service";
import { CompleteAccountType } from "./auth-signup-type";
import { AuthTokenType } from "./auth-type";

const mocks = vi.hoisted(() => ({
  getServerCfg: vi.fn(),
  order: [] as string[]
}));
// This suite exercises the organization gate, so it cuts the unused mail and native crypto imports.
vi.mock("re2", () => ({ default: RegExp }));
vi.mock("../smtp/smtp-service", () => ({ SmtpTemplates: {}, throwIfSmtpError: vi.fn() }));
vi.mock("./auth-fns", () => ({ extractBearerToken: () => "signup" }));
vi.mock("@app/lib/config/env", () => ({ getConfig: () => ({ AUTH_SECRET: "secret", SALT_ROUNDS: 1 }) }));
vi.mock("@app/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock("@app/lib/crypto/cryptography", () => ({
  crypto: {
    jwt: () => ({ verify: () => ({ authTokenType: AuthTokenType.SIGNUP_TOKEN, userId: "user-1" }) }),
    hashing: () => ({ createHash: async () => "hashed" })
  }
}));
vi.mock("../super-admin/super-admin-service", () => ({ getServerCfg: mocks.getServerCfg }));

const account = (memberships: object[], superAdmin = false) => {
  const orgService = { createOrganization: vi.fn().mockResolvedValue({ id: "org-1" }), findOrganizationById: vi.fn() };
  const userDAL = {
    findById: vi.fn().mockResolvedValue({ id: "user-1", email: "a@vaultix.invalid", isAccepted: false, superAdmin }),
    updateById: vi.fn().mockResolvedValue({ id: "user-1", superAdmin })
  };
  const service = authSignupServiceFactory({
    tokenService: {},
    smtpService: {},
    authDAL: {
      transaction: async <T>(run: (tx: object) => Promise<T>) => {
        mocks.order.push("transaction");
        return run({});
      }
    },
    userDAL,
    userAliasDAL: {},
    orgDAL: { findMembership: vi.fn().mockResolvedValue(memberships) },
    orgService,
    loginService: { generateUserTokens: vi.fn().mockResolvedValue({ access: "access", refresh: "refresh" }) },
    emailDomainDAL: {},
    signupOnboardingResponseDAL: {}
  } as unknown as Parameters<typeof authSignupServiceFactory>[0]);
  const complete = () =>
    service.completeAccount({
      type: CompleteAccountType.Email,
      authorization: "Bearer signup",
      email: "a@vaultix.invalid",
      firstName: "A",
      password: "unused",
      organizationName: "Escape",
      ip: "127.0.0.1",
      userAgent: "test"
    });
  return { complete, orgService };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order.length = 0;
  mocks.getServerCfg.mockImplementation(async () => {
    mocks.order.push("config");
    return { allowSignUp: false };
  });
});

test("denies a token holder with no invitation when signup is closed", async () => {
  const { complete, orgService } = account([]);

  await expect(complete()).rejects.toThrow(ForbiddenRequestError);
  expect(orgService.createOrganization).not.toHaveBeenCalled();
});

test("reads server configuration before opening the transaction", async () => {
  const { complete } = account([]);

  await complete().catch(() => undefined);
  expect(mocks.order).toEqual(["config", "transaction"]);
});

test("lets an invited user finish without creating another organization", async () => {
  const { complete, orgService } = account([{ id: "membership-1" }]);

  await expect(complete()).resolves.toMatchObject({ isInvitedUser: true, organizationId: undefined });
  expect(orgService.createOrganization).not.toHaveBeenCalled();
});

test("still creates the organization when signup is open", async () => {
  mocks.getServerCfg.mockResolvedValue({ allowSignUp: true });
  const { complete, orgService } = account([]);

  await expect(complete()).resolves.toMatchObject({ isInvitedUser: false, organizationId: "org-1" });
  expect(orgService.createOrganization).toHaveBeenCalledOnce();
});
