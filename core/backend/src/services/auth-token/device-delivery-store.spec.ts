import { randomBytes, randomUUID } from "node:crypto";

import knex from "knex";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { TDbClient } from "@app/db";
import { down, up } from "@app/db/migrations/20261031200000_vaultix-device-event-delivery";
import { TableName } from "@app/db/schemas";
import { NotificationType } from "@app/services/notification/notification-types";
import { userNotificationDALFactory } from "@app/services/notification/user-notification-dal";

import { deviceEventDeliveryDALFactory } from "./device-event-delivery-dal";
import { DeviceDeliveryDestination, PreparedDeviceDelivery } from "./device-event-delivery-types";

const EVENTS = "vx_auth_device_session_events";
const DELIVERIES = "vx_auth_device_event_deliveries";

describe.sequential("durable device delivery in the canonical PostgreSQL store", () => {
  let db: TDbClient;
  let peer: TDbClient;
  let orgId: string;
  const users: string[] = [];
  const connect = () => {
    const connection = knex({
      client: "pg",
      connection: process.env.VAULTIX_SESSION_TEST_DATABASE,
      pool: { min: 0, max: 1 },
      acquireConnectionTimeout: 3000
    }) as TDbClient;
    // Any accidental replica read fails; source claims and acknowledgments need the primary.
    connection.replicaNode = () => {
      throw new Error("Delivery must use primary database");
    };
    return connection;
  };
  const cleanup = async () => {
    await db(TableName.UserNotifications).whereIn("userId", users).delete();
    await db("vx_auth_users").whereIn("id", users).delete();
    await db(EVENTS).whereIn("userId", users).delete();
  };
  const event = async () => {
    const userId = randomUUID();
    const sessionId = randomUUID();
    const id = randomUUID();
    users.push(userId);
    await db("vx_auth_users").insert({
      id: userId,
      username: `delivery-${userId}`,
      email: `${userId}@vaultix.invalid`,
      isAccepted: true
    });
    await db("vx_auth_sessions").insert({
      id: sessionId,
      userId,
      ip: "192.0.2.40",
      userAgent: "Vaultix delivery proof",
      sessionType: "device-v1",
      lastUsed: new Date()
    });
    await db("vx_auth_device_sessions").insert({
      sessionId,
      clientId: "vaultix-cli",
      resource: "https://vaultix.invalid",
      scope: "vaultix:user",
      approval: { sessionId, userId, orgId, rootOrgId: orgId, authMethod: "email" },
      refreshDigest: randomBytes(32),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000)
    });
    await db(EVENTS).insert({
      id,
      sessionId,
      userId,
      orgId,
      action: "revoked",
      provenance: { initiator: "unattributed" }
    });
    return { id, userId, sessionId };
  };
  const delivery = (destination: DeviceDeliveryDestination, recipientId: string): PreparedDeviceDelivery => ({
    destination,
    recipientId,
    payload: { version: 1, title: "Recorded security event" },
    expiresAt: new Date(Date.now() + 3600000)
  });
  const prepared = async (destinations: DeviceDeliveryDestination[] = ["audit"]) => {
    const source = await event();
    const dal = deviceEventDeliveryDALFactory(db);
    const [claim] = await dal.claimPreparation(1);
    const kinds = [...new Set<DeviceDeliveryDestination>(["audit", ...destinations])];
    expect(
      await dal.preparePage(claim, {
        snapshot: { version: 1 },
        cursor: null,
        deliveries: kinds.map((kind) => delivery(kind, kind === "audit" ? orgId : source.userId))
      })
    ).toBe(true);
    return source;
  };
  const expireClaim = async (id: string) =>
    db(DELIVERIES)
      .where({ id })
      .update({
        leaseUntil: db.raw("clock_timestamp()-interval '1 second'"),
        nextAttemptAt: db.raw("clock_timestamp()-interval '1 second'")
      });

  beforeAll(async () => {
    if (!process.env.VAULTIX_SESSION_TEST_DATABASE || !process.env.VAULTIX_SESSION_TEST_ORG)
      throw new Error("Use disposable delivery store runner");
    orgId = process.env.VAULTIX_SESSION_TEST_ORG;
    db = connect();
    peer = connect();
    if (!(await db.schema.hasColumn(EVENTS, "preparationStatus"))) await db.transaction(up);
  });
  beforeEach(cleanup);
  afterAll(async () => {
    try {
      if (users.length) await cleanup();
    } finally {
      await peer?.destroy();
      await db?.destroy();
    }
  });

  test("claims bounded disjoint work on primary with independent one-connection workers", async () => {
    await Promise.all([event(), event(), event()]);
    const left = deviceEventDeliveryDALFactory(db);
    const right = deviceEventDeliveryDALFactory(peer);
    const claims = (await Promise.all([left.claimPreparation(2), right.claimPreparation(2)])).flat();
    expect(claims).toHaveLength(3);
    expect(new Set(claims.map((row) => row.id)).size).toBe(3);
    expect(await left.claimPreparation()).toEqual([]);
    await expect(left.claimPreparation(101)).rejects.toThrow("1 to 100");
    await expect(right.claimDeliveries(0)).rejects.toThrow("1 to 100");
  });

  test("commits bounded pages atomically, freezes payloads and waits for completed preparation", async () => {
    const source = await event();
    const dal = deviceEventDeliveryDALFactory(db);
    const [first] = await dal.claimPreparation();
    const audit = delivery("audit", orgId);
    const cursor = "00000000-0000-4000-8000-000000000001";
    expect(
      await dal.preparePage(
        { ...first, preparationLease: randomUUID() },
        { snapshot: { version: 1 }, cursor: null, deliveries: [] }
      )
    ).toBe(false);
    await expect(dal.preparePage(first, { snapshot: { version: 1 }, cursor: null, deliveries: [] })).rejects.toThrow(
      "requires an audit"
    );
    await expect(
      dal.preparePage(first, { snapshot: { version: 1 }, cursor: null, deliveries: [delivery("audit", randomUUID())] })
    ).rejects.toThrow("source organization");
    expect(
      await dal.preparePage(first, { snapshot: { version: 1, subject: source.userId }, cursor, deliveries: [audit] })
    ).toBe(true);
    expect(await dal.claimDeliveries()).toEqual([]);
    const [second] = await dal.claimPreparation();
    expect(second.preparationCursor).toBe(cursor);
    await expect(dal.preparePage(second, { snapshot: { version: 1 }, cursor: null, deliveries: [] })).rejects.toThrow(
      "snapshot is immutable"
    );
    await expect(
      dal.preparePage(second, { snapshot: { version: 1, subject: source.userId }, cursor, deliveries: [] })
    ).rejects.toThrow("cursor must advance");
    await expect(
      dal.preparePage(second, {
        snapshot: { version: 1, subject: source.userId },
        cursor: null,
        deliveries: [delivery("notification", source.userId), { ...audit, payload: { version: 1, changed: true } }]
      })
    ).rejects.toThrow("conflicts");
    expect(await db(DELIVERIES).where({ eventId: source.id })).toHaveLength(1);
    expect(
      await dal.preparePage(second, {
        snapshot: { subject: source.userId, version: 1 },
        cursor: null,
        deliveries: [audit, delivery("notification", source.userId)]
      })
    ).toBe(true);
    expect(await dal.claimDeliveries()).toHaveLength(2);
    await expect(
      db(EVENTS)
        .where({ id: source.id })
        .update({ preparationSnapshot: { version: 1, changed: true } })
    ).rejects.toThrow("immutable");
  });

  test("rejects cross-tenant delivery rows, immutable mutations and invalid version or size", async () => {
    const source = await prepared();
    const row = await db(DELIVERIES).where({ eventId: source.id }).first<{ id: string }>();
    if (!row) throw new Error("Missing prepared row");
    await expect(
      db(DELIVERIES).insert({
        eventId: source.id,
        orgId: randomUUID(),
        destination: "email",
        recipientId: source.userId,
        payload: { version: 1 },
        expiresAt: new Date()
      })
    ).rejects.toThrow("organization");
    for (const update of [
      { payload: { version: 1, changed: true } },
      { orgId: randomUUID() },
      { recipientId: randomUUID() },
      { expiresAt: new Date() }
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await expect(db(DELIVERIES).where({ id: row.id }).update(update)).rejects.toThrow("immutable");
    }
    await expect(
      db(DELIVERIES).insert({
        eventId: source.id,
        orgId,
        destination: "email",
        recipientId: source.userId,
        payload: {},
        expiresAt: new Date()
      })
    ).rejects.toThrow();
    const another = await event();
    const dal = deviceEventDeliveryDALFactory(db);
    const [claim] = await dal.claimPreparation();
    await expect(
      dal.preparePage(claim, {
        snapshot: { version: 1 },
        cursor: null,
        deliveries: [{ ...delivery("email", another.userId), payload: { version: 1, body: "a".repeat(65536) } }]
      })
    ).rejects.toThrow("snapshot");
    expect(await db(DELIVERIES).where({ eventId: another.id })).toEqual([]);
  });

  test("backs off preparation, fences abandoned owners and retains exhausted or unresolved events", async () => {
    const source = await event();
    const dal = deviceEventDeliveryDALFactory(db);
    const [old] = await dal.claimPreparation();
    expect(await dal.failPreparation(old, "retryable")).toBe(true);
    expect(await dal.claimPreparation()).toEqual([]);
    await db(EVENTS)
      .where({ id: source.id })
      .update({ preparationNextAt: db.raw("clock_timestamp()") });
    const [next] = await dal.claimPreparation();
    expect(next.preparationLease).not.toBe(old.preparationLease);
    expect(await dal.failPreparation(old, "unresolved")).toBe(false);
    await db(EVENTS).where({ id: source.id }).update({ preparationAttempts: 12 });
    expect(await dal.failPreparation(next, "retryable")).toBe(true);
    expect((await db(EVENTS).where({ id: source.id }).first<{ preparationStatus: string }>())?.preparationStatus).toBe(
      "exhausted"
    );
    const unknown = await event();
    const [unresolved] = await dal.claimPreparation();
    expect(await dal.failPreparation(unresolved, "unresolved")).toBe(true);
    expect((await db(EVENTS).where({ id: unknown.id }).first<{ preparationStatus: string }>())?.preparationStatus).toBe(
      "unresolved"
    );
    expect(await dal.pruneSettled(30)).toEqual({ events: 0, deliveries: 0 });
  });

  test("recovers expired audit claims and denies stale acknowledgments without holding a connection", async () => {
    await prepared();
    const dal = deviceEventDeliveryDALFactory(db);
    const [old] = await dal.claimDeliveries();
    await db.raw("SELECT 1");
    await expireClaim(old.id);
    expect(await dal.settleDelivery(old, "delivered")).toBe(false);
    const [next] = await deviceEventDeliveryDALFactory(peer).claimDeliveries();
    expect(next.id).toBe(old.id);
    expect(next.leaseToken).not.toBe(old.leaseToken);
    expect(next.attempts).toBe(2);
    expect(await dal.failDelivery(old, "retryable")).toBe(false);
    expect(await dal.settleDelivery(next, "delivered", { storage: "persisted", fanout: "enqueued" })).toBe(true);
    expect(await dal.claimDeliveries()).toEqual([]);
  });

  test("keeps SMTP abandonment and explicit uncertain acknowledgment unknown instead of resending", async () => {
    await prepared(["email", "audit"]);
    const dal = deviceEventDeliveryDALFactory(db);
    const claims = await dal.claimDeliveries();
    const email = claims.find((row) => row.destination === "email")!;
    const audit = claims.find((row) => row.destination === "audit")!;
    await expireClaim(email.id);
    expect(await dal.claimDeliveries()).toEqual([]);
    expect((await db(DELIVERIES).where({ id: email.id }).first<{ status: string }>())?.status).toBe("unknown");
    expect(await dal.settleDelivery(audit, "disabled", { storage: "disabled", fanout: "disabled" })).toBe(true);
    await prepared(["email"]);
    const secondClaims = await dal.claimDeliveries();
    const uncertain = secondClaims.find((row) => row.destination === "email")!;
    expect(await dal.settleDelivery(secondClaims.find((row) => row.destination === "audit")!, "disabled")).toBe(true);
    expect(await dal.failDelivery(uncertain, "uncertain")).toBe(true);
    expect(await dal.claimDeliveries()).toEqual([]);
    await db("vx_auth_sessions").whereIn("userId", users).delete();
    await db(EVENTS)
      .whereIn("userId", users)
      .update({ preparedAt: db.raw("clock_timestamp()-interval '40 days'") });
    await db(DELIVERIES)
      .where({ status: "disabled" })
      .update({ settledAt: db.raw("clock_timestamp()-interval '40 days'") });
    expect(await dal.pruneSettled(30)).toEqual({ events: 0, deliveries: 0 });
  });

  test("persists actual notifications and acknowledgments atomically without replay after user deletion", async () => {
    const source = await prepared(["notification"]);
    const dal = deviceEventDeliveryDALFactory(db);
    const claim = (await dal.claimDeliveries()).find((row) => row.destination === "notification")!;
    const notifications = userNotificationDALFactory(db);
    const persist = async (row: typeof claim, tx: knex.Knex) => {
      await notifications.persistRecorded(
        [
          {
            id: row.id,
            createdAt: row.createdAt,
            userId: source.userId,
            orgId,
            type: NotificationType.LOGIN_FROM_NEW_DEVICE,
            title: "Device authorization recorded"
          }
        ],
        tx
      );
      return "delivered" as const;
    };
    await expect(
      dal.commitNotification(claim, async (row, tx) => {
        await persist(row, tx);
        throw new Error("Injected ack failure");
      })
    ).rejects.toThrow("Injected ack failure");
    expect(await db(TableName.UserNotifications).where({ id: claim.id })).toEqual([]);
    expect((await db(DELIVERIES).where({ id: claim.id }).first<{ status: string }>())?.status).toBe("processing");
    expect(await dal.commitNotification(claim, persist)).toBe(true);
    expect(await db(TableName.UserNotifications).where({ id: claim.id })).toHaveLength(1);
    await db(TableName.UserNotifications).where({ id: claim.id }).delete();
    expect(await dal.commitNotification(claim, persist)).toBe(false);
    expect(await db(TableName.UserNotifications).where({ id: claim.id })).toEqual([]);
    expect(await dal.claimDeliveries()).toEqual([]);
  });

  test("backs off retryable delivery with stable payload identity and retains exhausted work", async () => {
    const source = await prepared();
    const dal = deviceEventDeliveryDALFactory(db);
    const [first] = await dal.claimDeliveries();
    expect(await dal.failDelivery(first, "retryable")).toBe(true);
    expect(await dal.claimDeliveries()).toEqual([]);
    await db(DELIVERIES)
      .where({ id: first.id })
      .update({ nextAttemptAt: db.raw("clock_timestamp()") });
    const [second] = await deviceEventDeliveryDALFactory(peer).claimDeliveries();
    expect(second.id).toBe(first.id);
    expect(second.payload).toEqual(first.payload);
    expect(second.attempts).toBe(2);
    await db(DELIVERIES).where({ id: second.id }).update({ attempts: 12 });
    expect(await dal.failDelivery(second, "retryable")).toBe(true);
    await db("vx_auth_sessions").where({ id: source.sessionId }).delete();
    await db(EVENTS)
      .where({ id: source.id })
      .update({ preparedAt: db.raw("clock_timestamp()-interval '40 days'") });
    expect(await dal.pruneSettled(30)).toEqual({ events: 0, deliveries: 0 });
    expect((await db(DELIVERIES).where({ id: first.id }).first<{ status: string }>())?.status).toBe("exhausted");
  });

  test("skips rows locked by another worker instead of blocking the claim batch", async () => {
    const first = await event();
    const second = await event();
    await db.transaction(async (tx) => {
      await tx(EVENTS).where({ id: first.id }).forUpdate().first("id");
      const claims = await deviceEventDeliveryDALFactory(peer).claimPreparation(2);
      expect(claims.map((row) => row.id)).toEqual([second.id]);
    });
    expect((await deviceEventDeliveryDALFactory(db).claimPreparation(2)).map((row) => row.id)).toEqual([first.id]);
  });

  test("rolls back notification persistence if the database lease expires during its transaction", async () => {
    const source = await prepared(["notification"]);
    const dal = deviceEventDeliveryDALFactory(db);
    const claim = (await dal.claimDeliveries()).find((row) => row.destination === "notification")!;
    await expect(
      dal.commitNotification(claim, async (row, tx) => {
        await userNotificationDALFactory(db).persistRecorded(
          [
            {
              id: row.id,
              createdAt: row.createdAt,
              userId: source.userId,
              type: NotificationType.LOGIN_FROM_NEW_DEVICE,
              title: "Must roll back"
            }
          ],
          tx
        );
        await tx(DELIVERIES)
          .where({ id: claim.id })
          .update({ leaseUntil: tx.raw("clock_timestamp()-interval '1 second'") });
        return "delivered";
      })
    ).rejects.toThrow("lease expired");
    expect(await db(TableName.UserNotifications).where({ id: claim.id })).toEqual([]);
    expect((await db(DELIVERIES).where({ id: claim.id }).first<{ status: string }>())?.status).toBe("processing");
  });

  test("expires undelivered payloads and distinguishes disabled, not-applicable and exhausted", async () => {
    const source = await event();
    const dal = deviceEventDeliveryDALFactory(db);
    const [prepare] = await dal.claimPreparation();
    await dal.preparePage(prepare, {
      snapshot: { version: 1 },
      cursor: null,
      deliveries: [
        { ...delivery("audit", orgId), expiresAt: new Date(0) },
        delivery("notification", source.userId),
        delivery("email", source.userId)
      ]
    });
    const claims = await dal.claimDeliveries();
    expect(claims).toHaveLength(2);
    expect(
      (await db(DELIVERIES).where({ eventId: source.id, destination: "audit" }).first<{ status: string }>())?.status
    ).toBe("expired");
    const notification = claims.find((row) => row.destination === "notification")!;
    expect(await dal.settleDelivery(notification, "not-applicable")).toBe(true);
    const email = claims.find((row) => row.destination === "email")!;
    await db(DELIVERIES).where({ id: email.id }).update({ attempts: 12 });
    expect(await dal.failDelivery(email, "retryable")).toBe(true);
    expect((await db(DELIVERIES).where({ id: email.id }).first<{ status: string }>())?.status).toBe("exhausted");
  });

  test("prunes only old fully settled events after device metadata is gone and preserves unsafe state", async () => {
    const sources = [await prepared(), await prepared(), await prepared()];
    const dal = deviceEventDeliveryDALFactory(db);
    const claims = await dal.claimDeliveries();
    for (const claim of claims) {
      // eslint-disable-next-line no-await-in-loop
      await dal.settleDelivery(claim, "delivered");
    }
    await db(EVENTS)
      .whereIn(
        "id",
        sources.map((row) => row.id)
      )
      .update({ preparedAt: db.raw("clock_timestamp()-interval '40 days'") });
    await db(DELIVERIES).update({ settledAt: db.raw("clock_timestamp()-interval '40 days'") });
    expect(await dal.pruneSettled(30)).toEqual({ events: 0, deliveries: 0 });
    await db("vx_auth_sessions")
      .whereIn(
        "id",
        sources.slice(0, 2).map((row) => row.sessionId)
      )
      .delete();
    expect(await dal.pruneSettled(30, 1)).toEqual({ events: 1, deliveries: 1 });
    expect(await dal.pruneSettled(30, 1)).toEqual({ events: 1, deliveries: 1 });
    expect(await db(EVENTS).where({ id: sources[2].id })).toHaveLength(1);
    const unresolved = await event();
    const [pending] = await dal.claimPreparation();
    await dal.failPreparation(pending, "unresolved");
    await db("vx_auth_sessions").where({ id: unresolved.sessionId }).delete();
    expect(await dal.pruneSettled(30)).toEqual({ events: 0, deliveries: 0 });
    expect(await db(EVENTS).where({ id: unresolved.id })).toHaveLength(1);
  });

  test("refuses destructive migration rollback with delivery state and supports empty down/up", async () => {
    await prepared();
    await expect(db.transaction(down)).rejects.toThrow("retain the additive schema");
    await cleanup();
    const ownerSessions = await db("vx_auth_sessions").where("sessionType", "browser").select("id");
    await db.transaction(down);
    expect(await db.schema.hasTable(DELIVERIES)).toBe(false);
    await db.transaction(up);
    expect(await db("vx_auth_sessions").where("sessionType", "browser").select("id")).toEqual(ownerSessions);
  });

  test("bounds recipient deletion before pruning a fully settled source event", async () => {
    const source = await event();
    const dal = deviceEventDeliveryDALFactory(db);
    const [claim] = await dal.claimPreparation();
    await dal.preparePage(claim, {
      snapshot: { version: 1 },
      cursor: null,
      deliveries: [
        delivery("audit", orgId),
        ...Array.from({ length: 24 }, () => delivery("notification", randomUUID()))
      ]
    });
    const claims = await dal.claimDeliveries(100);
    for (const row of claims) {
      // eslint-disable-next-line no-await-in-loop
      await dal.settleDelivery(row, "delivered");
    }
    await db("vx_auth_sessions").where({ id: source.sessionId }).delete();
    await db(EVENTS)
      .where({ id: source.id })
      .update({ preparedAt: db.raw("clock_timestamp()-interval '40 days'") });
    await db(DELIVERIES)
      .where({ eventId: source.id })
      .update({ settledAt: db.raw("clock_timestamp()-interval '40 days'") });
    expect(await dal.pruneSettled(30, 10)).toEqual({ events: 0, deliveries: 10 });
    expect(await db(EVENTS).where({ id: source.id })).toHaveLength(1);
    expect(await db(DELIVERIES).where({ eventId: source.id })).toHaveLength(15);
    expect(await dal.pruneSettled(30, 10)).toEqual({ events: 0, deliveries: 10 });
    expect(await dal.pruneSettled(30, 10)).toEqual({ events: 1, deliveries: 5 });
  });
});
