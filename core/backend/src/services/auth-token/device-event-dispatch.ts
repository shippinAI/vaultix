import { isDeepStrictEqual } from "node:util";

import type { Knex } from "knex";

import { TAuditLogQueueServiceFactory } from "@app/services/audit-log/audit-log-queue";
import { RecordedOperation, runRecordedOperation } from "@app/lib/recorded-operation";
import { TNotificationServiceFactory } from "@app/services/notification/notification-service";
import { recordedMailboxMatches, RecordedMailError } from "@app/services/smtp/smtp-recorded-payload";
import { TSmtpService } from "@app/services/smtp/smtp-service";

import { deviceEventDeliveryDALFactory } from "./device-event-delivery-dal";
import { DeviceDeliveryClaim } from "./device-event-delivery-types";
import { parseDeviceDelivery } from "./device-event-payload";
import { DeviceEmailPayload, DeviceNotificationPayload } from "./device-event-preparation";
import { deviceEventRecipientDALFactory } from "./device-event-recipient-dal";
import { DeviceEventUnresolvedError, prepareDeviceEventSource } from "./device-event-source";

type Notice = DeviceEmailPayload | DeviceNotificationPayload;
export const deviceEventDispatchFactory = ({
  deliveries,
  recipients,
  audit,
  notifications,
  smtp
}: {
  deliveries: Pick<
    ReturnType<typeof deviceEventDeliveryDALFactory>,
    "inspectDelivery" | "commitNotification" | "settleDelivery" | "failDelivery"
  >;
  recipients: Pick<ReturnType<typeof deviceEventRecipientDALFactory>, "findRecipient">;
  audit: Pick<TAuditLogQueueServiceFactory, "persistRecorded">;
  notifications: Pick<TNotificationServiceFactory, "persistRecordedNotifications">;
  smtp: Pick<TSmtpService, "sendPreparedRecordedMail">;
}) => {
  const currentRecipient = async (payload: Notice, operation: RecordedOperation, tx?: Knex) => {
    const found = await recipients.findRecipient(
      {
        orgId: payload.source.orgId,
        rootOrgId: payload.source.provenance.rootOrgId,
        subjectId: payload.source.subjectId,
        userId: payload.recipient.userId,
        kind: payload.recipient.kind
      },
      tx,
      operation
    );
    // A different currently eligible organization is not permission to reroute.
    return found?.orgId === payload.recipient.orgId ? found : undefined;
  };
  const dispatch = async (claim: DeviceDeliveryClaim, signal?: AbortSignal): Promise<boolean> => {
    let sending = false;
    try {
      return await runRecordedOperation(30000, signal, async (operation) => {
        const settle: typeof deliveries.settleDelivery = (row, status, outcome, tx) =>
          deliveries.settleDelivery(row, status, outcome, tx, operation);
        const retry = (row: DeviceDeliveryClaim) => deliveries.failDelivery(row, "retryable", operation);
        const inspectedAt = performance.now();
        const row = await deliveries.inspectDelivery(claim, operation);
        if (!row) return false;
        const payload = parseDeviceDelivery(row);
        if (!isDeepStrictEqual(payload.source, prepareDeviceEventSource(row.source)))
          throw new DeviceEventUnresolvedError();
        if (row.expiryRemainingMs <= 0) return settle(row, "expired");
        if (payload.kind === "notification") {
          return deliveries.commitNotification(
            row,
            async (locked, tx) => {
              const notice = parseDeviceDelivery(locked);
              if (notice.kind !== "notification") throw new DeviceEventUnresolvedError();
              operation.remainingMs();
              if (!(await currentRecipient(notice, operation, tx))) return "not-applicable";
              const { link, ...content } = notice.content;
              await notifications.persistRecordedNotifications(
                [
                  {
                    ...content,
                    ...(link === null ? {} : { link }),
                    id: locked.id,
                    createdAt: new Date(notice.source.createdAt),
                    userId: notice.recipient.userId,
                    orgId: notice.recipient.orgId
                  }
                ],
                tx
              );
              operation.remainingMs();
              return "delivered";
            },
            operation
          );
        }
        if (payload.kind === "audit") {
          const budget = Math.floor(
            Math.min(operation.remainingMs(), row.leaseRemainingMs, row.expiryRemainingMs) -
              (performance.now() - inspectedAt) -
              1000
          );
          if (budget <= 0) return retry(row);
          const outcome = await runRecordedOperation(budget, operation.signal, (auditOperation) =>
            audit.persistRecorded(payload.entry, auditOperation)
          );
          return settle(
            row,
            outcome.storage === "disabled" && outcome.fanout === "disabled" ? "disabled" : "delivered",
            outcome
          );
        }
        if (payload.mailStatus !== "prepared") return settle(row, payload.mailStatus);
        const recipient = await currentRecipient(payload, operation);
        if (!recipient || !payload.mail || !recordedMailboxMatches(payload.mail.recipient, recipient.email))
          return settle(row, "not-applicable");
        // Eligibility can take time. Recheck the fence and database-time budget
        // after it, release the transaction, and bound SMTP below lease/expiry.
        const started = performance.now();
        const fresh = await deliveries.inspectDelivery(row, operation);
        if (!fresh) return false;
        if (fresh.expiryRemainingMs <= 0) return settle(row, "expired");
        const budget = Math.floor(
          Math.min(operation.remainingMs(), fresh.leaseRemainingMs, fresh.expiryRemainingMs) -
            (performance.now() - started) -
            1000
        );
        if (budget <= 0) return retry(row);
        const controller = new AbortController();
        const abort = () => controller.abort();
        operation.signal.addEventListener("abort", abort, { once: true });
        if (operation.signal.aborted) abort();
        const timer = setTimeout(abort, budget);
        try {
          sending = true;
          const result = await smtp.sendPreparedRecordedMail(row.id, payload.mail, controller.signal);
          return await settle(row, result === "accepted" ? "delivered" : "disabled", { mail: result });
        } finally {
          clearTimeout(timer);
          operation.signal.removeEventListener("abort", abort);
        }
      });
    } catch (error) {
      let reason: "invalid" | "retryable" | "uncertain" = sending ? "uncertain" : "retryable";
      if (error instanceof RecordedMailError) reason = error.disposition;
      if (error instanceof DeviceEventUnresolvedError) reason = "invalid";
      // Never retain or log raw payloads, SQL, SMTP errors or account addresses.
      // Shutdown still records the disposition if possible. This separate short
      // cleanup budget must not inherit the already-aborted attempt signal.
      return runRecordedOperation(5000, undefined, (operation) => deliveries.failDelivery(claim, reason, operation));
    }
  };
  return { dispatch };
};
