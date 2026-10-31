import { isDeepStrictEqual } from "node:util";

import type { Knex } from "knex";

import { TAuditLogQueueServiceFactory } from "@app/ee/services/audit-log/audit-log-queue";
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
  const currentRecipient = async (payload: Notice, tx?: Knex) => {
    const found = await recipients.findRecipient(
      {
        orgId: payload.source.orgId,
        rootOrgId: payload.source.provenance.rootOrgId,
        subjectId: payload.source.subjectId,
        userId: payload.recipient.userId,
        kind: payload.recipient.kind
      },
      tx
    );
    // A different currently eligible organization is not permission to reroute.
    return found?.orgId === payload.recipient.orgId ? found : undefined;
  };
  const dispatch = async (claim: DeviceDeliveryClaim, signal?: AbortSignal): Promise<boolean> => {
    let sending = false;
    try {
      if (signal?.aborted) return await deliveries.failDelivery(claim, "retryable");
      const row = await deliveries.inspectDelivery(claim);
      if (!row) return false;
      const payload = parseDeviceDelivery(row);
      if (!isDeepStrictEqual(payload.source, prepareDeviceEventSource(row.source)))
        throw new DeviceEventUnresolvedError();
      if (row.expiryRemainingMs <= 0) return await deliveries.settleDelivery(row, "expired");
      if (payload.kind === "notification") {
        return await deliveries.commitNotification(row, async (locked, tx) => {
          const notice = parseDeviceDelivery(locked);
          if (notice.kind !== "notification") throw new DeviceEventUnresolvedError();
          if (signal?.aborted) throw new Error("Device dispatch cancelled");
          if (!(await currentRecipient(notice, tx))) return "not-applicable";
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
          if (signal?.aborted) throw new Error("Device dispatch cancelled");
          return "delivered";
        });
      }
      if (payload.kind === "audit") {
        if (signal?.aborted) return await deliveries.failDelivery(row, "retryable");
        const outcome = await audit.persistRecorded(payload.entry);
        return await deliveries.settleDelivery(
          row,
          outcome.storage === "disabled" && outcome.fanout === "disabled" ? "disabled" : "delivered",
          outcome
        );
      }
      if (payload.mailStatus !== "prepared") return await deliveries.settleDelivery(row, payload.mailStatus);
      const recipient = await currentRecipient(payload);
      if (!recipient || !payload.mail || !recordedMailboxMatches(payload.mail.recipient, recipient.email))
        return await deliveries.settleDelivery(row, "not-applicable");
      // Eligibility can take time. Recheck the fence and database-time budget
      // after it, release the transaction, and bound SMTP below lease/expiry.
      const started = performance.now();
      const fresh = await deliveries.inspectDelivery(row);
      if (!fresh) return false;
      if (fresh.expiryRemainingMs <= 0) return await deliveries.settleDelivery(row, "expired");
      const budget = Math.floor(
        Math.min(30000, fresh.leaseRemainingMs, fresh.expiryRemainingMs) - (performance.now() - started) - 1000
      );
      if (signal?.aborted || budget <= 0) return await deliveries.failDelivery(row, "retryable");
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, budget);
      try {
        sending = true;
        const result = await smtp.sendPreparedRecordedMail(row.id, payload.mail, controller.signal);
        return await deliveries.settleDelivery(row, result === "accepted" ? "delivered" : "disabled", { mail: result });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    } catch (error) {
      let reason: "invalid" | "retryable" | "uncertain" = sending ? "uncertain" : "retryable";
      if (error instanceof RecordedMailError) reason = error.disposition;
      if (error instanceof DeviceEventUnresolvedError) reason = "invalid";
      // Never retain or log raw payloads, SQL, SMTP errors or account addresses.
      return deliveries.failDelivery(claim, reason);
    }
  };
  return { dispatch };
};
