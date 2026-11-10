import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { createClient } from "@clickhouse/client";
import knex from "knex";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { TDbClient } from "@app/db";
import { TableName, TAuditLogs } from "@app/db/schemas";
import { withRecordedTransaction } from "@app/lib/knex/recorded-transaction";
import { runRecordedOperation } from "@app/lib/recorded-operation";
import { projectDALFactory } from "@app/services/project/project-dal";

import { auditLogStreamDALFactory } from "../audit-log-stream/audit-log-stream-dal";
import { auditLogStreamOutboxDALFactory } from "../audit-log-stream-outbox/audit-log-stream-outbox-dal";
import { auditLogStreamOutboxServiceFactory } from "../audit-log-stream-outbox/audit-log-stream-outbox-service";
import { TAuditLogStreamOutboxRow } from "../audit-log-stream-outbox/audit-log-stream-outbox-types";
import { auditLogDALFactory } from "./audit-log-dal";
import { auditLogQueueServiceFactory } from "./audit-log-queue";
import { TAuditLogStreamEntry } from "./audit-log-types";

const config = vi.hoisted(() => ({
  CLICKHOUSE_AUDIT_LOG_ENABLED: false,
  CLICKHOUSE_AUDIT_LOG_TABLE_NAME: "audit_proof",
  AUDIT_LOG_STREAMS_ENABLED: true,
  QUEUE_WORKERS_ENABLED: false,
  DISABLE_POSTGRES_AUDIT_LOG_STORAGE: false,
  DISABLE_AUDIT_LOG_GENERATION: false
}));
vi.mock("@app/lib/config/env", () => ({ getConfig: () => config }));
vi.mock("@app/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe.sequential("recorded audit cancellation and durable fanout in PostgreSQL", () => {
  let db: TDbClient;
  let observer: TDbClient;
  let orgId: string;
  let foreignOrg: string;
  const organizations: string[] = [];
  const poolStats = () => (db.client as { pool: { numUsed: () => number; numPendingAcquires: () => number } }).pool;
  let log: TAuditLogs;
  const queue = vi
    .fn<(name: unknown, job: unknown, data: { streamId: string }) => Promise<void>>()
    .mockResolvedValue(undefined);
  const cache = vi.fn().mockRejectedValue(new Error("Cache unavailable"));
  const cleanup = async () => {
    if (!organizations.length) return;
    await db<TAuditLogStreamOutboxRow>(TableName.AuditLogStreamOutbox).whereIn("orgId", organizations).delete();
    await db(TableName.AuditLog).whereIn("orgId", organizations).delete();
    await db(TableName.AuditLogStream).whereIn("orgId", organizations).delete();
    await db("vx_workspace_organizations").whereIn("id", organizations).delete();
    organizations.length = 0;
  };
  beforeAll(() => {
    if (!process.env.VAULTIX_SESSION_TEST_DATABASE) throw new Error("Use disposable recorded-audit runner");
    const make = () =>
      knex({
        client: "pg",
        connection: process.env.VAULTIX_SESSION_TEST_DATABASE,
        pool: { min: 0, max: 1 },
        acquireConnectionTimeout: 2500
      }) as TDbClient;
    db = make();
    observer = make();
    db.replicaNode = () => {
      throw new Error("Recorded acceptance must use primary");
    };
  });
  beforeEach(async () => {
    await cleanup();
    queue.mockClear();
    cache.mockReset().mockRejectedValue(new Error("Cache unavailable"));
    config.CLICKHOUSE_AUDIT_LOG_ENABLED = false;
    config.AUDIT_LOG_STREAMS_ENABLED = true;
    orgId = randomUUID();
    foreignOrg = randomUUID();
    organizations.push(orgId, foreignOrg);
    await db("vx_workspace_organizations").insert(
      organizations.map((id) => ({ id, name: "Recorded audit proof", slug: id }))
    );
    log = {
      id: randomUUID(),
      orgId,
      actor: "user",
      actorMetadata: { userId: process.env.VAULTIX_SESSION_TEST_USER, username: "audit-proof", authMethod: "email" },
      eventType: "get-secrets",
      eventMetadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000)
    } as TAuditLogs;
  });
  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await db?.destroy();
      await observer?.destroy();
    }
  });
  const entry = () =>
    ({
      id: log.id,
      orgId,
      createdAt: log.createdAt.toISOString(),
      expiresAt: log.expiresAt!.toISOString(),
      actor: { type: log.actor, metadata: log.actorMetadata },
      event: { type: log.eventType, metadata: log.eventMetadata }
    }) as TAuditLogStreamEntry;
  const streams = async (count: number, org = orgId, products?: string[]) => {
    const rows = Array.from({ length: count }, () => ({
      id: randomUUID(),
      orgId: org,
      provider: "custom",
      encryptedCredentials: Buffer.from("fixture"),
      streamMode: "batch",
      filters: products ? { products } : null
    }));
    await db(TableName.AuditLogStream).insert(rows);
    return rows.map((row) => row.id);
  };
  const outbox = (dal = auditLogStreamOutboxDALFactory(db)) =>
    auditLogStreamOutboxServiceFactory({
      auditLogStreamOutboxDAL: dal,
      auditLogStreamDAL: auditLogStreamDALFactory(db),
      projectDAL: projectDALFactory(db),
      kmsService: {} as never,
      keyStore: { setItemWithExpiryNX: cache },
      queueService: { queue } as never
    });
  const audit = (fanout = outbox(), clickhouseClient: unknown = null) =>
    auditLogQueueServiceFactory({
      auditLogDAL: auditLogDALFactory(db),
      auditLogStreamOutboxService: fanout,
      queueService: { start: () => {} } as never,
      projectDAL: {} as never,
      licenseService: {} as never,
      clickhouseClient: clickhouseClient as never,
      keyStore: {} as never
    });

  test("pre-cancellation starts no database transaction", async () => {
    const controller = new AbortController();
    controller.abort();
    const work = vi.fn();
    await expect(
      runRecordedOperation(1000, controller.signal, (op) => withRecordedTransaction(db, op, work))
    ).rejects.toThrow();
    expect(work).not.toHaveBeenCalled();
    expect(poolStats().numUsed()).toBe(0);
  });
  test("abandoned acquisition never starts work when shared-pool connection creation finishes later", async () => {
    const temporary = knex({
      client: "pg",
      connection: process.env.VAULTIX_SESSION_TEST_DATABASE,
      pool: {
        min: 0,
        max: 1,
        afterCreate: (connection: unknown, done: (error: Error | null, connection: unknown) => void) => {
          setTimeout(() => done(null, connection), 300);
        }
      }
    });
    const work = vi.fn();
    try {
      await expect(
        runRecordedOperation(100, undefined, (op) => withRecordedTransaction(temporary, op, work))
      ).rejects.toThrow();
      expect(work).not.toHaveBeenCalled();
      await temporary.raw("SELECT 1");
      expect(work).not.toHaveBeenCalled();
    } finally {
      await temporary.destroy();
    }
  });
  test.each(["signal", "deadline"])(
    "%s cancels pending acquisition without consuming or changing the held connection",
    async (mode) => {
      const held = await db.transaction();
      const controller = new AbortController();
      const work = vi.fn();
      const timer = mode === "signal" ? setTimeout(() => controller.abort(), 150) : undefined;
      const start = performance.now();
      try {
        await expect(
          runRecordedOperation(mode === "signal" ? 2000 : 150, controller.signal, (op) =>
            withRecordedTransaction(db, op, work)
          )
        ).rejects.toThrow();
        expect(performance.now() - start).toBeLessThan(1500);
        expect(work).not.toHaveBeenCalled();
        expect(poolStats().numUsed()).toBe(1);
        expect(poolStats().numPendingAcquires()).toBe(0);
        expect((await held.raw<{ rows: { value: number }[] }>("SELECT 7 as value")).rows[0].value).toBe(7);
      } finally {
        clearTimeout(timer);
        await held.rollback();
      }
      await expect(
        runRecordedOperation(2000, undefined, (op) => withRecordedTransaction(db, op, (tx) => tx.raw("SELECT 1")))
      ).resolves.toBeDefined();
    }
  );
  test.each(["signal", "deadline"])(
    "%s stops a real blocked query, rolls back its earlier write and allows pool reuse",
    async (mode) => {
      const lock = await observer.transaction();
      await lock("organizations").where({ id: foreignOrg }).forUpdate();
      const controller = new AbortController();
      const timer = mode === "signal" ? setTimeout(() => controller.abort(), 250) : undefined;
      let pid: number | undefined;
      try {
        await expect(
          runRecordedOperation(mode === "signal" ? 1000 : 250, controller.signal, (op) =>
            withRecordedTransaction(db, op, async (tx) => {
              pid = (await tx.raw<{ rows: { pid: number }[] }>("SELECT pg_backend_pid() as pid")).rows[0].pid;
              await tx(TableName.AuditLog).insert(log);
              await tx("vx_workspace_organizations").where({ id: foreignOrg }).update({ name: "must roll back" });
            })
          )
        ).rejects.toThrow();
      } finally {
        clearTimeout(timer);
        await lock.rollback();
      }
      expect(await db(TableName.AuditLog).where({ id: log.id })).toHaveLength(0);
      expect((await db<{ id: string; name: string }>("organizations").where({ id: foreignOrg }).first())?.name).toBe(
        "Recorded audit proof"
      );
      const remaining = await observer.raw<{ rows: { state: string; xact_start: Date | null }[] }>(
        "SELECT state, xact_start FROM pg_stat_activity WHERE pid = ?",
        [pid]
      );
      if (mode === "signal") expect(remaining.rows).toHaveLength(0);
      else expect(remaining.rows.every((row) => row.state === "idle" && row.xact_start === null)).toBe(true);
      expect(
        (await db.raw<{ rows: { statement_timeout: string }[] }>("SHOW statement_timeout")).rows[0].statement_timeout
      ).toBe("0");
    }
  );
  test("successful transaction restores statement settings and cancellation after insertion rolls back", async () => {
    const before = (await db.raw<{ rows: { statement_timeout: string }[] }>("SHOW statement_timeout")).rows[0]
      .statement_timeout;
    await runRecordedOperation(2000, undefined, (op) =>
      withRecordedTransaction(db, op, async (tx) => {
        expect(
          (await tx.raw<{ rows: { statement_timeout: string }[] }>("SHOW statement_timeout")).rows[0].statement_timeout
        ).not.toBe("0");
      })
    );
    expect(
      (await db.raw<{ rows: { statement_timeout: string }[] }>("SHOW statement_timeout")).rows[0].statement_timeout
    ).toBe(before);
    const controller = new AbortController();
    await expect(
      runRecordedOperation(2000, controller.signal, (op) =>
        withRecordedTransaction(db, op, async (tx) => {
          await tx(TableName.AuditLog).insert(log);
          controller.abort();
        })
      )
    ).rejects.toThrow();
    expect(await db(TableName.AuditLog).where({ id: log.id })).toHaveLength(0);
  });
  test("actual audit and paged fanout preserve filtering, tenant isolation and identity with cache unavailable", async () => {
    const expected = [...(await streams(105)), ...(await streams(3, orgId, ["organization"]))];
    await streams(4, orgId, ["secret-manager"]);
    await streams(2, foreignOrg);
    const owner = await audit();
    for (let n = 0; n < 2; n += 1) {
      // eslint-disable-next-line no-await-in-loop
      expect(await runRecordedOperation(5000, undefined, (op) => owner.persistRecorded(entry(), op))).toEqual({
        storage: "persisted",
        fanout: "enqueued"
      });
    }
    expect(await db(TableName.AuditLog).where({ id: log.id })).toHaveLength(1);
    const accepted = await db<TAuditLogStreamOutboxRow>(TableName.AuditLogStreamOutbox).where({ auditLogId: log.id });
    expect(accepted.map((row) => row.streamId).sort()).toEqual(expected.sort());
    expect(accepted.every((row) => row.orgId === orgId && row.payload.id === log.id && row.status === "pending")).toBe(
      true
    );
    expect(cache).not.toHaveBeenCalled();
    expect(queue).not.toHaveBeenCalled();
    cache.mockResolvedValue(true);
    await outbox().sweepStaleClaims();
    expect(new Set(queue.mock.calls.map((call) => call[2].streamId))).toEqual(new Set(expected));
  });
  test("failed later page retains committed progress and retry skips accepted pairs without duplicates", async () => {
    const expected = await streams(205);
    const dal = auditLogStreamOutboxDALFactory(db);
    let pages = 0;
    const failed = outbox({
      ...dal,
      batchInsert: async (rows, tx) => {
        pages += 1;
        await dal.batchInsert(rows, tx);
        if (pages === 2) throw new Error("Page failure after insertion");
      }
    });
    await expect(runRecordedOperation(5000, undefined, (op) => failed.enqueueForLogs([log], op))).rejects.toThrow();
    expect(
      await db<TAuditLogStreamOutboxRow>(TableName.AuditLogStreamOutbox).where({ auditLogId: log.id })
    ).toHaveLength(100);
    const sizes: number[] = [];
    const retry = outbox({
      ...dal,
      batchInsert: async (rows, tx) => {
        sizes.push(rows.length);
        await dal.batchInsert(rows, tx);
      }
    });
    await runRecordedOperation(5000, undefined, (op) => retry.enqueueForLogs([log], op));
    expect(sizes).toEqual([100, 5]);
    expect(
      (await db<TAuditLogStreamOutboxRow>(TableName.AuditLogStreamOutbox).where({ auditLogId: log.id }))
        .map((row) => row.streamId)
        .sort()
    ).toEqual(expected.sort());
  });
  test("cancellation rolls back an outbox page and never starts a later page", async () => {
    await streams(105);
    const controller = new AbortController();
    const dal = auditLogStreamOutboxDALFactory(db);
    let pages = 0;
    const owner = outbox({
      ...dal,
      batchInsert: async (rows, tx) => {
        pages += 1;
        await dal.batchInsert(rows, tx);
        controller.abort();
      }
    });
    await expect(
      runRecordedOperation(5000, controller.signal, (op) => owner.enqueueForLogs([log], op))
    ).rejects.toThrow();
    expect(pages).toBe(1);
    expect(
      await db<TAuditLogStreamOutboxRow>(TableName.AuditLogStreamOutbox).where({ auditLogId: log.id })
    ).toHaveLength(0);
  });
  test("independent one-connection workers accept the same fanout without duplicate pairs", async () => {
    const expected = await streams(205);
    await Promise.all([
      runRecordedOperation(5000, undefined, (op) => outbox().enqueueForLogs([log], op)),
      runRecordedOperation(5000, undefined, (op) =>
        outbox(auditLogStreamOutboxDALFactory(observer)).enqueueForLogs([log], op)
      )
    ]);
    const accepted = await db<TAuditLogStreamOutboxRow>(TableName.AuditLogStreamOutbox).where({ auditLogId: log.id });
    expect(accepted.map((row) => row.streamId).sort()).toEqual(expected.sort());
  });
  test("project filters use the same transaction and unresolved project does not match a product", async () => {
    const [project] = await db(TableName.Project)
      .insert({
        orgId,
        name: "Audit project",
        slug: randomUUID(),
        type: "secret-manager"
      })
      .returning("id");
    const projectId = project.id;
    const any = await streams(1);
    const matching = await streams(1, orgId, ["secret-manager"]);
    await streams(1, orgId, ["organization"]);
    await runRecordedOperation(3000, undefined, (op) => outbox().enqueueForLogs([{ ...log, projectId }], op));
    expect(
      (await db<TAuditLogStreamOutboxRow>(TableName.AuditLogStreamOutbox).where({ auditLogId: log.id }))
        .map((row) => row.streamId)
        .sort()
    ).toEqual([...any, ...matching].sort());
    const nextId = randomUUID();
    await runRecordedOperation(3000, undefined, (op) =>
      outbox().enqueueForLogs([{ ...log, id: nextId, projectId: randomUUID() }], op)
    );
    expect(
      (await db<TAuditLogStreamOutboxRow>(TableName.AuditLogStreamOutbox).where({ auditLogId: nextId })).map(
        (row) => row.streamId
      )
    ).toEqual(any);
  });
  test("actual ClickHouse HTTP transport closes after cancellation following request data", async () => {
    config.CLICKHOUSE_AUDIT_LOG_ENABLED = true;
    const controller = new AbortController();
    const fanout = vi.fn();
    let received = false;
    let closed = false;
    let notifyClose = () => {};
    const socketClosed = new Promise<void>((resolve) => {
      notifyClose = resolve;
    });
    const server = createServer((request) => {
      request.socket.once("close", () => {
        closed = true;
        notifyClose();
      });
      request.resume();
      request.once("end", () => {
        received = true;
        controller.abort();
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test HTTP listener");
    const client = createClient({
      url: `http://127.0.0.1:${address.port}`,
      keep_alive: { enabled: false },
      request_timeout: 5000
    });
    try {
      const owner = await audit({ enqueueForLogs: fanout } as never, client);
      await expect(
        runRecordedOperation(3000, controller.signal, (op) => owner.persistRecorded(entry(), op))
      ).rejects.toThrow();
      expect(received).toBe(true);
      await socketClosed;
      expect(closed).toBe(true);
      expect(fanout).not.toHaveBeenCalled();
    } finally {
      await client.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });
  test("ClickHouse cancellation is passed to the client and cannot acknowledge unfinished storage", async () => {
    config.CLICKHOUSE_AUDIT_LOG_ENABLED = true;
    const fanout = vi.fn();
    let observed: AbortSignal | undefined;
    let settled = false;
    const owner = await audit({ enqueueForLogs: fanout } as never, {
      insert: ({ abort_signal }: { abort_signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          observed = abort_signal;
          abort_signal.addEventListener(
            "abort",
            () => {
              settled = true;
              reject(new Error("Request aborted"));
            },
            { once: true }
          );
        })
    });
    await expect(runRecordedOperation(150, undefined, (op) => owner.persistRecorded(entry(), op))).rejects.toThrow();
    expect(observed?.aborted).toBe(true);
    expect(settled).toBe(true);
    expect(fanout).not.toHaveBeenCalled();
  });
});
