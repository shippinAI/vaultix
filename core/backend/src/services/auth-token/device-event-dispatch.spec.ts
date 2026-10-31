import { randomBytes, randomUUID } from "node:crypto";
import { createServer, Socket } from "node:net";

import knex from "knex";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { TDbClient } from "@app/db";
import { TableName } from "@app/db/schemas";
import { auditLogDALFactory } from "@app/ee/services/audit-log/audit-log-dal";
import { auditLogQueueServiceFactory } from "@app/ee/services/audit-log/audit-log-queue";
import { userNotificationDALFactory } from "@app/services/notification/user-notification-dal";
import { smtpServiceFactory } from "@app/services/smtp/smtp-service";

import { deviceEventDeliveryDALFactory } from "./device-event-delivery-dal";
import { DeviceDeliveryClaim, PreparedDeviceDelivery } from "./device-event-delivery-types";
import { deviceEventDispatchFactory } from "./device-event-dispatch";
import { deviceEventPreparationFactory } from "./device-event-preparation";
import { deviceEventRecipientDALFactory } from "./device-event-recipient-dal";

const config = vi.hoisted(() => ({
  SITE_URL: "https://original.vaultix.invalid",
  isCloud: false,
  CLICKHOUSE_AUDIT_LOG_ENABLED: false,
  AUDIT_LOG_STREAMS_ENABLED: true,
  QUEUE_WORKERS_ENABLED: false,
  DISABLE_POSTGRES_AUDIT_LOG_STORAGE: false,
  DISABLE_AUDIT_LOG_GENERATION: false
}));
vi.mock("@app/lib/config/env", () => ({ getConfig: () => config }));
vi.mock("@app/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe.sequential("device dispatch through primary PostgreSQL and actual SMTP", () => {
  let db: TDbClient;
  let orgId: string;
  let subjectId: string;
  let smtp: ReturnType<typeof smtpServiceFactory>;
  const users: string[] = [];
  const orgs: string[] = [];
  const sockets = new Set<Socket>();
  const received: { id: string; recipient: string; data: string }[] = [];
  let reject = false;
  let onData: (() => void) | undefined;
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let input = "";
    let data = "";
    let recipient = "";
    let reading = false;
    socket.setEncoding("utf8");
    socket.write("220 vaultix.invalid ESMTP\r\n");
    socket.on("data", (chunk: string) => {
      input += chunk;
      let end = input.indexOf("\r\n");
      while (end >= 0) {
        const line = input.slice(0, end);
        input = input.slice(end + 2);
        if (reading) {
          if (line === ".") {
            received.push({ id: data.match(/^Message-ID:\s*(.+)$/im)?.[1]?.trim() ?? "", recipient, data });
            reading = false;
            if (onData) onData();
            else socket.write("250 accepted\r\n");
          } else data += `${line}\n`;
        } else if (/^(EHLO|HELO|MAIL FROM|RSET)/i.test(line)) socket.write("250 OK\r\n");
        else if (/^RCPT TO/i.test(line)) {
          recipient = line;
          socket.write(reject ? "550 rejected\r\n" : "250 OK\r\n");
        } else if (line === "DATA") {
          reading = true;
          socket.write("354 send\r\n");
        } else if (line === "QUIT") socket.end("221 bye\r\n");
        else socket.write("500 unsupported\r\n");
        end = input.indexOf("\r\n");
      }
    });
  });
  const newUser = async () => {
    const id = randomUUID();
    await db("users").insert({ id, username: id, email: `${id}@vaultix.invalid`, isAccepted: true });
    users.push(id);
    return id;
  };
  const admin = async () => {
    const userId = await newUser();
    const id = randomUUID();
    await db("memberships").insert({
      id,
      scope: "organization",
      scopeOrgId: orgId,
      actorUserId: userId,
      status: "accepted"
    });
    await db("membership_roles").insert({ membershipId: id, role: "admin" });
    return { userId, id };
  };
  const prepare = async (
    options: { bypass?: boolean; disabled?: boolean; mutate?: (rows: PreparedDeviceDelivery[]) => void } = {}
  ) => {
    const id = randomUUID();
    const sessionId = randomUUID();
    await db("auth_token_sessions").insert({
      id: sessionId,
      userId: subjectId,
      ip: "192.0.2.81",
      userAgent: "Vaultix dispatch proof",
      sessionType: "device-v1",
      lastUsed: new Date()
    });
    const provenance = {
      authMethod: "email",
      mfaVerified: false,
      mfaMethod: "",
      ssoBypass: options.bypass ?? false,
      rootOrgId: orgId,
      clientId: "vaultix-cli"
    };
    await db("vaultix_device_sessions").insert({
      sessionId,
      clientId: "vaultix-cli",
      resource: "https://vaultix.invalid",
      scope: "vaultix:user",
      approval: { sessionId, userId: subjectId, orgId, ...provenance },
      refreshDigest: randomBytes(32),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000)
    });
    await db("vaultix_device_session_events").insert({
      id,
      sessionId,
      userId: subjectId,
      orgId,
      action: "issued",
      provenance
    });
    const dal = deviceEventDeliveryDALFactory(db);
    const [claim] = await dal.claimPreparation(1);
    const preparer = deviceEventPreparationFactory({
      deliveries: {
        preparePage: async (c, data) => {
          options.mutate?.(data.deliveries);
          return dal.preparePage(c, data);
        }
      },
      recipients: deviceEventRecipientDALFactory(db),
      smtp: options.disabled ? smtpServiceFactory({}) : smtp,
      auditRetentionDays: async () => 365
    });
    expect(await preparer.prepare(claim)).toBe(true);
    return dal.claimDeliveries(100);
  };
  const claimOf = (rows: DeviceDeliveryClaim[], destination: DeviceDeliveryClaim["destination"], userId?: string) => {
    const found = rows.find((r) => r.destination === destination && (!userId || r.recipientId === userId));
    if (!found) throw new Error("Missing fixture delivery");
    return found;
  };
  const state = (claim: DeviceDeliveryClaim) =>
    db("vaultix_device_event_deliveries")
      .where({ id: claim.id })
      .first<{ status: string; outcome: Record<string, string> }>();
  const fanout = vi.fn().mockResolvedValue(undefined);
  const dispatcher = async (notificationFailure = false, afterNotification?: () => void) => {
    const audit = await auditLogQueueServiceFactory({
      auditLogDAL: auditLogDALFactory(db),
      auditLogStreamOutboxService: { enqueueForLogs: fanout },
      queueService: { start: () => {} } as never,
      projectDAL: {
        findById: async () => {
          throw new Error("No mutable project lookup");
        }
      },
      licenseService: {
        getPlan: async () => {
          throw new Error("No mutable retention lookup");
        }
      },
      clickhouseClient: null,
      keyStore: {
        streamAdd: () => {
          throw new Error("Cache unavailable");
        }
      } as never
    });
    const notices = userNotificationDALFactory(db);
    return deviceEventDispatchFactory({
      deliveries: deviceEventDeliveryDALFactory(db),
      recipients: deviceEventRecipientDALFactory(db),
      audit,
      smtp,
      notifications: {
        persistRecordedNotifications: async (rows, tx) => {
          await notices.persistRecorded(rows, tx);
          afterNotification?.();
          if (notificationFailure) throw new Error("Rollback after insert");
        }
      }
    });
  };
  const retry = async (claim: DeviceDeliveryClaim) => {
    await db("vaultix_device_event_deliveries")
      .where({ id: claim.id })
      .update({ status: "pending", leaseToken: null, leaseUntil: null, nextAttemptAt: db.raw("clock_timestamp()") });
    return claimOf(await deviceEventDeliveryDALFactory(db).claimDeliveries(100), claim.destination, claim.recipientId);
  };
  const cleanup = async () => {
    if (orgs.length) await db(TableName.AuditLog).whereIn("orgId", orgs).delete();
    if (users.length) {
      await db("users").whereIn("id", users).delete();
      await db("vaultix_device_session_events").whereIn("userId", users).delete();
      users.length = 0;
    }
    if (orgs.length) {
      await db("organizations").whereIn("id", orgs).delete();
      orgs.length = 0;
    }
  };
  beforeAll(async () => {
    if (!process.env.VAULTIX_SESSION_TEST_DATABASE) throw new Error("Use disposable dispatch runner");
    db = knex({
      client: "pg",
      connection: process.env.VAULTIX_SESSION_TEST_DATABASE,
      pool: { min: 0, max: 1 },
      acquireConnectionTimeout: 2000
    }) as TDbClient;
    db.replicaNode = () => {
      throw new Error("Dispatch must use primary");
    };
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing local SMTP port");
    smtp = smtpServiceFactory({
      host: "127.0.0.1",
      port: address.port,
      secure: false,
      ignoreTLS: true,
      from: "Vaultix <security@vaultix.invalid>"
    });
  });
  beforeEach(async () => {
    await cleanup();
    received.length = 0;
    reject = false;
    onData = undefined;
    fanout.mockReset().mockResolvedValue(undefined);
    config.SITE_URL = "https://original.vaultix.invalid";
    config.DISABLE_AUDIT_LOG_GENERATION = false;
    orgId = randomUUID();
    await db("organizations").insert({ id: orgId, name: "Vaultix dispatch", slug: orgId });
    orgs.push(orgId);
    subjectId = await newUser();
  });
  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await db?.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  test("dispatches frozen audit, notification and SMTP content with no cache dependency", async () => {
    const rows = await prepare();
    const worker = await dispatcher();
    config.SITE_URL = "https://changed.vaultix.invalid";
    for (const row of rows) {
      // eslint-disable-next-line no-await-in-loop
      expect(await worker.dispatch(row)).toBe(true);
    }
    expect(
      await db("vaultix_device_event_deliveries")
        .whereIn(
          "id",
          rows.map((r) => r.id)
        )
        .pluck("status")
    ).toEqual(["delivered", "delivered", "delivered"]);
    const audit = await db(TableName.AuditLog).where({ orgId }).first();
    expect(audit).toMatchObject({ eventType: "device-session-issued", actor: "user" });
    const note = await db(TableName.UserNotifications).where({ userId: subjectId }).first();
    expect(note).toMatchObject({ title: "Vaultix CLI session authorized", orgId });
    expect(received).toHaveLength(1);
    expect(received[0].id).toBe(`<${claimOf(rows, "email").id}@vaultix.cloud>`);
    expect(received[0].data).not.toContain("https://changed.vaultix.invalid");
    expect(fanout).toHaveBeenCalledTimes(1);
  });
  test("notification rollback joins delivery acknowledgment on one connection and concurrent replay persists once", async () => {
    const row = claimOf(await prepare(), "notification");
    expect(await (await dispatcher(true)).dispatch(row)).toBe(true);
    expect((await state(row))?.status).toBe("pending");
    expect(await db(TableName.UserNotifications).where({ id: row.id })).toHaveLength(0);
    const next = await retry(row);
    const worker = await dispatcher();
    expect((await Promise.all([worker.dispatch(next), worker.dispatch(next)])).sort()).toEqual([false, true]);
    expect(await db(TableName.UserNotifications).where({ id: row.id })).toHaveLength(1);
    expect((await state(row))?.status).toBe("delivered");
  });
  test("audit fanout failure remains retryable after real persistence and retry does not duplicate", async () => {
    const row = claimOf(await prepare(), "audit");
    const worker = await dispatcher();
    fanout.mockRejectedValueOnce(new Error("Fanout unavailable"));
    await worker.dispatch(row);
    expect((await state(row))?.status).toBe("pending");
    expect(await db(TableName.AuditLog).where({ id: row.eventId })).toHaveLength(1);
    await worker.dispatch(await retry(row));
    expect(await state(row)).toMatchObject({
      status: "delivered",
      outcome: { storage: "persisted", fanout: "enqueued" }
    });
    expect(await db(TableName.AuditLog).where({ id: row.eventId })).toHaveLength(1);
  });
  test("disabled destinations are explicit without claiming delivery", async () => {
    const rows = await prepare({ disabled: true });
    const worker = await dispatcher();
    config.DISABLE_AUDIT_LOG_GENERATION = true;
    await worker.dispatch(claimOf(rows, "audit"));
    await worker.dispatch(claimOf(rows, "email"));
    await worker.dispatch(claimOf(rows, "notification"));
    expect((await state(claimOf(rows, "audit")))?.status).toBe("disabled");
    expect((await state(claimOf(rows, "email")))?.status).toBe("disabled");
    expect((await state(claimOf(rows, "notification")))?.status).toBe("delivered");
    expect(received).toHaveLength(0);
  });
  test("revoked administrator eligibility suppresses both notice and mail", async () => {
    const member = await admin();
    const rows = await prepare({ bypass: true });
    const worker = await dispatcher();
    await db("memberships").where({ id: member.id }).update({ isActive: false });
    for (const kind of ["notification", "email"] as const) {
      const row = claimOf(rows, kind, member.userId); // eslint-disable-next-line no-await-in-loop
      await worker.dispatch(row); // eslint-disable-next-line no-await-in-loop
      expect((await state(row))?.status).toBe("not-applicable");
    }
    expect(received).toHaveLength(0);
    expect(await db(TableName.UserNotifications).where({ userId: member.userId })).toHaveLength(0);
  });
  test("changed email is never a redirect while the locked subject still receives an in-app security notice", async () => {
    const rows = await prepare();
    const worker = await dispatcher();
    await db("users").where({ id: subjectId }).update({ email: "replacement@vaultix.invalid", isLocked: true });
    await worker.dispatch(claimOf(rows, "email"));
    await worker.dispatch(claimOf(rows, "notification"));
    expect((await state(claimOf(rows, "email")))?.status).toBe("not-applicable");
    expect(received).toHaveLength(0);
    expect((await state(claimOf(rows, "notification")))?.status).toBe("delivered");
  });
  test.each(["source-extra", "cross-tenant", "forged-audit"])(
    "invalid retained %s is exhausted before any side effect",
    async (mode) => {
      const rows = await prepare({
        mutate: (items) => {
          const row = items.find((r) => r.destination === "audit")!;
          const payload = row.payload as Record<string, unknown>;
          const source = payload.source as Record<string, unknown>;
          if (mode === "source-extra") source.accessToken = "CANARY-NEVER-DELIVER";
          else if (mode === "cross-tenant") source.orgId = randomUUID();
          else (payload.entry as Record<string, unknown>).actor = { type: "user", metadata: { userId: randomUUID() } };
        }
      });
      const row = claimOf(rows, "audit");
      await (await dispatcher()).dispatch(row);
      expect((await state(row))?.status).toBe("exhausted");
      expect(await db(TableName.AuditLog).where({ orgId })).toHaveLength(0);
      expect(fanout).not.toHaveBeenCalled();
      expect(received).toHaveLength(0);
    }
  );
  test("stale lease cannot cause an external effect or acknowledge another worker", async () => {
    const row = claimOf(await prepare(), "email");
    await db("vaultix_device_event_deliveries").where({ id: row.id }).update({ leaseToken: randomUUID() });
    expect(await (await dispatcher()).dispatch(row)).toBe(false);
    expect((await state(row))?.status).toBe("processing");
    expect(received).toHaveLength(0);
  });
  test.each(["recipient", "notification-link", "mail-date", "mail-extra", "self-consistent-subject"])(
    "retained %s mismatch cannot reinterpret or redirect a security event",
    async (mode) => {
      let destination: DeviceDeliveryClaim["destination"] = "notification";
      if (mode.startsWith("mail-")) destination = "email";
      if (mode === "self-consistent-subject") destination = "audit";
      const rows = await prepare({
        mutate: (items) => {
          const payload = items.find((item) => item.destination === destination)!.payload as Record<string, unknown>;
          if (mode === "recipient") (payload.recipient as Record<string, unknown>).userId = randomUUID();
          if (mode === "notification-link")
            (payload.content as Record<string, unknown>).link = "https://untrusted.vaultix.invalid";
          if (mode === "mail-date") (payload.mail as Record<string, unknown>).createdAt = "2020-01-01T00:00:00.000Z";
          if (mode === "mail-extra") (payload.mail as Record<string, unknown>).accessToken = "CANARY-NEVER-DELIVER";
          if (mode === "self-consistent-subject") {
            const replacement = randomUUID();
            const source = payload.source as Record<string, unknown>;
            source.subjectId = replacement;
            const entry = payload.entry as {
              actor: { metadata: Record<string, unknown> };
              event: { metadata: Record<string, unknown> };
            };
            entry.actor.metadata.userId = replacement;
            entry.event.metadata.subjectId = replacement;
          }
        }
      });
      const row = claimOf(rows, destination);
      await (await dispatcher()).dispatch(row);
      expect((await state(row))?.status).toBe("exhausted");
      expect(received).toHaveLength(0);
      expect(await db(TableName.UserNotifications).where({ userId: subjectId })).toHaveLength(0);
      expect(await db(TableName.AuditLog).where({ orgId })).toHaveLength(0);
      expect(fanout).not.toHaveBeenCalled();
    }
  );
  test("insufficient remaining database lease prevents SMTP from starting", async () => {
    const row = claimOf(await prepare(), "email");
    await db("vaultix_device_event_deliveries")
      .where({ id: row.id })
      .update({ leaseUntil: db.raw("clock_timestamp()+interval '800 milliseconds'") });
    await (await dispatcher()).dispatch(row);
    expect((await state(row))?.status).toBe("pending");
    expect(received).toHaveLength(0);
  });
  test("cancellation after notification insertion rolls back the actual notice and acknowledgment", async () => {
    const row = claimOf(await prepare(), "notification");
    const controller = new AbortController();
    const worker = await dispatcher(false, () => controller.abort());
    await worker.dispatch(row, controller.signal);
    expect((await state(row))?.status).toBe("pending");
    expect(await db(TableName.UserNotifications).where({ id: row.id })).toHaveLength(0);
  });
  test("database expiry after claim suppresses mail without trusting the local wall clock", async () => {
    const rows = await prepare({
      mutate: (items) => {
        for (const item of items) if (item.destination === "email") item.expiresAt = new Date(Date.now() + 1000);
      }
    });
    const row = claimOf(rows, "email");
    await new Promise((resolve) => {
      setTimeout(resolve, 1100);
    });
    await (await dispatcher()).dispatch(row);
    expect((await state(row))?.status).toBe("expired");
    expect(received).toHaveLength(0);
  });
  test("SMTP recipient rejection retries the same frozen delivery identity", async () => {
    const row = claimOf(await prepare(), "email");
    const worker = await dispatcher();
    reject = true;
    await worker.dispatch(row);
    expect((await state(row))?.status).toBe("pending");
    reject = false;
    await worker.dispatch(await retry(row));
    expect((await state(row))?.status).toBe("delivered");
    expect(received.map((r) => r.id)).toEqual([`<${row.id}@vaultix.cloud>`]);
  });
  test("cancellation after SMTP DATA destroys the socket and retains unknown acceptance without automatic retry", async () => {
    const row = claimOf(await prepare(), "email");
    const worker = await dispatcher();
    const controller = new AbortController();
    onData = () => controller.abort();
    await worker.dispatch(row, controller.signal);
    expect((await state(row))?.status).toBe("unknown");
    expect(received).toHaveLength(1);
    await vi.waitFor(() => expect(sockets.size).toBe(0));
    await db("vaultix_device_event_deliveries")
      .where({ id: row.id })
      .update({ nextAttemptAt: db.raw("clock_timestamp()") });
    expect((await deviceEventDeliveryDALFactory(db).claimDeliveries(100)).some((c) => c.id === row.id)).toBe(false);
  });
  test("pre-cancelled dispatch never opens SMTP and remains retryable", async () => {
    const row = claimOf(await prepare(), "email");
    const controller = new AbortController();
    controller.abort();
    await (await dispatcher()).dispatch(row, controller.signal);
    expect((await state(row))?.status).toBe("pending");
    expect(received).toHaveLength(0);
  });
});
