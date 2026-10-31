import knex from "knex";
import { validate as isUuid } from "uuid";

import { TDbClient } from "@app/db";
import { TableName } from "@app/db/schemas";
import { DatabaseError, GatewayTimeoutError } from "@app/lib/errors";
import { ormify, selectAllTableCols } from "@app/lib/knex";
import { logger } from "@app/lib/logger";

import { TRecordedUserNotification } from "./notification-types";

export type TUserNotificationDALFactory = ReturnType<typeof userNotificationDALFactory>;

const QUERY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const PRUNE_BATCH_SIZE = 10000;
const MAX_RETRY_ON_FAILURE = 3;

export const userNotificationDALFactory = (db: TDbClient) => {
  const notificationOrm = ormify(db, TableName.UserNotifications);

  const persistRecorded = async (data: TRecordedUserNotification[], tx?: knex.Knex) => {
    if (data.length > 100) throw new Error("Recorded notification batch exceeds its limit");
    if (!data.length) return;
    for (const row of data) {
      if (
        !isUuid(row.id) ||
        !isUuid(row.userId) ||
        (row.orgId !== undefined && !isUuid(row.orgId)) ||
        !(row.createdAt instanceof Date) ||
        !Number.isFinite(row.createdAt.getTime()) ||
        !row.type ||
        row.type.length > 128 ||
        !row.title ||
        row.title.length > 255 ||
        (row.body?.length ?? 0) > 4096 ||
        (row.link?.length ?? 0) > 255
      ) {
        throw new Error("Invalid recorded notification");
      }
    }
    const ordered = [...data].sort(
      (left, right) => left.id.localeCompare(right.id) || left.createdAt.getTime() - right.createdAt.getTime()
    );
    try {
      const persist = async (connection: knex.Knex) => {
        // The partitioned store's identity includes createdAt. Pin both fields
        // on replay so it neither duplicates notifications nor resets read state.
        await connection(TableName.UserNotifications)
          .insert(
            ordered.map((row) => ({
              id: row.id,
              userId: row.userId,
              orgId: row.orgId,
              type: row.type,
              title: row.title,
              body: row.body,
              link: row.link,
              createdAt: row.createdAt,
              updatedAt: row.createdAt,
              isRead: false
            }))
          )
          .onConflict(["id", "createdAt"])
          .ignore();
        const stored = await connection(TableName.UserNotifications)
          .whereIn(
            ["id", "createdAt"],
            ordered.map((row) => [row.id, row.createdAt])
          )
          .select("*")
          .orderBy("id")
          .orderBy("createdAt")
          .forShare();
        for (const row of data) {
          const previous = stored.find(
            (item) => item.id === row.id && item.createdAt.getTime() === row.createdAt.getTime()
          );
          if (
            !previous ||
            previous.userId !== row.userId ||
            (previous.orgId ?? null) !== (row.orgId ?? null) ||
            previous.type !== row.type ||
            previous.title !== row.title ||
            (previous.body ?? null) !== (row.body ?? null) ||
            (previous.link ?? null) !== (row.link ?? null) ||
            previous.createdAt.getTime() !== row.createdAt.getTime()
          ) {
            throw new Error("Recorded notification identity conflict");
          }
        }
      };
      if (tx) await persist(tx);
      else await db.transaction(persist);
    } catch (error) {
      throw new DatabaseError({ error, name: "PersistRecordedNotifications" });
    }
  };

  const find = async (
    {
      userId,
      orgId,
      startDate,
      endDate,
      limit = 1000,
      offset = 0
    }: {
      userId: string;
      orgId: string;
      startDate: string;
      endDate: string;
      limit?: number;
      offset?: number;
    },
    tx?: knex.Knex
  ) => {
    try {
      const docs = await (tx || db.replicaNode())(TableName.UserNotifications)
        .where(`${TableName.UserNotifications}.userId`, userId)
        .andWhere((qb) => {
          void qb
            .where(`${TableName.UserNotifications}.orgId`, orgId)
            .orWhereNull(`${TableName.UserNotifications}.orgId`);
        })
        .whereRaw(`"${TableName.UserNotifications}"."createdAt" >= ?::timestamptz`, [startDate])
        .andWhereRaw(`"${TableName.UserNotifications}"."createdAt" < ?::timestamptz`, [endDate])
        .select(selectAllTableCols(TableName.UserNotifications))
        .limit(limit)
        .offset(offset)
        .orderBy(`${TableName.UserNotifications}.createdAt`, "desc")
        .timeout(1000 * 120); // 2 minutes timeout

      return docs;
    } catch (error) {
      if (error instanceof knex.KnexTimeoutError) {
        throw new GatewayTimeoutError({
          error,
          message: "Failed to fetch notifications due to timeout."
        });
      }

      throw new DatabaseError({ error });
    }
  };

  // delete all notifications older than 3 months
  const pruneNotifications = async () => {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    let deletedNotificationIds: { id: string }[] = [];
    let numberOfRetryOnFailure = 0;

    logger.info(`daily-resource-cleanup: prune notifications started`);
    do {
      try {
        // eslint-disable-next-line no-await-in-loop
        deletedNotificationIds = await db.transaction(async (trx) => {
          await trx.raw(`SET LOCAL statement_timeout = ${QUERY_TIMEOUT_MS}`);

          const findExpiredNotificationSubQuery = trx(TableName.UserNotifications)
            .where("createdAt", "<", threeMonthsAgo)
            .orderBy(`${TableName.UserNotifications}.createdAt`, "desc")
            .select("id")
            .limit(PRUNE_BATCH_SIZE);

          // eslint-disable-next-line no-await-in-loop
          const results = await trx(TableName.UserNotifications)
            .whereIn("id", findExpiredNotificationSubQuery)
            .del()
            .returning("id");

          return results;
        });

        numberOfRetryOnFailure = 0;
      } catch (error) {
        numberOfRetryOnFailure += 1;
        deletedNotificationIds = [];
        logger.error(error, "Failed to delete notification on pruning. Retrying...");
      } finally {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
      }
    } while (
      deletedNotificationIds.length > 0 ||
      (numberOfRetryOnFailure > 0 && numberOfRetryOnFailure < MAX_RETRY_ON_FAILURE)
    );

    if (numberOfRetryOnFailure >= MAX_RETRY_ON_FAILURE) {
      logger.error(
        `daily-resource-cleanup: prune notifications completed with persistent errors after ${MAX_RETRY_ON_FAILURE} retries. Some notifications might not have been pruned.`
      );
    } else {
      logger.info(`daily-resource-cleanup: prune notifications completed`);
    }
  };

  const markAllNotificationsAsRead = async (userId: string, orgId: string) => {
    await db(TableName.UserNotifications)
      .where({ userId })
      .andWhere((qb) => {
        void qb.where({ orgId }).orWhereNull("orgId");
      })
      .update({ isRead: true });
  };

  return { ...notificationOrm, pruneNotifications, find, markAllNotificationsAsRead, persistRecorded };
};
