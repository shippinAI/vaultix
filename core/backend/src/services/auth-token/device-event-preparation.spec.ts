import { randomBytes, randomUUID } from "node:crypto";

import knex from "knex";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { TDbClient } from "@app/db";
import { EventType, TAuditLogStreamEntry } from "@app/ee/services/audit-log/audit-log-types";
import { ActorType } from "@app/services/auth/auth-type";
import { PreparedRecordedMail } from "@app/services/smtp/smtp-recorded-payload";
import { smtpServiceFactory } from "@app/services/smtp/smtp-service";

import { deviceEventDeliveryDALFactory } from "./device-event-delivery-dal";
import { DeviceDeliveryDestination, DevicePreparationClaim } from "./device-event-delivery-types";
import { deviceAuditEntry, deviceEventPreparationFactory } from "./device-event-preparation";
import { deviceEventRecipientDALFactory } from "./device-event-recipient-dal";
import { DeviceEventSource, prepareDeviceEventSource } from "./device-event-source";

type StoredDelivery = {
  id: string;
  eventId: string;
  destination: DeviceDeliveryDestination;
  recipientId: string;
  expiresAt: Date;
  payload: {
    source: DeviceEventSource;
    mail?: PreparedRecordedMail | null;
    mailStatus?: string;
    entry?: TAuditLogStreamEntry;
    content?: { title: string; body: string; type: string; link: string | null };
  };
};

const config = vi.hoisted(() => ({ SITE_URL: "https://original.vaultix.invalid", isCloud: false }));
vi.mock("@app/lib/config/env", () => ({ getConfig: () => config }));
vi.mock("@app/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe.sequential("device event preparation through the real store and mail renderer", () => {
  let db: TDbClient;
  let orgId: string;
  let subjectId: string;
  const users: string[] = [];
  const organizations: string[] = [];
  const storedDeliveries = () => db<StoredDelivery>("vaultix_device_event_deliveries");
  const newUser = async (email = true) => {
    const id = randomUUID();
    await db("vx_auth_users").insert({
      id,
      username: id,
      email: email ? `${id}@vaultix.invalid` : null,
      isAccepted: true
    });
    users.push(id);
    return id;
  };
  const administrator = async (email = true) => {
    const id = await newUser(email);
    const membershipId = randomUUID();
    await db("vx_workspace_memberships").insert({
      id: membershipId,
      scope: "organization",
      scopeOrgId: orgId,
      actorUserId: id,
      status: "accepted"
    });
    await db("vx_workspace_membership_roles").insert({ membershipId, role: "admin" });
    return id;
  };
  const source = async (action: DevicePreparationClaim["action"] = "issued", bypass = false) => {
    const sessionId = randomUUID();
    const id = randomUUID();
    await db("vx_auth_sessions").insert({
      id: sessionId,
      userId: subjectId,
      ip: "192.0.2.71",
      userAgent: "Vaultix CLI proof",
      sessionType: "device-v1",
      lastUsed: new Date()
    });
    const provenance = {
      authMethod: "email",
      mfaVerified: false,
      mfaMethod: "",
      ssoBypass: bypass,
      rootOrgId: orgId,
      clientId: "vaultix-cli"
    };
    await db("vx_auth_device_sessions").insert({
      sessionId,
      clientId: "vaultix-cli",
      resource: "https://vaultix.invalid",
      scope: "vaultix:user",
      approval: { sessionId, userId: subjectId, orgId, ...provenance },
      refreshDigest: randomBytes(32),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000)
    });
    await db("vx_auth_device_session_events").insert({ id, sessionId, userId: subjectId, orgId, action, provenance });
    return { id, sessionId };
  };
  const owner = (enabled = true, retention = 365) =>
    deviceEventPreparationFactory({
      deliveries: deviceEventDeliveryDALFactory(db),
      recipients: deviceEventRecipientDALFactory(db),
      smtp: smtpServiceFactory(
        enabled ? { host: "127.0.0.1", port: 1, from: "Vaultix <security@vaultix.invalid>" } : {}
      ),
      auditRetentionDays: async () => retention
    });
  const cleanup = async () => {
    if (users.length) {
      await db("vx_auth_users").whereIn("id", users).delete();
      await db("vx_auth_device_session_events").whereIn("userId", users).delete();
      users.length = 0;
    }
    if (organizations.length) {
      await db("vx_workspace_organizations").whereIn("id", organizations).delete();
      organizations.length = 0;
    }
  };
  beforeAll(() => {
    if (!process.env.VAULTIX_SESSION_TEST_DATABASE) throw new Error("Use disposable device preparation runner");
    db = knex({
      client: "pg",
      connection: process.env.VAULTIX_SESSION_TEST_DATABASE,
      pool: { min: 0, max: 1 },
      acquireConnectionTimeout: 2000
    }) as TDbClient;
    db.replicaNode = () => {
      throw new Error("Preparation must use primary database");
    };
  });
  beforeEach(async () => {
    await cleanup();
    config.SITE_URL = "https://original.vaultix.invalid";
    orgId = randomUUID();
    await db("vx_workspace_organizations").insert({ id: orgId, name: "Vaultix preparation", slug: orgId });
    organizations.push(orgId);
    subjectId = await newUser();
  });
  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await db?.destroy();
    }
  });

  test("prepares every paged administrator once and preserves the first page after profile and renderer changes", async () => {
    for (let i = 0; i < 43; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await administrator(i !== 0);
    }
    const event = await source("issued", true);
    const dal = deviceEventDeliveryDALFactory(db);
    const [first] = await dal.claimPreparation(1);
    expect(await owner().prepare(first)).toBe(true);
    const initial = await storedDeliveries().where({ eventId: event.id }).orderBy("id");
    expect(initial).toHaveLength(83);
    expect(
      initial.find((row) => row.destination === "notification" && row.recipientId === subjectId)?.payload.content
    ).toEqual({
      type: "login-from-new-device",
      title: "Vaultix CLI session authorized",
      body: "A Vaultix CLI session was authorized for your account. Review your sessions if you did not authorize it.",
      link: null
    });
    expect(initial.find((row) => row.destination === "audit")?.payload.entry?.event.type).toBe("device-session-issued");
    expect(await dal.claimDeliveries()).toEqual([]);
    const rendered = initial.find(
      (row) => row.destination === "email" && row.recipientId !== subjectId && row.payload.mail
    );
    if (!rendered?.payload.mail) throw new Error("Expected rendered administrator mail");
    expect(rendered.payload.mail.html).toContain("https://original.vaultix.invalid/organizations/");
    config.SITE_URL = "https://changed.vaultix.invalid";
    await db("vx_auth_users")
      .where({ id: subjectId })
      .update({ email: "changed@vaultix.invalid", username: "Changed profile" });
    const [second] = await dal.claimPreparation(1);
    expect(await owner(true, 30).prepare(second)).toBe(true);
    const final = await storedDeliveries().where({ eventId: event.id });
    expect(final).toHaveLength(89);
    expect(new Set(final.map((row) => `${row.destination}:${row.recipientId}`)).size).toBe(89);
    expect(
      await storedDeliveries()
        .whereIn(
          "id",
          initial.map((row) => row.id)
        )
        .orderBy("id")
    ).toEqual(initial);
    const audit = final.find((row) => row.destination === "audit");
    if (!audit) throw new Error("Expected audit delivery");
    expect(audit.expiresAt.getTime() - first.createdAt.getTime()).toBe(365 * 86400000);
    const noEmail = final.find((row) => row.destination === "email" && row.payload.mailStatus === "not-applicable");
    expect(noEmail).toBeDefined();
    expect(final.some((row) => row.destination === "notification" && row.recipientId === noEmail?.recipientId)).toBe(
      true
    );
    expect(await dal.claimDeliveries(100)).toHaveLength(89);
  });

  test("disabled SMTP is explicit while the subject notification and audit are still prepared", async () => {
    await source();
    const [claim] = await deviceEventDeliveryDALFactory(db).claimPreparation(1);
    expect(await owner(false).prepare(claim)).toBe(true);
    const rows = await storedDeliveries().where({ eventId: claim.id });
    expect(rows.map((row) => row.destination).sort()).toEqual(["audit", "email", "notification"]);
    expect(rows.find((row) => row.destination === "email")?.payload).toMatchObject({
      mailStatus: "disabled",
      mail: null
    });
  });

  test.each(["rotated", "reuse", "revoked", "policy-denied"] as const)(
    "%s records its own audit action without a new-login notice",
    async (action) => {
      await source(action, true);
      const [claim] = await deviceEventDeliveryDALFactory(db).claimPreparation(1);
      expect(await owner().prepare(claim)).toBe(true);
      const rows = await storedDeliveries().where({ eventId: claim.id });
      expect(rows).toHaveLength(1);
      expect(rows[0].destination).toBe("audit");
      const audit = deviceAuditEntry(rows[0].payload.source, rows[0].expiresAt);
      expect(rows[0].payload.entry).toEqual(audit);
      expect(audit.event.type).toBe(`device-session-${action}`);
      expect(audit.actor.type).toBe(action === "rotated" ? ActorType.USER : ActorType.UNKNOWN_USER);
      expect(audit).not.toHaveProperty("ipAddress");
      expect(audit).not.toHaveProperty("userAgent");
    }
  );

  test("canonical account deletion preserves context without inventing a deletion actor", async () => {
    const event = await source();
    await db("vx_auth_users").where({ id: subjectId }).delete();
    const claims = await deviceEventDeliveryDALFactory(db).claimPreparation(10);
    const deletion = claims.find((claim) => claim.action === "revoked");
    expect(deletion).toBeDefined();
    if (!deletion) throw new Error("Expected canonical deletion event");
    expect(await owner().prepare(deletion)).toBe(true);
    const saved = await storedDeliveries().where({ eventId: deletion.id }).first();
    if (!saved) throw new Error("Expected canonical deletion audit");
    const audit = deviceAuditEntry(saved.payload.source, saved.expiresAt);
    expect(audit.actor).toEqual({ type: ActorType.UNKNOWN_USER, metadata: {} });
    expect(audit.event).toMatchObject({
      type: EventType.DEVICE_SESSION_REVOKED,
      metadata: {
        subjectId,
        sessionId: event.sessionId,
        termination: "canonical-delete",
        sessionOrigin: { ip: "192.0.2.71" }
      }
    });
  });

  test("missing, extra, credential-bearing and cross-tenant source data are unresolved before any rendering or page commit", async () => {
    await source();
    const [claim] = await deviceEventDeliveryDALFactory(db).claimPreparation(1);
    const valid = prepareDeviceEventSource(claim);
    expect(valid.subject.email).toBe(`${subjectId}@vaultix.invalid`);
    const context = claim.sourceContext;
    if (!context) throw new Error("Expected captured source");
    const invalid = [
      { ...claim, sourceContext: null },
      { ...claim, orgId: randomUUID() },
      { ...claim, userId: randomUUID() },
      { ...claim, provenance: { ...claim.provenance, refreshDigest: "source-canary" } },
      { ...claim, sourceContext: { ...context, password: "source-canary" } },
      { ...claim, sourceContext: { ...context, basis: ["session-creation"] } },
      { ...claim, preparationCursor: randomUUID(), preparationSnapshot: null },
      { ...claim, provenance: { ...claim.provenance, clientId: "foreign-client" } }
    ];
    for (const candidate of invalid) {
      // eslint-disable-next-line no-await-in-loop
      await expect(owner().prepare(candidate)).rejects.toThrow("context is unresolved");
    }
    expect(await db("vx_auth_device_event_deliveries").where({ eventId: claim.id })).toEqual([]);
  });

  test("a lost preparation lease cannot commit rendered content", async () => {
    await source();
    const [claim] = await deviceEventDeliveryDALFactory(db).claimPreparation(1);
    await db("vx_auth_device_session_events")
      .where({ id: claim.id })
      .update({ preparationLeaseUntil: db.raw("clock_timestamp()-interval '1 second'") });
    expect(await owner().prepare(claim)).toBe(false);
    expect(await db("vx_auth_device_event_deliveries").where({ eventId: claim.id })).toEqual([]);
  });
});
