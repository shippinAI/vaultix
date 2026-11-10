import { randomUUID } from "node:crypto";

import knex from "knex";
import { expect, test } from "vitest";

import { TDbClient } from "@app/db";
import { down, up } from "@app/db/migrations/20261031160000_vaultix-device-sessions";
import { down as contextDown, up as contextUp } from "@app/db/migrations/20261031190000_vaultix-device-event-context";
import {
  down as deliveryDown,
  up as deliveryUp
} from "@app/db/migrations/20261031200000_vaultix-device-event-delivery";

import { tokenDALFactory } from "./auth-token-dal";
import { tokenServiceFactory } from "./auth-token-service";

test("real session store preserves browser reuse, all-session revocation and guarded migration rollback", async () => {
  if (
    !process.env.VAULTIX_SESSION_TEST_DATABASE ||
    !process.env.VAULTIX_SESSION_TEST_USER ||
    !process.env.VAULTIX_SESSION_TEST_ORG
  ) {
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
  const orgId = process.env.VAULTIX_SESSION_TEST_ORG;
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
    const existing = await db("vx_auth_sessions").where({ userId }).select("id", "accessVersion", "refreshVersion");
    if (!(await db.schema.hasColumn("auth_token_sessions", "sessionType"))) await db.transaction(up);
    if (!(await db.schema.hasColumn("vaultix_device_sessions", "sourceContext"))) await db.transaction(contextUp);
    if (!(await db.schema.hasColumn("vaultix_device_session_events", "preparationStatus")))
      await db.transaction(deliveryUp);
    expect(await db("vx_auth_sessions").where({ userId }).select("id", "accessVersion", "refreshVersion")).toEqual(
      existing
    );
    await db("vx_auth_sessions").insert([
      { ...filter, id: deviceId, lastUsed: new Date(), sessionType: "device-v1" },
      { ...filter, id: browserId, lastUsed: new Date(), sessionType: "browser" }
    ]);
    await db("vx_auth_device_sessions").insert({
      sessionId: deviceId,
      clientId: "vaultix-cli",
      resource: "https://vaultix.invalid",
      scope: "vaultix:user",
      approval: { sessionId: deviceId, userId, orgId, rootOrgId: orgId, authMethod: "email" },
      refreshDigest: Buffer.alloc(32, 1),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000)
    });
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
    const records = await db("vx_auth_device_session_events")
      .where({ sessionId: deviceId })
      .select("action", "userId", "orgId");
    expect(records).toEqual([{ action: "revoked", userId, orgId }]);
    await expect(db.transaction(contextDown)).rejects.toThrow();
    await expect(db.transaction(down)).rejects.toThrow();
    await db("vx_auth_device_session_events").where({ sessionId: deviceId }).delete();
    await db.transaction(deliveryDown);
    await db.transaction(contextDown);
    await db.transaction(down);
    expect(await db.schema.hasColumn("auth_token_sessions", "sessionType")).toBe(false);
    expect((await dal.findOneTokenSession({ id: replacement?.id }))?.id).toBe(replacement?.id);
    await db.transaction(up);
    await db.transaction(contextUp);
    await db.transaction(deliveryUp);
    expect((await service.getUserTokenSession(filter))?.id).toBe(replacement?.id);
    await service.revokeAllMySessions(userId);
    expect(await dal.findTokenSessions({ userId })).toEqual([]);
  } finally {
    await db.destroy();
  }
}, 30000);
