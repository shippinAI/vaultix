import { randomUUID } from "node:crypto";

import knex from "knex";
import { expect, test, vi } from "vitest";

import { TDbClient } from "@app/db";
import { TableName } from "@app/db/schemas";

import { auditLogDALFactory } from "./audit-log-dal";
import { auditLogQueueServiceFactory } from "./audit-log-queue";

vi.mock("@app/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

vi.mock("@app/lib/config/env", async (original) => ({
  ...(await original<typeof import("@app/lib/config/env")>()),
  getConfig: () => ({
    CLICKHOUSE_AUDIT_LOG_ENABLED: false,
    AUDIT_LOG_STREAMS_ENABLED: true,
    QUEUE_WORKERS_ENABLED: false,
    DISABLE_POSTGRES_AUDIT_LOG_STORAGE: false
  })
}));

test("recorded audit retries after actual PostgreSQL persistence without duplicating the event", async () => {
  if (!process.env.VAULTIX_SESSION_TEST_DATABASE || !process.env.VAULTIX_SESSION_TEST_ORG)
    throw new Error("Use disposable delivery-store runner");
  const db = knex({
    client: "pg",
    connection: process.env.VAULTIX_SESSION_TEST_DATABASE,
    pool: { min: 0, max: 1 }
  }) as TDbClient;
  db.replicaNode = () => db;
  const id = randomUUID();
  const orgId = process.env.VAULTIX_SESSION_TEST_ORG;
  const createdAt = new Date().toISOString();
  const data = {
    id,
    orgId,
    createdAt,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    event: { type: "get-secrets", metadata: { environment: "dev", secretPath: "/", numberOfSecrets: 0 } },
    actor: {
      type: "user",
      metadata: { userId: process.env.VAULTIX_SESSION_TEST_USER, username: "delivery-fixture", authMethod: "email" }
    }
  };
  const fanout = vi.fn().mockRejectedValueOnce(new Error("Fanout unavailable")).mockResolvedValue(undefined);
  try {
    const service = await auditLogQueueServiceFactory({
      auditLogDAL: auditLogDALFactory(db),
      auditLogStreamOutboxService: { enqueueForLogs: fanout },
      queueService: {
        start: () => {},
        upsertJobScheduler: () => {
          throw new Error("Workers disabled");
        }
      } as never,
      projectDAL: {
        findById: async () => {
          throw new Error("Pinned source must not be re-resolved");
        }
      },
      licenseService: {
        getPlan: async () => {
          throw new Error("Pinned source must not be re-resolved");
        }
      },
      clickhouseClient: null,
      keyStore: {
        streamAdd: () => {
          throw new Error("Cache unavailable");
        }
      } as never
    });
    await expect(service.persistRecorded(data as never)).rejects.toThrow("Fanout unavailable");
    expect(await db(TableName.AuditLog).where({ id }).count("id AS count")).toEqual([{ count: "1" }]);
    await expect(service.persistRecorded(data as never)).resolves.toEqual({ storage: "persisted", fanout: "enqueued" });
    const rows = await db(TableName.AuditLog).where({ id });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      orgId,
      eventType: "get-secrets",
      actor: "user",
      createdAt: new Date(createdAt),
      updatedAt: new Date(createdAt)
    });
    expect(fanout.mock.calls[1]).toEqual(fanout.mock.calls[0]);
    expect(fanout.mock.calls[1][0]).toEqual(expect.arrayContaining([expect.objectContaining({ id })]));
  } finally {
    await db(TableName.AuditLog).where({ id }).delete();
    await db.destroy();
  }
}, 30000);
