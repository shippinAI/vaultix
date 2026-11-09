// Real packaged route to the Go session owner, on a disposable instance.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const FIELDS = ["accessVersion", "createdAt", "id", "ip", "lastUsed", "refreshVersion", "updatedAt", "userAgent", "userId"];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export async function testUserSessions({ origin, email, password, organizationId }) {
  const call = async (path, { method = "GET", body, token, agent = "vaultix-session-proof" } = {}) => {
    for (;;) {
      const response = await fetch(origin + path, { method, signal: AbortSignal.timeout(20000),
        headers: { "User-Agent": agent, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      if (response.status === 429) {
        await new Promise(done => setTimeout(done, ((Number(response.headers.get("retry-after")) || 10) + 1) * 1000));
        continue;
      }
      return { status: response.status, body: await response.json().catch(() => null) };
    }
  };
  const signIn = async agent => {
    const login = await call("/api/v3/auth/login", { method: "POST", agent, body: { email, password } });
    assert.equal(login.status, 200, "Sign-in must succeed");
    const selected = await call("/api/v3/auth/select-organization", { method: "POST", agent, token: login.body.accessToken, body: { organizationId } });
    assert.equal(selected.status, 200, "Organization selection must succeed");
    return selected.body.token;
  };
  const sessions = "/api/v2/users/me/sessions";
  const agents = [`session-proof-${randomUUID()}`, `session-proof-${randomUUID()}`];
  const keep = await signIn(agents[0]);
  const revoke = await signIn(agents[1]);

  const listed = await call(sessions, { token: keep });
  assert.equal(listed.status, 200);
  const own = agent => listed.body.find(session => session.userAgent === agent);
  assert.ok(own(agents[0]) && own(agents[1]), "Both sign-ins must be listed");
  for (const session of listed.body) {
    assert.deepEqual(Object.keys(session).sort(), FIELDS, "The session response shape is a compatibility contract");
    for (const field of ["lastUsed", "createdAt", "updatedAt"]) assert.match(session[field], ISO);
  }
  const used = listed.body.map(session => session.lastUsed);
  assert.deepEqual(used, [...used].sort().reverse(), "Most recently used comes first");

  // Only the Go owner answers 400 here; the earlier route failed with a server error.
  const malformed = await call(`${sessions}/not-a-uuid`, { method: "DELETE", token: keep });
  assert.equal(malformed.status, 400, "A malformed ID must reach the Go session owner");
  assert.equal(typeof malformed.body.error, "string", "Expected failures carry a plain error string");

  const missing = await call(`${sessions}/${randomUUID()}`, { method: "DELETE", token: keep });
  assert.deepEqual([missing.status, missing.body], [200, { message: "Successfully revoked session" }]);

  assert.equal((await call(sessions, { token: revoke })).status, 200, "The second session works before it is revoked");
  const revoked = await call(`${sessions}/${own(agents[1]).id}`, { method: "DELETE", token: keep });
  assert.deepEqual([revoked.status, revoked.body], [200, { message: "Successfully revoked session" }]);
  const after = await call(sessions, { token: keep });
  assert.equal(after.body.some(session => session.id === own(agents[1]).id), false, "A revoked session must leave the list");
  // The sign-in check, still in TypeScript, reports a session that no longer exists as 404.
  assert.equal((await call(sessions, { token: revoke })).status, 404, "A revoked session's token must stop working");
  assert.equal((await call(sessions)).status, 401, "Anonymous access must be refused");

  const leaving = `session-proof-${randomUUID()}`;
  const login = await fetch(`${origin}/api/v3/auth/login`, { method: "POST", signal: AbortSignal.timeout(20000),
    headers: { "User-Agent": leaving, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  assert.equal(login.status, 200, "Sign-in must succeed");
  const refresh = login.headers.getSetCookie().find(cookie => cookie.startsWith("jid="))?.split(";")[0];
  assert.ok(refresh, "Sign-in must set the refresh cookie");
  const { accessToken } = await login.json();
  const before = (await call(sessions, { token: keep })).body.find(session => session.userAgent === leaving);
  const logout = await fetch(`${origin}/api/v1/auth/logout`, { method: "POST", signal: AbortSignal.timeout(20000), headers: { Cookie: refresh } });
  assert.equal(logout.status, 200, "Logout must succeed");
  assert.deepEqual(await logout.json(), { message: "Successfully logged out" });
  assert.ok(logout.headers.getSetCookie().some(cookie => /^jid=;/.test(cookie)), "Logout must clear the refresh cookie");
  const ended = (await call(sessions, { token: keep })).body.find(session => session.userAgent === leaving);
  assert.equal(ended.accessVersion, before.accessVersion + 1, "Logout must end the session's access tokens");
  assert.equal(ended.refreshVersion, before.refreshVersion + 1, "Logout must end the session's refresh tokens");
  const replay = await call("/api/v1/auth/checkAuth", { method: "POST", token: accessToken });
  assert.equal(replay.status, 401, "An access token from before logout must stop working");
}
