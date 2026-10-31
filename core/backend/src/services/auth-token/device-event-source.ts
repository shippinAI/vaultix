import { isDeepStrictEqual } from "node:util";

import { validate as isUuid } from "uuid";

import { DeviceCapturedEvent, DevicePreparationClaim } from "./device-event-delivery-types";

export class DeviceEventUnresolvedError extends Error {
  constructor() {
    super("Device security event context is unresolved");
    this.name = "DeviceEventUnresolvedError";
  }
}

export type DeviceEventSource = {
  version: 1;
  eventId: string;
  sessionId: string;
  orgId: string;
  subjectId: string;
  action: DevicePreparationClaim["action"];
  createdAt: string;
  basis: "session-creation" | "legacy-capture";
  subject: { username: string; email: string | null };
  organizationName: string;
  sessionOrigin: { ip: string; userAgent: string | null; createdAt: string };
  provenance: {
    authMethod: string;
    mfaVerified: boolean;
    mfaMethod: string;
    ssoBypass: boolean;
    rootOrgId: string;
    clientId: "vaultix-cli";
    termination: "native" | "canonical-delete";
  };
};

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string[]) =>
  Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
const text = (value: unknown, maximum: number): value is string =>
  typeof value === "string" && value.length <= maximum && !/[\p{Cc}]/u.test(value);
const nullableText = (value: unknown, maximum: number): value is string | null =>
  value === null || text(value, maximum);
const timestamp = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
  Number.isFinite(Date.parse(value));

// The database captures historical context, but its JSON version/size checks do
// not define permission to copy arbitrary fields into audit, email or A2UI.
// Unknown versions/fields stay unresolved; no mutable profile lookup repairs them.
export const prepareDeviceEventSource = (claim: DeviceCapturedEvent): DeviceEventSource => {
  const context = claim.sourceContext;
  const { provenance } = claim;
  if (
    ![claim.id, claim.sessionId, claim.orgId, claim.userId].every(isUuid) ||
    !["issued", "rotated", "reuse", "revoked", "policy-denied"].includes(claim.action) ||
    !(claim.createdAt instanceof Date) ||
    !Number.isFinite(claim.createdAt.getTime()) ||
    !object(context) ||
    !keys(context, ["version", "basis", "subject", "organization", "sessionOrigin"]) ||
    context.version !== 1 ||
    (context.basis !== "session-creation" && context.basis !== "legacy-capture") ||
    !object(context.subject) ||
    !keys(context.subject, ["id", "username", "email", "firstName", "lastName"]) ||
    context.subject.id !== claim.userId ||
    !text(context.subject.username, 255) ||
    !context.subject.username ||
    !nullableText(context.subject.email, 320) ||
    !nullableText(context.subject.firstName, 255) ||
    !nullableText(context.subject.lastName, 255) ||
    !object(context.organization) ||
    !keys(context.organization, ["id", "name"]) ||
    context.organization.id !== claim.orgId ||
    !text(context.organization.name, 255) ||
    !object(context.sessionOrigin) ||
    !keys(context.sessionOrigin, ["ip", "userAgent", "createdAt"]) ||
    !text(context.sessionOrigin.ip, 255) ||
    !nullableText(context.sessionOrigin.userAgent, 255) ||
    !timestamp(context.sessionOrigin.createdAt) ||
    !object(provenance)
  )
    throw new DeviceEventUnresolvedError();
  const canonicalDelete = provenance.termination === "canonical-delete";
  if (
    !keys(provenance, [
      "authMethod",
      "mfaVerified",
      "mfaMethod",
      "ssoBypass",
      "rootOrgId",
      "clientId",
      ...(canonicalDelete ? ["termination", "initiator"] : [])
    ]) ||
    (canonicalDelete && (claim.action !== "revoked" || provenance.initiator !== "unattributed")) ||
    !text(provenance.authMethod, 128) ||
    !provenance.authMethod ||
    typeof provenance.mfaVerified !== "boolean" ||
    !text(provenance.mfaMethod, 128) ||
    typeof provenance.ssoBypass !== "boolean" ||
    typeof provenance.rootOrgId !== "string" ||
    !isUuid(provenance.rootOrgId) ||
    provenance.clientId !== "vaultix-cli"
  )
    throw new DeviceEventUnresolvedError();

  return {
    version: 1,
    eventId: claim.id,
    sessionId: claim.sessionId,
    orgId: claim.orgId,
    subjectId: claim.userId,
    action: claim.action,
    createdAt: claim.createdAt.toISOString(),
    basis: context.basis,
    subject: { username: context.subject.username, email: context.subject.email },
    organizationName: context.organization.name,
    sessionOrigin: {
      ip: context.sessionOrigin.ip,
      userAgent: context.sessionOrigin.userAgent,
      createdAt: new Date(context.sessionOrigin.createdAt).toISOString()
    },
    provenance: {
      authMethod: provenance.authMethod,
      mfaVerified: provenance.mfaVerified,
      mfaMethod: provenance.mfaMethod,
      ssoBypass: provenance.ssoBypass,
      rootOrgId: provenance.rootOrgId,
      clientId: "vaultix-cli",
      termination: canonicalDelete ? "canonical-delete" : "native"
    }
  };
};

// Decode the persisted normalized form through the same capture constraints.
// Exact equality also rejects added nested fields and noncanonical timestamps.
export const parsePreparedDeviceSource = (value: unknown): DeviceEventSource => {
  if (
    !object(value) ||
    !object(value.subject) ||
    !object(value.sessionOrigin) ||
    !object(value.provenance) ||
    typeof value.createdAt !== "string"
  )
    throw new DeviceEventUnresolvedError();
  const canonicalDelete = value.provenance.termination === "canonical-delete";
  const captured = {
    id: value.eventId,
    sessionId: value.sessionId,
    orgId: value.orgId,
    userId: value.subjectId,
    action: value.action,
    createdAt: new Date(value.createdAt),
    sourceContext: {
      version: value.version,
      basis: value.basis,
      subject: {
        id: value.subjectId,
        username: value.subject.username,
        email: value.subject.email,
        firstName: null,
        lastName: null
      },
      organization: { id: value.orgId, name: value.organizationName },
      sessionOrigin: value.sessionOrigin
    },
    provenance: {
      authMethod: value.provenance.authMethod,
      mfaVerified: value.provenance.mfaVerified,
      mfaMethod: value.provenance.mfaMethod,
      ssoBypass: value.provenance.ssoBypass,
      rootOrgId: value.provenance.rootOrgId,
      clientId: value.provenance.clientId,
      ...(canonicalDelete ? { termination: "canonical-delete", initiator: "unattributed" } : {})
    }
  };
  // The capture decoder validates every field; no assertion bypasses that boundary.
  const source = prepareDeviceEventSource(captured as DeviceCapturedEvent);
  if (!isDeepStrictEqual(value, source)) throw new DeviceEventUnresolvedError();
  return source;
};
