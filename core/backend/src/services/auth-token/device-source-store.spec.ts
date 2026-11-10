import { randomBytes, randomUUID } from "node:crypto";

import knex from "knex";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { TDbClient } from "@app/db";
import { down, up } from "@app/db/migrations/20261031190000_vaultix-device-event-context";
import { userDALFactory } from "@app/services/user/user-dal";

import { tokenDALFactory } from "./auth-token-dal";
import { tokenServiceFactory } from "./auth-token-service";

type Context = {
  version: number;
  basis: string;
  subject: { id: string; username: string; email: string; firstName: string };
  organization: { id: string; name: string };
  sessionOrigin: { ip: string; userAgent: string; createdAt: string };
};
type Event = {
  id: string;
  sessionId: string;
  action: string;
  sourceContext: Context | null;
  provenance: Record<string, unknown>;
};

describe.sequential("device source capture in the canonical PostgreSQL store", () => {
  let db: TDbClient;
  let peer: TDbClient;
  let orgId: string;
  let legacy: { userId: string; sessionId: string };
  let legacyMissing: { userId: string; sessionId: string };
  const users: string[] = [];
  const canary = randomBytes(32).toString("hex");
  const connect = () => {
    const connection = knex({
      client: "pg",
      connection: process.env.VAULTIX_SESSION_TEST_DATABASE,
      pool: { min: 0, max: 1 }
    }) as TDbClient;
    connection.replicaNode = () => connection;
    return connection;
  };
  const service = (connection: TDbClient) =>
    tokenServiceFactory({
      tokenDAL: tokenDALFactory(connection),
      userDAL: {} as never,
      orgDAL: {} as never,
      membershipUserDAL: {} as never,
      keyStore: {} as never
    });
  const createUser = async () => {
    const id = randomUUID();
    users.push(id);
    await db("vx_auth_users").insert({
      id,
      username: `source-${id}`,
      email: `${id}@vaultix.invalid`,
      firstName: "Original subject",
      isAccepted: true,
      hashedPassword: canary
    });
    return id;
  };
  const createSession = async (userId: string, method = "email") => {
    const sessionId = randomUUID();
    await db.transaction(async (tx) => {
      await tx("vx_auth_sessions").insert({
        id: sessionId,
        userId,
        ip: "192.0.2.21",
        userAgent: "vaultix-source-proof",
        sessionType: "device-v1",
        lastUsed: new Date()
      });
      await tx("vx_auth_device_sessions").insert({
        sessionId,
        clientId: "vaultix-cli",
        resource: "https://vaultix.invalid",
        scope: "vaultix:user",
        approval: {
          sessionId,
          userId,
          orgId,
          rootOrgId: orgId,
          authMethod: method,
          mfaVerified: true,
          mfaMethod: "totp",
          ssoBypass: false,
          policyDigest: canary
        },
        refreshDigest: Buffer.from(canary, "hex"),
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000)
      });
    });
    return sessionId;
  };
  const record = (userId: string, sessionId: string, action: string, organizationId = orgId) =>
    db("vx_auth_device_session_events").insert({
      id: randomUUID(),
      sessionId,
      userId,
      orgId: organizationId,
      action,
      provenance: { authMethod: "email" }
    });
  const events = (sessionId: string) =>
    db<Event>("vaultix_device_session_events").where({ sessionId }).orderBy("createdAt").select("*");

  beforeAll(async () => {
    if (!process.env.VAULTIX_SESSION_TEST_DATABASE || !process.env.VAULTIX_SESSION_TEST_ORG) {
      throw new Error("Use the disposable device source verification runner");
    }
    orgId = process.env.VAULTIX_SESSION_TEST_ORG;
    db = connect();
    peer = connect();
    if (await db.schema.hasColumn("vaultix_device_sessions", "sourceContext")) await db.transaction(down);
    const userId = await createUser();
    legacy = { userId, sessionId: await createSession(userId) };
    await record(legacy.userId, legacy.sessionId, "issued");
    const missingUser = await createUser();
    legacyMissing = { userId: missingUser, sessionId: await createSession(missingUser) };
    await db.transaction(up);
  });

  afterAll(async () => {
    try {
      if (db) {
        await db("vx_auth_users").whereIn("id", users).delete();
        await db("vx_auth_device_session_events").whereIn("userId", users).delete();
      }
    } finally {
      await peer?.destroy();
      await db?.destroy();
    }
  });

  test("preserves legacy uncertainty and labels later capture without rewriting historical events", async () => {
    expect((await events(legacy.sessionId))[0]?.sourceContext).toBeNull();
    await db("vx_auth_device_sessions")
      .where({ sessionId: legacy.sessionId })
      .update({ refreshDigest: randomBytes(32) });
    await record(legacy.userId, legacy.sessionId, "rotated");
    const rows = await events(legacy.sessionId);
    expect(rows[0]?.sourceContext).toBeNull();
    expect(rows[1]?.sourceContext?.basis).toBe("legacy-capture");
    await expect(db.transaction(down)).rejects.toThrow();
  });

  test("retains unresolved legacy deletion instead of inventing an erased subject profile", async () => {
    await userDALFactory(db).deleteById(legacyMissing.userId);
    const rows = await events(legacyMissing.sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "revoked", sourceContext: null });
  });

  test("freezes bounded credential-free creation context through profile changes and canonical revocation", async () => {
    const userId = await createUser();
    const sessionId = await createSession(userId, "oidc");
    await record(userId, sessionId, "issued");
    const original = (await events(sessionId))[0]?.sourceContext;
    expect(original).toMatchObject({
      version: 1,
      basis: "session-creation",
      subject: { id: userId, firstName: "Original subject" },
      organization: { id: orgId },
      sessionOrigin: { ip: "192.0.2.21", userAgent: "vaultix-source-proof" }
    });
    expect(JSON.stringify(original)).not.toContain(canary);
    expect(Object.keys(original ?? {}).sort()).toEqual([
      "basis",
      "organization",
      "sessionOrigin",
      "subject",
      "version"
    ]);
    await db("vx_auth_users").where({ id: userId }).update({ firstName: "Changed subject" });
    await db("vx_auth_device_sessions")
      .where({ sessionId })
      .update({ refreshDigest: randomBytes(32) });
    await service(db).revokeMySessionById(userId, sessionId);
    const rows = await events(sessionId);
    expect(rows.map((row) => row.action)).toEqual(["issued", "revoked"]);
    expect(rows[1]?.sourceContext).toEqual(original);
    expect(rows[1]?.provenance).toMatchObject({
      authMethod: "oidc",
      initiator: "unattributed",
      termination: "canonical-delete"
    });
    expect(JSON.stringify(rows)).not.toContain(canary);
  });

  test.each(["revoked", "reuse", "policy-denied"])(
    "preserves native terminal reason %s without a duplicate",
    async (action) => {
      const userId = await createUser();
      const sessionId = await createSession(userId);
      await record(userId, sessionId, action);
      await service(db).revokeAllMySessions(userId);
      expect((await events(sessionId)).map((row) => row.action)).toEqual([action]);
    }
  );

  test("canonical account deletion and bulk deletion preserve context after the subject is gone", async () => {
    const firstUser = await createUser();
    const secondUser = await createUser();
    const firstSession = await createSession(firstUser);
    const secondSession = await createSession(secondUser, "okta-saml");
    await userDALFactory(db).deleteById(firstUser);
    await userDALFactory(db).delete({ $in: { id: [secondUser] } });
    expect(await db("vx_auth_users").whereIn("id", [firstUser, secondUser])).toEqual([]);
    expect((await events(firstSession))[0]?.sourceContext?.subject.id).toBe(firstUser);
    expect((await events(secondSession))[0]?.sourceContext?.subject.id).toBe(secondUser);
    expect(await db("vx_auth_device_sessions").whereIn("sessionId", [firstSession, secondSession])).toEqual([]);
  });

  test("concurrent single-connection canonical revocation records one fact and leaves browsers outside this stream", async () => {
    const userId = await createUser();
    const sessionId = await createSession(userId);
    await tokenDALFactory(db).insertTokenSession(userId, "192.0.2.25", "browser-proof");
    await Promise.all([service(db).revokeMySessionById(userId, sessionId), service(peer).revokeAllMySessions(userId)]);
    expect((await events(sessionId)).map((row) => row.action)).toEqual(["revoked"]);
    expect(await db("vx_auth_sessions").where({ userId })).toEqual([]);
    expect(await db("vx_auth_device_session_events").where({ userId }).count("*").first()).toMatchObject({
      count: "1"
    });
  });

  test("event failure rolls back canonical deletion; explicit caller rollback also preserves the session", async () => {
    const userId = await createUser();
    const sessionId = await createSession(userId);
    await db.raw(
      "ALTER TABLE vx_auth_device_session_events ADD CONSTRAINT source_test_failure CHECK (action <> 'revoked') NOT VALID"
    );
    try {
      await expect(service(db).revokeMySessionById(userId, sessionId)).rejects.toThrow();
      expect(await tokenDALFactory(db).findOneTokenSession({ id: sessionId })).toBeDefined();
      await expect(userDALFactory(db).deleteById(userId)).rejects.toThrow();
      expect(await db("vx_auth_users").where({ id: userId }).first()).toBeDefined();
      expect(await events(sessionId)).toEqual([]);
    } finally {
      await db.raw("ALTER TABLE vx_auth_device_session_events DROP CONSTRAINT source_test_failure");
    }
    await expect(
      db.transaction(async (tx) => {
        await tokenDALFactory(db).deleteTokenSession({ id: sessionId }, tx);
        throw new Error("rollback-proof");
      })
    ).rejects.toThrow("rollback-proof");
    expect(await events(sessionId)).toEqual([]);
    expect(await tokenDALFactory(db).findOneTokenSession({ id: sessionId })).toBeDefined();
    await service(db).revokeMySessionById(userId, sessionId);
    expect((await events(sessionId)).map((row) => row.action)).toEqual(["revoked"]);
  });

  test("rejects wrong-tenant records and immutable source changes while allowing delivery acknowledgment", async () => {
    const userId = await createUser();
    const sessionId = await createSession(userId);
    await expect(record(userId, sessionId, "issued", randomUUID())).rejects.toThrow();
    await expect(record(randomUUID(), sessionId, "issued")).rejects.toThrow();
    await record(userId, sessionId, "issued");
    await db("vx_auth_device_session_events").insert({
      id: randomUUID(),
      sessionId,
      userId,
      orgId,
      action: "rotated",
      provenance: {},
      sourceContext: { version: 1, subject: { id: randomUUID() } }
    });
    expect((await events(sessionId))[1]?.sourceContext?.subject.id).toBe(userId);
    await expect(db("vx_auth_device_sessions").where({ sessionId }).update({ sourceContext: {} })).rejects.toThrow();
    await expect(db("vx_auth_device_session_events").where({ sessionId }).update({ provenance: {} })).rejects.toThrow();
    await expect(
      db("vx_auth_device_session_events").where({ sessionId }).update({ orgId: randomUUID() })
    ).rejects.toThrow();
    await db("vx_auth_device_session_events").where({ sessionId }).update({ auditDeliveredAt: new Date() });
    expect((await events(sessionId))[0]?.sourceContext?.subject.id).toBe(userId);
  });

  test("empty source-state schema rollback and reapplication preserve existing browser sessions", async () => {
    const before = await db("vx_auth_sessions").where({ sessionType: "browser" }).select("id", "userId");
    await db("vx_auth_users").whereIn("id", users).delete();
    await db("vx_auth_device_session_events").whereIn("userId", users).delete();
    await db.transaction(down);
    expect(await db.schema.hasColumn("vaultix_device_sessions", "sourceContext")).toBe(false);
    await db.transaction(up);
    expect(await db.schema.hasColumn("vaultix_device_sessions", "sourceContext")).toBe(true);
    expect(await db("vx_auth_sessions").where({ sessionType: "browser" }).select("id", "userId")).toEqual(before);
  });
});
