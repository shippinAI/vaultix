import type { Knex } from "knex";
import { validate as isUuid } from "uuid";

import { TDbClient } from "@app/db";
import { withRecordedTransaction } from "@app/lib/knex/recorded-transaction";
import { RecordedOperation } from "@app/lib/recorded-operation";

import {
  DeviceCapturedEvent,
  DeviceDeliveryClaim,
  DeviceDeliveryDisposition,
  DeviceDeliveryOutcome,
  DeviceDeliverySnapshot,
  DevicePreparationClaim,
  PreparedDeviceDelivery
} from "./device-event-delivery-types";

// Created by raw-SQL migrations and renamed to vx_ names (docs/0119).
const EVENTS = "vx_auth_device_session_events";
const DELIVERIES = "vx_auth_device_event_deliveries";
const LEASE_SECONDS = 60;
const MAX_ATTEMPTS = 12;
const batchSize = (limit: number) => {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Device delivery batch must contain 1 to 100 records");
  return limit;
};
const snapshot = (value: DeviceDeliverySnapshot, maxBytes: number) => {
  const encoded = JSON.stringify(value);
  if (!value || value.version !== 1 || !encoded || Buffer.byteLength(encoded) > maxBytes) {
    throw new Error("Invalid device delivery snapshot");
  }
  return encoded;
};

export const deviceEventDeliveryDALFactory = (db: TDbClient) => {
  const query = <T>(operation: RecordedOperation | undefined, work: (tx: Knex) => Promise<T>): Promise<T> =>
    operation ? withRecordedTransaction(db, operation, work) : work(db);
  const transaction = <T>(operation: RecordedOperation | undefined, work: (tx: Knex) => Promise<T>): Promise<T> =>
    operation
      ? withRecordedTransaction(db, operation, work)
      : db.transaction(async (tx) => {
          await tx.raw("SET LOCAL statement_timeout = '5s'");
          return work(tx);
        });
  const claimPreparation = async (limit = 20, operation?: RecordedOperation): Promise<DevicePreparationClaim[]> => {
    const result = await query(operation, async (tx) =>
      tx.raw<{ rows: (DevicePreparationClaim & { preparationStatus: string })[] }>(
        `
      WITH candidates AS (
        SELECT id FROM ${EVENTS}
        WHERE "preparationStatus" IN ('pending','preparing') AND "preparationNextAt"<=clock_timestamp()
        ORDER BY "preparationNextAt",id LIMIT ? FOR UPDATE SKIP LOCKED
      ) UPDATE ${EVENTS} e SET
        "preparationStatus"=CASE WHEN e."preparationAttempts">=? THEN 'exhausted' ELSE 'preparing' END,
        "preparationAttempts"=LEAST(e."preparationAttempts"+1,?),
        "preparationLease"=CASE WHEN e."preparationAttempts"<? THEN gen_random_uuid() END,
        "preparationLeaseUntil"=CASE WHEN e."preparationAttempts"<? THEN clock_timestamp()+?*interval '1 second' END,
        "preparationNextAt"=clock_timestamp()+?*interval '1 second'
      FROM candidates c WHERE e.id=c.id RETURNING e.*
    `,
        [batchSize(limit), MAX_ATTEMPTS, MAX_ATTEMPTS, MAX_ATTEMPTS, MAX_ATTEMPTS, LEASE_SECONDS, LEASE_SECONDS]
      )
    );
    return result.rows.filter((row) => row.preparationStatus === "preparing");
  };

  const preparationFence = (tx: Knex, claim: Pick<DevicePreparationClaim, "id" | "preparationLease">) =>
    tx(EVENTS)
      .where({ id: claim.id, preparationStatus: "preparing", preparationLease: claim.preparationLease })
      .where("preparationLeaseUntil", ">", tx.raw("clock_timestamp()"));

  const preparePage = async (
    claim: Pick<DevicePreparationClaim, "id" | "preparationLease">,
    data: { snapshot: DeviceDeliverySnapshot; cursor: string | null; deliveries: PreparedDeviceDelivery[] },
    operation?: RecordedOperation
  ): Promise<boolean> => {
    operation?.remainingMs();
    const encoded = snapshot(data.snapshot, 16384);
    if (data.deliveries.length > 100 || (data.cursor !== null && !isUuid(data.cursor))) {
      throw new Error("Invalid device delivery preparation page");
    }
    const rows = data.deliveries
      .map((delivery) => {
        if (
          !isUuid(delivery.recipientId) ||
          !["audit", "notification", "email"].includes(delivery.destination) ||
          !(delivery.expiresAt instanceof Date) ||
          !Number.isFinite(delivery.expiresAt.getTime())
        ) {
          throw new Error("Invalid prepared device delivery");
        }
        snapshot(delivery.payload, 65536);
        return delivery;
      })
      .sort((a, b) => `${a.destination}:${a.recipientId}`.localeCompare(`${b.destination}:${b.recipientId}`));
    if (new Set(rows.map((row) => `${row.destination}:${row.recipientId}`)).size !== rows.length) {
      throw new Error("Duplicate device delivery in preparation page");
    }
    return transaction(operation, async (tx) => {
      const source = await preparationFence(tx, claim).forUpdate().first<{
        orgId: string;
        preparationCursor: string | null;
        preparationSnapshot: DeviceDeliverySnapshot | null;
      }>();
      if (!source) return false;
      // PostgreSQL compares JSON structurally; object key order must not change a retry.
      if (
        source.preparationSnapshot &&
        (
          await tx.raw<{ rows: { conflict: boolean }[] }>("SELECT ?::jsonb IS DISTINCT FROM ?::jsonb AS conflict", [
            JSON.stringify(source.preparationSnapshot),
            encoded
          ])
        ).rows[0].conflict
      )
        throw new Error("Device preparation snapshot is immutable");
      if (data.cursor && source.preparationCursor && data.cursor <= source.preparationCursor) {
        throw new Error("Device preparation cursor must advance");
      }
      for (const row of rows) {
        operation?.remainingMs();
        if (row.destination === "audit" && row.recipientId !== source.orgId) {
          throw new Error("Device audit destination must match its source organization");
        }
        // The event row serializes pages, and a retry must preserve the prepared content.
        // eslint-disable-next-line no-await-in-loop
        const inserted = await tx(DELIVERIES)
          .insert({ ...row, eventId: claim.id, orgId: source.orgId })
          .onConflict(["eventId", "destination", "recipientId"])
          .ignore()
          .returning("id");
        if (!inserted.length) {
          // eslint-disable-next-line no-await-in-loop
          const same = await tx(DELIVERIES)
            .where({ eventId: claim.id, destination: row.destination, recipientId: row.recipientId })
            .whereRaw("payload = ?::jsonb", [JSON.stringify(row.payload)])
            .where("expiresAt", row.expiresAt)
            .first<{ id: string }>("id");
          if (!same) throw new Error("Prepared device delivery conflicts with its recorded payload");
        }
      }
      if (
        !data.cursor &&
        !(await tx(DELIVERIES)
          .where({ eventId: claim.id, destination: "audit", recipientId: source.orgId })
          .first("id"))
      ) {
        throw new Error("Device preparation requires an audit delivery");
      }
      const changed = await preparationFence(tx, claim).update({
        preparationSnapshot: data.snapshot,
        preparationCursor: data.cursor ?? source.preparationCursor,
        preparationStatus: data.cursor ? "pending" : "prepared",
        preparationAttempts: 0,
        preparationNextAt: tx.raw("clock_timestamp()"),
        preparationLease: null,
        preparationLeaseUntil: null,
        preparedAt: data.cursor ? null : tx.raw("clock_timestamp()")
      });
      if (!changed) throw new Error("Device preparation lease expired before commit");
      return true;
    });
  };

  const failPreparation = async (
    claim: Pick<DevicePreparationClaim, "id" | "preparationLease">,
    reason: "retryable" | "unresolved",
    operation?: RecordedOperation
  ) =>
    query(operation, async (tx) =>
      preparationFence(tx, claim)
        .update({
          preparationStatus:
            reason === "unresolved"
              ? "unresolved"
              : tx.raw(`CASE WHEN "preparationAttempts">=? THEN 'exhausted' ELSE 'pending' END`, [MAX_ATTEMPTS]),
          preparationLease: null,
          preparationLeaseUntil: null,
          preparationNextAt: tx.raw(
            `clock_timestamp()+LEAST(3600,5*power(2,"preparationAttempts"-1))*interval '1 second'`
          )
        })
        .then(Boolean)
    );

  const claimDeliveries = async (limit = 20, operation?: RecordedOperation): Promise<DeviceDeliveryClaim[]> => {
    const result = await query(operation, async (tx) =>
      tx.raw<{ rows: (DeviceDeliveryClaim & { status: string })[] }>(
        `
      WITH candidates AS (
        SELECT d.id,CASE
          WHEN d.status='processing' AND d.destination='email' THEN 'unknown'
          WHEN d."expiresAt"<=clock_timestamp() THEN 'expired'
          WHEN d.attempts>=? THEN 'exhausted' ELSE 'processing' END AS next_status
        FROM ${DELIVERIES} d JOIN ${EVENTS} e ON e.id=d."eventId"
        WHERE e."preparationStatus"='prepared' AND d.status IN ('pending','processing')
          AND d."nextAttemptAt"<=clock_timestamp()
        ORDER BY d."nextAttemptAt",d.id LIMIT ? FOR UPDATE OF d SKIP LOCKED
      ) UPDATE ${DELIVERIES} d SET status=c.next_status,
        attempts=CASE WHEN c.next_status='processing' THEN d.attempts+1 ELSE d.attempts END,
        "leaseToken"=CASE WHEN c.next_status='processing' THEN gen_random_uuid() END,
        "leaseUntil"=CASE WHEN c.next_status='processing' THEN clock_timestamp()+?*interval '1 second' END,
        "nextAttemptAt"=clock_timestamp()+?*interval '1 second',
        "settledAt"=CASE WHEN c.next_status='expired' THEN clock_timestamp() END
      FROM candidates c WHERE d.id=c.id RETURNING d.*
    `,
        [MAX_ATTEMPTS, batchSize(limit), LEASE_SECONDS, LEASE_SECONDS]
      )
    );
    return result.rows.filter((row) => row.status === "processing");
  };

  const deliveryFence = (tx: Knex, claim: Pick<DeviceDeliveryClaim, "id" | "leaseToken">) =>
    tx(DELIVERIES)
      .where({ id: claim.id, status: "processing", leaseToken: claim.leaseToken })
      .where("leaseUntil", ">", tx.raw("clock_timestamp()"));

  const settleDelivery = async (
    claim: Pick<DeviceDeliveryClaim, "id" | "leaseToken">,
    status: DeviceDeliveryDisposition,
    outcome: DeviceDeliveryOutcome = {},
    tx?: Knex,
    operation?: RecordedOperation
  ) => {
    operation?.remainingMs();
    const update = async (connection: Knex) =>
      deliveryFence(connection, claim)
        .update({
          status,
          outcome,
          settledAt: connection.raw("clock_timestamp()"),
          leaseToken: null,
          leaseUntil: null
        })
        .then(Boolean);
    return tx ? update(tx) : query(operation, update);
  };

  // Re-read the immutable row and its lease from the primary immediately before
  // external work. Budgets use database time; application clock skew is irrelevant.
  const inspectDelivery = async (
    claim: Pick<DeviceDeliveryClaim, "id" | "leaseToken">,
    operation?: RecordedOperation
  ) =>
    transaction(operation, async (tx) => {
      const row = await deliveryFence(tx, claim)
        .select(
          "*",
          tx.raw('EXTRACT(EPOCH FROM ("leaseUntil"-clock_timestamp()))::float8*1000 AS "leaseRemainingMs"'),
          tx.raw('EXTRACT(EPOCH FROM ("expiresAt"-clock_timestamp()))::float8*1000 AS "expiryRemainingMs"')
        )
        .first<DeviceDeliveryClaim & { leaseRemainingMs: number; expiryRemainingMs: number }>();
      if (!row) return undefined;
      const source = await tx(EVENTS)
        .where({ id: row.eventId })
        .first<DeviceCapturedEvent>(
          "id",
          "sessionId",
          "orgId",
          "userId",
          "action",
          "createdAt",
          "sourceContext",
          "provenance"
        );
      return source ? { ...row, source } : undefined;
    });

  const failDelivery = async (
    claim: Pick<DeviceDeliveryClaim, "id" | "leaseToken">,
    reason: "retryable" | "uncertain" | "invalid",
    operation?: RecordedOperation
  ) =>
    query(operation, async (tx) =>
      deliveryFence(tx, claim)
        .update({
          status: {
            invalid: "exhausted",
            uncertain: "unknown",
            retryable: tx.raw("CASE WHEN attempts>=? THEN 'exhausted' ELSE 'pending' END", [MAX_ATTEMPTS])
          }[reason],
          leaseToken: null,
          leaseUntil: null,
          nextAttemptAt: tx.raw(`clock_timestamp()+LEAST(3600,5*power(2,attempts-1))*interval '1 second'`)
        })
        .then(Boolean)
    );

  const commitNotification = async (
    claim: Pick<DeviceDeliveryClaim, "id" | "leaseToken">,
    persist: (row: DeviceDeliveryClaim, tx: Knex) => Promise<"delivered" | "not-applicable">,
    operation?: RecordedOperation
  ): Promise<boolean> =>
    transaction(operation, async (tx) => {
      const row = await deliveryFence(tx, claim)
        .where("destination", "notification")
        .forUpdate()
        .first<DeviceDeliveryClaim>();
      if (!row) return false;
      if (
        row.expiresAt <=
        new Date((await tx.raw<{ rows: { now: Date }[] }>("SELECT clock_timestamp() AS now")).rows[0].now)
      ) {
        return settleDelivery(claim, "expired", {}, tx, operation);
      }
      // This callback is database-only and must use tx. It may not enqueue or send.
      const disposition = await persist(row, tx);
      if (!(await settleDelivery(claim, disposition, {}, tx, operation)))
        throw new Error("Device notification lease expired before commit");
      return true;
    });

  const pruneSettled = async (
    retentionDays: number,
    limit = 100,
    operation?: RecordedOperation
  ): Promise<{ events: number; deliveries: number }> => {
    if (!Number.isInteger(retentionDays) || retentionDays < 30 || retentionDays > 3650)
      throw new Error("Invalid device event retention");
    batchSize(limit);
    return transaction(operation, async (tx) => {
      // Delete recipients in bounded batches before their source. Cascading an
      // event with a large organization would otherwise make LIMIT misleading.
      const removed = await tx.raw<{ rows: { id: string }[] }>(
        `
        WITH candidates AS (
          SELECT d.id FROM ${DELIVERIES} d JOIN ${EVENTS} e ON e.id=d."eventId"
          WHERE e."preparationStatus"='prepared' AND e."preparedAt"<clock_timestamp()-?*interval '1 day'
            AND NOT EXISTS (SELECT 1 FROM vx_auth_device_sessions s WHERE s."sessionId"=e."sessionId")
            AND NOT EXISTS (SELECT 1 FROM ${DELIVERIES} pending WHERE pending."eventId"=e.id
              AND (pending.status NOT IN ('delivered','disabled','not-applicable','expired')
                OR pending."settledAt">=clock_timestamp()-?*interval '1 day'))
          ORDER BY d."settledAt",d.id LIMIT ? FOR UPDATE OF d SKIP LOCKED
        ) DELETE FROM ${DELIVERIES} d USING candidates c WHERE d.id=c.id RETURNING d.id
      `,
        [retentionDays, retentionDays, limit]
      );
      const result = await tx.raw<{ rows: { id: string }[] }>(
        `
      WITH candidates AS (
        SELECT e.id FROM ${EVENTS} e WHERE e."preparationStatus"='prepared'
          AND e."preparedAt"<clock_timestamp()-?*interval '1 day'
          AND NOT EXISTS (SELECT 1 FROM vx_auth_device_sessions s WHERE s."sessionId"=e."sessionId")
          AND NOT EXISTS (SELECT 1 FROM ${DELIVERIES} d WHERE d."eventId"=e.id)
        ORDER BY e."preparedAt",e.id LIMIT ? FOR UPDATE OF e SKIP LOCKED
      ) DELETE FROM ${EVENTS} e USING candidates c WHERE e.id=c.id RETURNING e.id
    `,
        [retentionDays, limit]
      );
      return { events: result.rows.length, deliveries: removed.rows.length };
    });
  };

  return {
    claimPreparation,
    preparePage,
    failPreparation,
    claimDeliveries,
    settleDelivery,
    inspectDelivery,
    failDelivery,
    commitNotification,
    pruneSettled
  };
};
