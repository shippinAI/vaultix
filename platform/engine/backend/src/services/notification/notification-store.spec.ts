import { randomUUID } from "node:crypto";

import knex from "knex";
import { expect, test } from "vitest";

import { TDbClient } from "@app/db";
import { TableName } from "@app/db/schemas";
import { DatabaseError } from "@app/lib/errors";

import { notificationServiceFactory } from "./notification-service";
import { NotificationType } from "./notification-types";
import { userNotificationDALFactory } from "./user-notification-dal";

test("recorded notifications persist once with atomic caller rollback and one database connection", async () => {
  if (!process.env.VAULTIX_SESSION_TEST_DATABASE || !process.env.VAULTIX_SESSION_TEST_USER)
    throw new Error("Use disposable notification-store runner");
  const db = knex({
    client: "pg",
    connection: process.env.VAULTIX_SESSION_TEST_DATABASE,
    pool: { min: 0, max: 1 }
  }) as TDbClient;
  db.replicaNode = () => db;
  const secondDb = knex({
    client: "pg",
    connection: process.env.VAULTIX_SESSION_TEST_DATABASE,
    pool: { min: 0, max: 1 }
  }) as TDbClient;
  secondDb.replicaNode = () => secondDb;
  const userId = process.env.VAULTIX_SESSION_TEST_USER;
  const id = randomUUID();
  const rolledBackId = randomUUID();
  const concurrentId = randomUUID();
  const service = notificationServiceFactory({
    userNotificationDAL: userNotificationDALFactory(db),
    notificationQueue: {
      pushUserNotifications: async () => {
        throw new Error("Cache is unavailable");
      }
    }
  });
  const secondService = notificationServiceFactory({
    userNotificationDAL: userNotificationDALFactory(secondDb),
    notificationQueue: {
      pushUserNotifications: async () => {
        throw new Error("Cache is unavailable");
      }
    }
  });
  const row = {
    id,
    userId,
    createdAt: new Date(Date.now() - 60000),
    type: NotificationType.ADMIN_SSO_BYPASS,
    title: "Security Alert",
    body: "A device session was approved."
  };
  try {
    await service.persistRecordedNotifications([row]);
    expect((await service.listUserNotifications({ userId, orgId: randomUUID() })).some((item) => item.id === id)).toBe(
      true
    );
    await service.updateUserNotification({ userId, notificationId: id, isRead: true });
    await service.persistRecordedNotifications([row]);
    expect(await db(TableName.UserNotifications).where({ id }).count("id AS count")).toEqual([{ count: "1" }]);
    expect(await db(TableName.UserNotifications).where({ id }).first()).toMatchObject({ isRead: true });
    await expect(service.persistRecordedNotifications([{ ...row, title: "Conflicting replay" }])).rejects.toThrow();
    expect(await db(TableName.UserNotifications).where({ id }).first()).toMatchObject({ title: row.title });
    await expect(
      service.persistRecordedNotifications([
        { ...row, userId: randomUUID() },
        { ...row, id: rolledBackId }
      ])
    ).rejects.toThrow();
    expect(await db(TableName.UserNotifications).where({ id: rolledBackId }).first()).toBeUndefined();
    await expect(
      db.transaction(async (tx) => {
        await service.persistRecordedNotifications([{ ...row, id: rolledBackId }], tx);
        throw new Error("Source acknowledgement failed");
      })
    ).rejects.toThrow("Source acknowledgement failed");
    expect(await db(TableName.UserNotifications).where({ id: rolledBackId }).first()).toBeUndefined();
    await Promise.all([
      service.persistRecordedNotifications([
        { ...row, id: concurrentId },
        { ...row, id: rolledBackId }
      ]),
      secondService.persistRecordedNotifications([
        { ...row, id: rolledBackId },
        { ...row, id: concurrentId }
      ])
    ]);
    expect(await db(TableName.UserNotifications).where({ id: concurrentId }).count("id AS count")).toEqual([
      { count: "1" }
    ]);
    expect(await db(TableName.UserNotifications).where({ id: rolledBackId }).count("id AS count")).toEqual([
      { count: "1" }
    ]);
    await expect(service.persistRecordedNotifications(Array.from({ length: 101 }, () => row))).rejects.toThrow("limit");
    await expect(service.persistRecordedNotifications([{ ...row, id: "invalid" }])).rejects.toThrow("Invalid");
  } catch (error) {
    if (error instanceof DatabaseError) throw error.error;
    throw error;
  } finally {
    await db(TableName.UserNotifications).whereIn("id", [id, rolledBackId, concurrentId]).delete();
    await db.destroy();
    await secondDb.destroy();
  }
}, 30000);
