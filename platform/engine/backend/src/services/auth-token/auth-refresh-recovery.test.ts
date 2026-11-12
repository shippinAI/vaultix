import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { TAuthTokenSessions } from "@app/db/schemas";
import { crypto } from "@app/lib/crypto/cryptography";
import { UnauthorizedError } from "@app/lib/errors";

import { AuthMethod, AuthModeRefreshJwtTokenPayload, AuthTokenType, MfaMethod } from "../auth/auth-type";
import { tokenServiceFactory } from "./auth-token-service";

const secret = "vaultix-recovery-unit-fixture";
vi.mock("@app/lib/config/env", () => ({ getConfig: () => ({ AUTH_SECRET: "vaultix-recovery-unit-fixture" }) }));
vi.mock("@app/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe("First-party refresh recovery claims", () => {
  const previousFips = process.env.FIPS_ENABLED;
  beforeAll(async () => {
    process.env.FIPS_ENABLED = "false";
    await crypto.initialize({} as never, {} as never, {} as never);
  });
  afterAll(() => {
    if (previousFips === undefined) delete process.env.FIPS_ENABLED;
    else process.env.FIPS_ENABLED = previousFips;
  });

  const session: TAuthTokenSessions = {
    id: "session",
    userId: "user",
    ip: "127.0.0.1",
    refreshVersion: 2,
    accessVersion: 1,
    lastUsed: new Date(),
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const payload = (): AuthModeRefreshJwtTokenPayload & { exp: number; iat: number } => ({
    authTokenType: AuthTokenType.REFRESH_TOKEN,
    authMethod: AuthMethod.EMAIL,
    userId: session.userId,
    tokenVersionId: session.id,
    refreshVersion: 1,
    organizationId: "organization",
    subOrganizationId: "sub-organization",
    isMfaVerified: true,
    mfaMethod: MfaMethod.TOTP,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300
  });
  const service = () =>
    tokenServiceFactory({
      tokenDAL: {} as never,
      userDAL: {} as never,
      orgDAL: {} as never,
      membershipUserDAL: {} as never,
      keyStore: {} as never
    });

  test("retains organization, suborganization, MFA and original timestamps without store writes", () => {
    const original = payload();
    const recovered = service().recoverRefreshToken(original, session);
    const decoded = crypto.jwt().verify(recovered, secret);
    expect(decoded).toEqual({ ...original, refreshVersion: session.refreshVersion });
  });

  test.each([
    { exp: 0 },
    { exp: Number.NaN },
    { exp: undefined },
    { userId: "another-user" },
    { tokenVersionId: "another-session" },
    { refreshVersion: 0 },
    { refreshVersion: 2 },
    { oauthClientId: "delegated-client" }
  ])("rejects invalid recovery context %j", (patch) => {
    expect(() => service().recoverRefreshToken({ ...payload(), ...patch }, session)).toThrow(UnauthorizedError);
  });
});
