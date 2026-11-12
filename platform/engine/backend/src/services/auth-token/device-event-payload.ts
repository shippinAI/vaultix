import { isDeepStrictEqual } from "node:util";

import { validate as isUuid } from "uuid";

import { parsePreparedRecordedMail } from "@app/services/smtp/smtp-recorded-payload";

import { DeviceDeliveryClaim } from "./device-event-delivery-types";
import {
  deviceAuditEntry,
  DeviceAuditPayload,
  DeviceEmailPayload,
  deviceNotificationContent,
  DeviceNotificationPayload
} from "./device-event-preparation";
import { DeviceEventUnresolvedError, parsePreparedDeviceSource } from "./device-event-source";

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, expected: string[]) =>
  Object.keys(v).length === expected.length && expected.every((k) => Object.hasOwn(v, k));

// Version one fixes audit attribution and notification semantics. A future content
// change must retain this decoder for existing rows or introduce a new version.
export const parseDeviceDelivery = (
  claim: DeviceDeliveryClaim
): DeviceAuditPayload | DeviceNotificationPayload | DeviceEmailPayload => {
  const value: unknown = claim.payload;
  if (
    !record(value) ||
    value.version !== 1 ||
    value.kind !== claim.destination ||
    ![claim.id, claim.eventId, claim.orgId, claim.recipientId].every(isUuid) ||
    !(claim.expiresAt instanceof Date) ||
    !Number.isFinite(claim.expiresAt.getTime())
  )
    throw new DeviceEventUnresolvedError();
  const source = parsePreparedDeviceSource(value.source);
  if (
    source.eventId !== claim.eventId ||
    source.orgId !== claim.orgId ||
    claim.expiresAt.getTime() <= Date.parse(source.createdAt)
  )
    throw new DeviceEventUnresolvedError();
  if (value.kind === "audit") {
    if (
      !keys(value, ["version", "kind", "source", "entry"]) ||
      claim.recipientId !== claim.orgId ||
      !isDeepStrictEqual(value.entry, deviceAuditEntry(source, claim.expiresAt))
    )
      throw new DeviceEventUnresolvedError();
    return value as DeviceAuditPayload;
  }
  const r = value.recipient;
  if (
    !record(r) ||
    !keys(r, ["userId", "orgId", "kind"]) ||
    r.userId !== claim.recipientId ||
    typeof r.orgId !== "string" ||
    !isUuid(r.orgId) ||
    source.action !== "issued" ||
    (r.kind !== "subject" && r.kind !== "administrator") ||
    (r.kind === "subject" && (r.userId !== source.subjectId || r.orgId !== source.orgId)) ||
    (r.kind === "administrator" &&
      (!source.provenance.ssoBypass ||
        r.userId === source.subjectId ||
        (r.orgId !== source.orgId && r.orgId !== source.provenance.rootOrgId)))
  )
    throw new DeviceEventUnresolvedError();
  const recipient: DeviceNotificationPayload["recipient"] = { userId: claim.recipientId, orgId: r.orgId, kind: r.kind };
  if (value.kind === "notification") {
    if (
      !keys(value, ["version", "kind", "source", "recipient", "content"]) ||
      !isDeepStrictEqual(value.content, deviceNotificationContent(recipient))
    )
      throw new DeviceEventUnresolvedError();
    return value as DeviceNotificationPayload;
  }
  if (value.kind !== "email" || !keys(value, ["version", "kind", "source", "recipient", "mailStatus", "mail"]))
    throw new DeviceEventUnresolvedError();
  if (value.mailStatus === "prepared") {
    const mail = parsePreparedRecordedMail(value.mail);
    if (mail.createdAt !== source.createdAt) throw new DeviceEventUnresolvedError();
  } else if ((value.mailStatus !== "disabled" && value.mailStatus !== "not-applicable") || value.mail !== null)
    throw new DeviceEventUnresolvedError();
  return value as DeviceEmailPayload;
};
