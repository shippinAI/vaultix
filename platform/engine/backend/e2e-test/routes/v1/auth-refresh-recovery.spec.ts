import jwt from "jsonwebtoken";

import { seedData1 } from "@app/db/seed-data";
import { KeyStorePrefixes } from "@app/keystore/keystore";
import { AuthModeRefreshJwtTokenPayload } from "@app/services/auth/auth-type";

import { extractCookie } from "../../testUtils/cookies";

const claims = (token: string) =>
  jwt.verify(token, process.env.AUTH_SECRET!) as AuthModeRefreshJwtTokenPayload & { exp: number };

const login = async (scenario: string) => {
  const response = await testServer.inject({
    method: "POST",
    url: "/api/v3/auth/login",
    headers: { "user-agent": `Vaultix refresh recovery ${scenario}` },
    body: { email: seedData1.email, password: seedData1.password }
  });
  expect(response.statusCode).toBe(200);
  const cookie = extractCookie(response, "jid");
  expect(typeof cookie).toBe("string");
  return cookie!;
};

const refresh = (jid: string) => testServer.inject({ method: "POST", url: "/api/v1/auth/token", cookies: { jid } });

describe("Browser refresh recovery", () => {
  test("a lost rotation response recovers a current cookie without extending grace or expiry", async () => {
    const original = await login("lost-response");
    const before = claims(original);
    const first = await refresh(original);
    expect(first.statusCode).toBe(200);
    const successor = claims(extractCookie(first, "jid")!);
    const graceKey = KeyStorePrefixes.RefreshTokenGrace(before.tokenVersionId);
    const ttlBefore = await testRedis.ttl(graceKey);
    expect(ttlBefore).toBeGreaterThan(0);

    // The browser lost the first response, so it still sends the old cookie.
    const recovered = await refresh(original);
    expect(recovered.statusCode).toBe(200);
    const recoveredCookie = extractCookie(recovered, "jid");
    expect(typeof recoveredCookie).toBe("string");
    const after = claims(recoveredCookie!);
    expect(after.refreshVersion).toBe(successor.refreshVersion);
    expect(after.userId).toBe(before.userId);
    expect(after.tokenVersionId).toBe(before.tokenVersionId);
    expect(after.authMethod).toBe(before.authMethod);
    expect(after.exp).toBe(before.exp);
    expect(await testRedis.ttl(graceKey)).toBeLessThanOrEqual(ttlBefore);

    await testRedis.del(graceKey); // Deterministically expire grace, without sleeping.
    expect((await refresh(recoveredCookie!)).statusCode).toBe(200);
  });

  test("replay outside grace still revokes the session family", async () => {
    const original = await login("expired-grace");
    const first = await refresh(original);
    expect(first.statusCode).toBe(200);
    const current = extractCookie(first, "jid")!;
    await testRedis.del(KeyStorePrefixes.RefreshTokenGrace(claims(original).tokenVersionId));
    const replay = await refresh(original);
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error).toBe("TokenReuse");
    expect((await refresh(current)).statusCode).toBeGreaterThanOrEqual(400);
  });

  test("logout invalidates both the current cookie and a cookie still inside grace", async () => {
    const original = await login("logout");
    const first = await refresh(original);
    expect(first.statusCode).toBe(200);
    const current = extractCookie(first, "jid")!;
    const logout = await testServer.inject({ method: "POST", url: "/api/v1/auth/logout", cookies: { jid: current } });
    expect(logout.statusCode).toBe(200);
    expect((await refresh(original)).statusCode).toBeGreaterThanOrEqual(400);
    expect((await refresh(current)).statusCode).toBeGreaterThanOrEqual(400);
  });
});
