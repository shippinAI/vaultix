import { isDeepStrictEqual } from "node:util";

import { EventType, TAuditLogStreamEntry } from "@app/shippin/services/audit-log/audit-log-types";
import { RecordedOperation, runRecordedOperation } from "@app/lib/recorded-operation";
import { ActorType } from "@app/services/auth/auth-type";
import { NotificationType } from "@app/services/notification/notification-types";
import { isRecordedMailbox, PreparedRecordedMail } from "@app/services/smtp/smtp-recorded-payload";
import { SmtpTemplates, TSmtpService } from "@app/services/smtp/smtp-service";

import { deviceEventDeliveryDALFactory } from "./device-event-delivery-dal";
import { DevicePreparationClaim, PreparedDeviceDelivery } from "./device-event-delivery-types";
import { deviceEventRecipientDALFactory, DeviceNoticeRecipient } from "./device-event-recipient-dal";
import { DeviceEventSource, DeviceEventUnresolvedError, prepareDeviceEventSource } from "./device-event-source";

type Recipient = { userId: string; orgId: string; kind: "subject" | "administrator" };
export type DeviceAuditPayload = {
  version: 1;
  kind: "audit";
  source: DeviceEventSource;
  entry: ReturnType<typeof deviceAuditEntry>;
};
export type DeviceNotificationPayload = {
  version: 1;
  kind: "notification";
  source: DeviceEventSource;
  recipient: Recipient;
  content: ReturnType<typeof deviceNotificationContent>;
};
export type DeviceEmailPayload = {
  version: 1;
  kind: "email";
  source: DeviceEventSource;
  recipient: Recipient;
  mailStatus: "prepared" | "disabled" | "not-applicable";
  mail: PreparedRecordedMail | null;
};
type Snapshot = {
  version: 1;
  source: DeviceEventSource;
  auditExpiresAt: string;
  notificationExpiresAt: string;
  emailExpiresAt: string;
};
const DAY = 86400000;
const eventTypes = {
  issued: EventType.DEVICE_SESSION_ISSUED,
  rotated: EventType.DEVICE_SESSION_ROTATED,
  reuse: EventType.DEVICE_SESSION_REUSE,
  revoked: EventType.DEVICE_SESSION_REVOKED,
  "policy-denied": EventType.DEVICE_SESSION_POLICY_DENIED
} as const;

export const deviceAuditEntry = (source: DeviceEventSource, expiresAt: Date) =>
  ({
    id: source.eventId,
    orgId: source.orgId,
    createdAt: source.createdAt,
    expiresAt: expiresAt.toISOString(),
    // Reuse detection, policy denial and deletion do not establish who made the
    // request. The affected account remains explicit in metadata, not the actor.
    actor:
      source.action === "issued" || source.action === "rotated"
        ? {
            type: ActorType.USER,
            metadata: {
              userId: source.subjectId,
              username: source.subject.username,
              ...(source.subject.email ? { email: source.subject.email } : {})
            }
          }
        : { type: ActorType.UNKNOWN_USER, metadata: {} },
    event: {
      type: eventTypes[source.action],
      metadata: {
        sessionId: source.sessionId,
        subjectId: source.subjectId,
        organizationName: source.organizationName,
        contextBasis: source.basis,
        sessionOrigin: source.sessionOrigin,
        ...source.provenance
      }
    }
  }) satisfies TAuditLogStreamEntry;

export const deviceNotificationContent = (recipient: Recipient) =>
  recipient.kind === "subject"
    ? {
        type: NotificationType.LOGIN_FROM_NEW_DEVICE,
        title: "Vaultix CLI session authorized",
        body: "A Vaultix CLI session was authorized for your account. Review your sessions if you did not authorize it.",
        link: null
      }
    : {
        type: NotificationType.ADMIN_SSO_BYPASS,
        title: "Security alert: SSO bypass",
        body: "A member authorized a Vaultix CLI session using SSO bypass. Review the organization audit log.",
        link: `/organizations/${recipient.orgId}/settings`
      };

export const deviceEventPreparationFactory = ({
  deliveries,
  recipients,
  smtp,
  auditRetentionDays
}: {
  deliveries: Pick<ReturnType<typeof deviceEventDeliveryDALFactory>, "preparePage">;
  recipients: Pick<ReturnType<typeof deviceEventRecipientDALFactory>, "listAdministrators">;
  smtp: Pick<TSmtpService, "prepareRecordedMail">;
  auditRetentionDays: (orgId: string) => Promise<number>;
}) => {
  const freeze = async (claim: DevicePreparationClaim, source: DeviceEventSource): Promise<Snapshot> => {
    const stored = claim.preparationSnapshot;
    if (claim.preparationCursor && !stored) throw new DeviceEventUnresolvedError();
    if (stored) {
      const fields = ["version", "source", "auditExpiresAt", "notificationExpiresAt", "emailExpiresAt"];
      const expires = [stored.auditExpiresAt, stored.notificationExpiresAt, stored.emailExpiresAt];
      if (
        stored.version !== 1 ||
        Object.keys(stored).length !== fields.length ||
        !fields.every((key) => Object.hasOwn(stored, key)) ||
        !isDeepStrictEqual(stored.source, source) ||
        !expires.every(
          (value) =>
            typeof value === "string" &&
            Number.isFinite(Date.parse(value)) &&
            new Date(value).toISOString() === value &&
            Date.parse(value) > Date.parse(source.createdAt)
        )
      ) {
        throw new DeviceEventUnresolvedError();
      }
      return stored as Snapshot;
    }
    const days = await auditRetentionDays(source.orgId);
    if (!Number.isInteger(days) || days < 1 || days > 3650) throw new DeviceEventUnresolvedError();
    const expires = (period: number) => new Date(Date.parse(source.createdAt) + period * DAY).toISOString();
    return {
      version: 1,
      source,
      auditExpiresAt: expires(days),
      notificationExpiresAt: expires(90),
      emailExpiresAt: expires(7)
    };
  };

  const preparePage = async (claim: DevicePreparationClaim, operation: RecordedOperation): Promise<boolean> => {
    operation.remainingMs();
    const source = prepareDeviceEventSource(claim);
    const snapshot = await freeze(claim, source);
    operation.remainingMs();
    const rows: PreparedDeviceDelivery[] = [];
    const notice = async (address: DeviceNoticeRecipient, kind: Recipient["kind"]) => {
      operation.remainingMs();
      const recipient: Recipient = { userId: address.userId, orgId: address.orgId, kind };
      const notification: DeviceNotificationPayload = {
        version: 1,
        kind: "notification",
        source,
        recipient,
        content: deviceNotificationContent(recipient)
      };
      rows.push({
        destination: "notification",
        recipientId: recipient.userId,
        payload: notification,
        expiresAt: new Date(snapshot.notificationExpiresAt)
      });
      let mail: PreparedRecordedMail | null = null;
      let mailStatus: DeviceEmailPayload["mailStatus"] = "not-applicable";
      if (isRecordedMailbox(address.email)) {
        mail = await smtp.prepareRecordedMail({
          recipient: address.email,
          createdAt: new Date(source.createdAt),
          template: kind === "subject" ? SmtpTemplates.NewDeviceJoin : SmtpTemplates.OrgAdminBreakglassAccess,
          subjectLine: kind === "subject" ? "Vaultix CLI session authorized" : "Security alert: SSO bypass",
          substitutions: {
            email: source.subject.email ?? source.subject.username,
            timestamp: source.sessionOrigin.createdAt,
            ip: source.sessionOrigin.ip,
            userAgent: source.sessionOrigin.userAgent ?? "Not recorded",
            orgId: recipient.orgId
          }
        });
        // Rendering uses the existing finite in-memory templates. Await it; do
        // not mistake a rejected timer race for cancellation of the renderer.
        operation.remainingMs();
        mailStatus = mail ? "prepared" : "disabled";
      }
      const payload: DeviceEmailPayload = { version: 1, kind: "email", source, recipient, mailStatus, mail };
      rows.push({
        destination: "email",
        recipientId: recipient.userId,
        payload,
        expiresAt: new Date(snapshot.emailExpiresAt)
      });
    };

    // The first committed page contains the source audit and subject notices.
    // Subsequent pages never re-render that content or reselect its recipient.
    if (!claim.preparationCursor) {
      const payload: DeviceAuditPayload = {
        version: 1,
        kind: "audit",
        source,
        entry: deviceAuditEntry(source, new Date(snapshot.auditExpiresAt))
      };
      rows.push({
        destination: "audit",
        recipientId: source.orgId,
        payload,
        expiresAt: new Date(snapshot.auditExpiresAt)
      });
      if (source.action === "issued") {
        await notice({ userId: source.subjectId, orgId: source.orgId, email: source.subject.email }, "subject");
      }
    }
    let cursor: string | null = null;
    if (source.action === "issued" && source.provenance.ssoBypass) {
      const page = await recipients.listAdministrators(
        {
          orgId: source.orgId,
          rootOrgId: source.provenance.rootOrgId,
          subjectId: source.subjectId,
          after: claim.preparationCursor,
          limit: 40
        },
        operation
      );
      for (const recipient of page.recipients) {
        // Rendering is bounded and happens outside the page's database transaction.
        // eslint-disable-next-line no-await-in-loop
        await notice(recipient, "administrator");
      }
      cursor = page.next;
    }
    operation.remainingMs();
    return deliveries.preparePage(claim, { snapshot, cursor, deliveries: rows }, operation);
  };
  const prepare = (claim: DevicePreparationClaim, signal?: AbortSignal) =>
    runRecordedOperation(30000, signal, (operation) => preparePage(claim, operation));
  return { prepare };
};
