import { randomUUID } from "node:crypto";

import knex from "knex";
import { expect, test } from "vitest";

import { TDbClient } from "@app/db";
import { down, up } from "@app/db/migrations/20261031160000_vaultix-device-sessions";

import { tokenDALFactory } from "./auth-token-dal";
import { tokenServiceFactory } from "./auth-token-service";

test("real session store preserves browser reuse, all-session revocation and guarded migration rollback", async () => {
  if (!process.env.VAULTIX_SESSION_TEST_DATABASE || !process.env.VAULTIX_SESSION_TEST_USER) {
    throw new Error("Use the disposable session-store verification runner");
  }
  const db = knex({
    client: "pg",
    connection: process.env.VAULTIX_SESSION_TEST_DATABASE,
    pool: { min: 0, max: 1 }
  }) as TDbClient;
  db.replicaNode = () => db;
  const userId = process.env.VAULTIX_SESSION_TEST_USER;
  const browserId = randomUUID();
  const deviceId = randomUUID();
  const eventId = randomUUID();
  const filter = { userId, ip: "192.0.2.17", userAgent: "same-browser-and-cli-fixture" };
  const dal = tokenDALFactory(db);
  const service = tokenServiceFactory({
    tokenDAL: dal,
    userDAL: {} as never,
    orgDAL: {} as never,
    membershipUserDAL: {} as never,
    keyStore: {} as never
  });
  try {
    const existing = await db("auth_token_sessions").where({ userId }).select("id", "accessVersion", "refreshVersion");
    if (!(await db.schema.hasColumn("auth_token_sessions", "sessionType"))) await db.transaction(up);
    expect(await db("auth_token_sessions").where({ userId }).select("id", "accessVersion", "refreshVersion")).toEqual(
      existing
    );
    await db("auth_token_sessions").insert([
      { ...filter, id: deviceId, lastUsed: new Date(), sessionType: "device-v1" },
      { ...filter, id: browserId, lastUsed: new Date(), sessionType: "browser" }
    ]);
    await db.transaction(async (tx) => {
      expect((await service.getUserTokenSession(filter, tx))?.id).toBe(browserId);
      expect((await dal.findOneTokenSession({ id: deviceId, userId }, tx))?.id).toBe(deviceId);
      expect((await dal.findTokenSessions({ userId }, tx)).map((row) => row.id)).toEqual(
        expect.arrayContaining([browserId, deviceId])
      );
    });
    await expect(db.transaction(down)).rejects.toThrow();
    await dal.incrementTokenSessionVersion(userId, deviceId);
    expect((await dal.findOneTokenSession({ id: deviceId }))?.accessVersion).toBe(2);
    await service.revokeMySessionById(userId, browserId);
    const replacement = await service.getUserTokenSession(filter);
    expect(replacement?.id).not.toBe(deviceId);
    expect(replacement?.id).not.toBe(browserId);
    await service.revokeMySessionById(userId, deviceId);
    expect(await dal.findOneTokenSession({ id: deviceId })).toBeUndefined();
    expect((await dal.findOneTokenSession({ id: replacement?.id }))?.id).toBe(replacement?.id);
    await db("vaultix_device_session_events").insert({
      id: eventId,
      sessionId: deviceId,
      userId,
      orgId: randomUUID(),
      action: "revoked",
      provenance: {}
    });
    await expect(db.transaction(down)).rejects.toThrow();
    await db("vaultix_device_session_events").where({ id: eventId }).delete();
    await db.transaction(down);
    expect(await db.schema.hasColumn("auth_token_sessions", "sessionType")).toBe(false);
    expect((await dal.findOneTokenSession({ id: replacement?.id }))?.id).toBe(replacement?.id);
    await db.transaction(up);
    expect((await service.getUserTokenSession(filter))?.id).toBe(replacement?.id);
    await service.revokeAllMySessions(userId);
    expect(await dal.findTokenSessions({ userId })).toEqual([]);
  } finally {
    await db.destroy();
  }
}, 30000);
