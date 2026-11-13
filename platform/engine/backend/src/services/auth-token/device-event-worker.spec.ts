import { randomBytes, randomUUID } from "node:crypto";
import { createServer, Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

import knex from "knex";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { TDbClient } from "@app/db";
import { TableName } from "@app/db/schemas";
import { auditLogDALFactory } from "@app/shippin/services/audit-log/audit-log-dal";
import { auditLogQueueServiceFactory } from "@app/shippin/services/audit-log/audit-log-queue";
import { RecordedOperation, runRecordedOperation } from "@app/lib/recorded-operation";
import { QueueWorkerProfile } from "@app/lib/types";
import { userNotificationDALFactory } from "@app/services/notification/user-notification-dal";
import { smtpServiceFactory } from "@app/services/smtp/smtp-service";

import { deviceEventDeliveryDALFactory } from "./device-event-delivery-dal";
import { deviceEventDispatchFactory } from "./device-event-dispatch";
import { deviceEventPreparationFactory } from "./device-event-preparation";
import { deviceEventRecipientDALFactory } from "./device-event-recipient-dal";
import { deviceEventWorkerFactory } from "./device-event-worker";

const config = vi.hoisted(() => ({
  SITE_URL: "https://vaultix.invalid",
  isCloud: false,
  CLICKHOUSE_AUDIT_LOG_ENABLED: false,
  AUDIT_LOG_STREAMS_ENABLED: false,
  QUEUE_WORKERS_ENABLED: false,
  DISABLE_POSTGRES_AUDIT_LOG_STORAGE: false,
  DISABLE_AUDIT_LOG_GENERATION: false
}));
vi.mock("@app/lib/config/env", () => ({ getConfig: () => config }));
vi.mock("@app/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const waitFor = async (condition: () => Promise<boolean> | boolean) => {
  const until = performance.now() + 15000;
  const poll = async (): Promise<void> => {
    if (await condition()) return;
    if (performance.now() > until) throw new Error("Worker fixture condition timed out");
    await delay(20);
    return poll();
  };
  await poll();
};

describe.sequential("device worker lifecycle with primary PostgreSQL and actual owners", () => {
  let db: TDbClient;
  let observer: TDbClient;
  let orgId: string;
  let userId: string;
  const workers: ReturnType<typeof deviceEventWorkerFactory>[] = [];
  const users: string[] = [];
  const orgs: string[] = [];
  const state = () =>
    db("vx_auth_device_event_deliveries")
      .where({ orgId })
      .select<
        { id: string; destination: string; status: string; attempts: number }[]
      >("id", "destination", "status", "attempts");
  const source = async () => {
    const id = randomUUID();
    const sessionId = randomUUID();
    const provenance = {
      authMethod: "email",
      mfaVerified: false,
      mfaMethod: "",
      ssoBypass: false,
      rootOrgId: orgId,
      clientId: "vaultix-cli"
    };
    await db("vx_auth_sessions").insert({
      id: sessionId,
      userId,
      ip: "192.0.2.19",
      userAgent: "Vaultix worker proof",
      sessionType: "device-v1",
      lastUsed: new Date()
    });
    await db("vx_auth_device_sessions").insert({
      sessionId,
      clientId: "vaultix-cli",
      resource: "https://vaultix.invalid",
      scope: "vaultix:user",
      approval: { sessionId, userId, orgId, ...provenance },
      refreshDigest: randomBytes(32),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000)
    });
    await db("vx_auth_device_session_events").insert({ id, sessionId, userId, orgId, action: "issued", provenance });
    return id;
  };
  const owners = async (connection = db, smtp = smtpServiceFactory({}), afterNotice?: () => Promise<void>) => {
    const deliveries = deviceEventDeliveryDALFactory(connection);
    const recipients = deviceEventRecipientDALFactory(connection);
    const notices = userNotificationDALFactory(connection);
    const audit = await auditLogQueueServiceFactory({
      auditLogDAL: auditLogDALFactory(connection),
      auditLogStreamOutboxService: {
        enqueueForLogs: async () => {
          throw new Error("Streams disabled in worker fixture");
        }
      },
      queueService: { start: () => {} } as never,
      projectDAL: {
        findById: async () => {
          throw new Error("No project lookup");
        }
      },
      featureService: {
        getPlan: async () => {
          throw new Error("Retention is frozen before dispatch");
        }
      },
      clickhouseClient: null,
      keyStore: {} as never
    });
    return {
      deliveries,
      preparation: deviceEventPreparationFactory({ deliveries, recipients, smtp, auditRetentionDays: async () => 365 }),
      dispatch: deviceEventDispatchFactory({
        deliveries,
        recipients,
        smtp,
        audit,
        notifications: {
          persistRecordedNotifications: async (rows, tx) => {
            await notices.persistRecorded(rows, tx);
            await afterNotice?.();
          }
        }
      })
    };
  };
  const worker = (
    dependencies: Awaited<ReturnType<typeof owners>>,
    profile = QueueWorkerProfile.All,
    enabled = true
  ) => {
    const created = deviceEventWorkerFactory({ ...dependencies, enabled, profile });
    workers.push(created);
    return created;
  };
  const cleanup = async () => {
    await Promise.all(workers.splice(0).map((entry) => entry.stop()));
    if (orgs.length) await db(TableName.AuditLog).whereIn("orgId", orgs).delete();
    if (users.length) {
      await db("vx_auth_users").whereIn("id", users).delete();
      await db("vx_auth_device_session_events").whereIn("userId", users).delete();
      users.length = 0;
    }
    if (orgs.length) {
      await db("vx_workspace_organizations").whereIn("id", orgs).delete();
      orgs.length = 0;
    }
  };
  beforeAll(() => {
    if (!process.env.VAULTIX_SESSION_TEST_DATABASE) throw new Error("Use the disposable worker runner");
    const connect = () => {
      const connection = knex({
        client: "pg",
        connection: process.env.VAULTIX_SESSION_TEST_DATABASE,
        pool: { min: 0, max: 1 },
        acquireConnectionTimeout: 2500
      }) as TDbClient;
      connection.replicaNode = () => {
        throw new Error("Worker must use primary");
      };
      return connection;
    };
    db = connect();
    observer = connect();
  });
  beforeEach(async () => {
    await cleanup();
    orgId = randomUUID();
    userId = randomUUID();
    orgs.push(orgId);
    users.push(userId);
    await db("vx_workspace_organizations").insert({ id: orgId, name: "Worker fixture", slug: orgId });
    await db("vx_auth_users").insert({
      id: userId,
      username: userId,
      email: `${userId}@vaultix.invalid`,
      isAccepted: true
    });
  });
  afterAll(async () => {
    await cleanup();
    await db.destroy();
    await observer.destroy();
  });

  const cancellationCases = [
    "claim preparation",
    "prepare page",
    "fail preparation",
    "claim delivery",
    "inspect delivery",
    "settle delivery",
    "fail delivery",
    "commit notification",
    "prune settled",
    "administrator page",
    "subject recipient",
    "administrator recipient"
  ] as const;
  test.each(cancellationCases)("%s cancels pending acquisition without abandoned database work", async (name) => {
    await source();
    const dependencies = await owners();
    const [preparationClaim] = await dependencies.deliveries.claimPreparation(1);
    await dependencies.preparation.prepare(preparationClaim);
    const [deliveryClaim] = await dependencies.deliveries.claimDeliveries(1);
    const before = await state();
    const recipient = deviceEventRecipientDALFactory(db);
    const audience = { orgId, rootOrgId: orgId, subjectId: userId };
    const operations: Record<(typeof cancellationCases)[number], (operation: RecordedOperation) => Promise<unknown>> = {
      "claim preparation": (op) => dependencies.deliveries.claimPreparation(1, op),
      "prepare page": (op) =>
        dependencies.deliveries.preparePage(
          preparationClaim,
          { snapshot: { version: 1 }, cursor: null, deliveries: [] },
          op
        ),
      "fail preparation": (op) => dependencies.deliveries.failPreparation(preparationClaim, "retryable", op),
      "claim delivery": (op) => dependencies.deliveries.claimDeliveries(1, op),
      "inspect delivery": (op) => dependencies.deliveries.inspectDelivery(deliveryClaim, op),
      "settle delivery": (op) => dependencies.deliveries.settleDelivery(deliveryClaim, "delivered", {}, undefined, op),
      "fail delivery": (op) => dependencies.deliveries.failDelivery(deliveryClaim, "retryable", op),
      "commit notification": (op) =>
        dependencies.deliveries.commitNotification(deliveryClaim, async () => "delivered", op),
      "prune settled": (op) => dependencies.deliveries.pruneSettled(365, 100, op),
      "administrator page": (op) => recipient.listAdministrators(audience, op),
      "subject recipient": (op) => recipient.findRecipient({ ...audience, userId, kind: "subject" }, undefined, op),
      "administrator recipient": (op) =>
        recipient.findRecipient({ ...audience, userId, kind: "administrator" }, undefined, op)
    };
    const held = await db.transaction();
    const abort = new AbortController();
    const started = performance.now();
    const timer = setTimeout(() => abort.abort(), 80);
    try {
      await expect(runRecordedOperation(2000, abort.signal, operations[name])).rejects.toThrow();
      expect(performance.now() - started).toBeLessThan(1500);
      await held.raw("SELECT 1");
    } finally {
      clearTimeout(timer);
      await held.commit();
    }
    expect(await state()).toEqual(before);
    await db.raw("SELECT 1");
  });

  test("blocked preparation query is canceled without partial writes and the pool remains usable", async () => {
    const eventId = await source();
    const dependencies = await owners();
    const [claim] = await dependencies.deliveries.claimPreparation(1);
    const lock = await observer.transaction();
    await lock("vx_auth_device_session_events").where({ id: eventId }).forUpdate().first();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 100);
    try {
      await expect(dependencies.preparation.prepare(claim, abort.signal)).rejects.toThrow();
    } finally {
      clearTimeout(timer);
      await lock.commit();
    }
    expect(await state()).toEqual([]);
    expect(
      (await db("vx_auth_device_session_events").where({ id: eventId }).first<{ preparationStatus: string }>())
        ?.preparationStatus
    ).toBe("preparing");
    expect(await dependencies.preparation.prepare(claim)).toBe(true);
  });

  test.each([QueueWorkerProfile.All, QueueWorkerProfile.Standard])(
    "%s worker uses actual preparation, audit and notifications on a one-connection pool",
    async (profile) => {
      const eventId = await source();
      const running = worker(await owners(), profile);
      running.start();
      running.start();
      try {
        await waitFor(async () => {
          const rows = await state();
          return rows.length === 3 && rows.every((row) => ["delivered", "disabled"].includes(row.status));
        });
      } finally {
        await running.stop();
      }
      const rows = await state();
      expect(rows.every((row) => row.attempts === 1)).toBe(true);
      expect(await db(TableName.AuditLog).where({ id: eventId })).toHaveLength(1);
      expect(await db(TableName.UserNotifications).where({ userId })).toHaveLength(1);
      expect(running.status()).toMatchObject({
        enabled: true,
        running: false,
        active: false,
        stopping: false,
        preparedPages: 1,
        handledDeliveries: 3,
        failures: 0
      });
    },
    20000
  );

  test.each([
    { profile: QueueWorkerProfile.All, enabled: false },
    { profile: QueueWorkerProfile.SecretScanning, enabled: true }
  ])(
    "disabled or scanning-only profile leaves source work untouched: $profile/$enabled",
    async ({ profile, enabled }) => {
      const eventId = await source();
      const running = worker(await owners(), profile, enabled);
      running.start();
      await delay(80);
      await running.stop();
      expect(running.status().enabled).toBe(false);
      expect(
        (await db("vx_auth_device_session_events").where({ id: eventId }).first<{ preparationAttempts: number }>())
          ?.preparationAttempts
      ).toBe(0);
      expect(await state()).toEqual([]);
    }
  );

  test("shutdown awaits an active render and prevents page commit, then restart recovers retained preparation", async () => {
    const eventId = await source();
    const dependencies = await owners();
    const waitingEvent = await source();
    const release = deferred();
    const smtp = smtpServiceFactory({ host: "127.0.0.1", port: 1, from: "Vaultix <security@vaultix.invalid>" });
    const prepareMail = vi.fn(async (...args: Parameters<typeof smtp.prepareRecordedMail>) => {
      await release.promise;
      return smtp.prepareRecordedMail(...args);
    });
    const running = worker({
      ...dependencies,
      preparation: deviceEventPreparationFactory({
        deliveries: dependencies.deliveries,
        recipients: deviceEventRecipientDALFactory(db),
        smtp: { prepareRecordedMail: prepareMail },
        auditRetentionDays: async () => 365
      })
    });
    running.start();
    try {
      await waitFor(() => prepareMail.mock.calls.length === 1);
      await delay(1100);
      expect(
        (await db("vx_auth_device_session_events").where({ id: waitingEvent }).first<{ preparationAttempts: number }>())
          ?.preparationAttempts
      ).toBe(0);
      let stopped = false;
      const stopping = running.stop().then(() => {
        stopped = true;
      });
      await delay(50);
      const returnedEarly = stopped;
      const wasStopping = running.status().stopping;
      release.resolve();
      await stopping;
      await waitFor(() => !running.status().active);
      expect(returnedEarly).toBe(false);
      expect(wasStopping).toBe(true);
    } finally {
      release.resolve();
      await running.stop();
    }
    expect(prepareMail).toHaveBeenCalledTimes(1);
    expect(await state()).toEqual([]);
    expect(
      (await db("vx_auth_device_session_events").where({ id: eventId }).first<{ preparationStatus: string }>())
        ?.preparationStatus
    ).toBe("pending");
    await db("vx_auth_device_session_events")
      .where({ id: eventId })
      .update({ preparationNextAt: db.raw("clock_timestamp()") });
    const restarted = worker(await owners());
    restarted.start();
    try {
      await waitFor(async () => (await db("vx_auth_device_event_deliveries").where({ eventId })).length === 3);
    } finally {
      await restarted.stop();
    }
  }, 20000);

  test("independent workers claim disjoint work and drain without extra acquisition or replay", async () => {
    const ids = await Promise.all([source(), source(), source()]);
    const left = worker(await owners(db));
    const right = worker(await owners(observer));
    left.start();
    right.start();
    try {
      await waitFor(async () => {
        const rows = await state();
        return rows.length === 9 && rows.every((row) => ["delivered", "disabled"].includes(row.status));
      });
    } finally {
      await Promise.all([left.stop(), right.stop()]);
    }
    expect((await state()).every((row) => row.attempts === 1)).toBe(true);
    expect(await db(TableName.AuditLog).whereIn("id", ids)).toHaveLength(3);
    expect(await db(TableName.UserNotifications).where({ userId })).toHaveLength(3);
    expect(left.status().preparedPages + right.status().preparedPages).toBe(3);
  }, 25000);

  test("stop cancels claims waiting on a busy pool without starting domain work later", async () => {
    await source();
    const dependencies = await owners();
    const preparation = { prepare: vi.fn(dependencies.preparation.prepare) };
    const running = worker({ ...dependencies, preparation });
    const held = await db.transaction();
    running.start();
    await delay(80);
    const started = performance.now();
    try {
      await running.stop();
      expect(performance.now() - started).toBeLessThan(1500);
    } finally {
      await held.commit();
    }
    expect(preparation.prepare).not.toHaveBeenCalled();
    expect(await state()).toEqual([]);
    expect(running.status()).toMatchObject({ running: false, active: false, stopping: false });
  });

  test("shutdown during notification persistence rolls back the actual notice before retry disposition", async () => {
    await source();
    const release = deferred();
    let inserted = false;
    const dependencies = await owners(db, smtpServiceFactory({}), async () => {
      inserted = true;
      await release.promise;
    });
    const running = worker(dependencies);
    running.start();
    try {
      await waitFor(() => inserted);
      const stopping = running.stop();
      release.resolve();
      await stopping;
      expect(await db(TableName.UserNotifications).where({ userId })).toHaveLength(0);
      expect((await state()).find((row) => row.destination === "notification")?.status).toBe("pending");
      await db.raw("SELECT 1");
    } finally {
      release.resolve();
      await running.stop();
    }
  }, 20000);

  test.each(["greeting", "data"] as const)(
    "shutdown closes actual SMTP during %s and retains its safe disposition",
    async (mode) => {
      await source();
      let reached = false;
      const sockets = new Set<Socket>();
      const smtpServer = createServer((socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        socket.on("error", () => {});
        if (mode === "greeting") {
          reached = true;
          return;
        }
        let input = "";
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
              if (line === ".") reached = true;
            } else if (/^(EHLO|HELO|MAIL FROM|RCPT TO|RSET)/i.test(line)) socket.write("250 OK\r\n");
            else if (line === "DATA") {
              reading = true;
              socket.write("354 send\r\n");
            } else if (line === "QUIT") socket.end("221 bye\r\n");
            else socket.write("500 unsupported\r\n");
            end = input.indexOf("\r\n");
          }
        });
      });
      await new Promise<void>((resolve) => {
        smtpServer.listen(0, "127.0.0.1", resolve);
      });
      const address = smtpServer.address();
      if (!address || typeof address === "string") throw new Error("Missing local SMTP address");
      const running = worker(
        await owners(
          db,
          smtpServiceFactory({ host: "127.0.0.1", port: address.port, from: "Vaultix <security@vaultix.invalid>" })
        )
      );
      running.start();
      try {
        await waitFor(() => reached);
        await running.stop();
        await waitFor(() => sockets.size === 0);
        // Active-send aborts remain uncertain even during greeting. Only a
        // pre-start cancellation is retryable under the existing SMTP contract.
        expect((await state()).find((row) => row.destination === "email")?.status).toBe("unknown");
        const stopped = await state();
        await delay(1100);
        expect(await state()).toEqual(stopped);
        expect(running.status()).toMatchObject({ running: false, active: false, stopping: false });
      } finally {
        for (const socket of sockets) socket.destroy();
        await running.stop();
        await new Promise<void>((resolve) => {
          smtpServer.close(() => resolve());
        });
      }
    },
    20000
  );
});
