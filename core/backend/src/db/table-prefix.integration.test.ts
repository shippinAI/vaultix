import { randomUUID } from "node:crypto";
import path from "node:path";

import knex, { Knex } from "knex";

import { createPrefixedPgClient } from "./prefixed-pg-client";
import { TableName } from "./schemas/models";

const connectionString = process.env.DB_CONNECTION_URI;
const describeIf = connectionString ? describe : describe.skip;

// A KMS migration refuses to run unless the instance has a software root key.
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
}

const openDb = (prefix: string): Knex =>
  knex({
    client: createPrefixedPgClient(prefix),
    connection: connectionString,
    pool: { min: 0, max: 4 },
    migrations: {
      directory: path.join(__dirname, "migrations"),
      tableName: "vaultix_migrations",
      loadExtensions: [".ts"]
    }
  });

const seedTenant = async (db: Knex, label: string) => {
  const orgId = randomUUID();
  const projectId = randomUUID();
  const envId = randomUUID();
  const folderId = randomUUID();
  const secretId = randomUUID();
  const name = `${label}-org`;

  await db(TableName.Organization).insert({ id: orgId, name, slug: `${label}-org` });
  await db(TableName.Project).insert({
    id: projectId,
    name: `${label}-project`,
    slug: `${label}-project`,
    orgId,
    type: "secret-manager"
  });
  await db(TableName.Environment).insert({
    id: envId,
    name: "dev",
    slug: "dev",
    position: 1,
    projectId
  });
  await db(TableName.SecretFolder).insert({ id: folderId, name: "root", envId });
  await db(TableName.SecretV2).insert({
    id: secretId,
    key: `${label.toUpperCase()}_TOKEN`,
    folderId,
    encryptedValue: Buffer.from(`${label}-ciphertext`)
  });

  return name;
};

const names = async (db: Knex) => {
  const rows = await db(TableName.Organization).select("name").orderBy("name");
  return rows.map((row: { name: string }) => row.name);
};

// The backend tsconfig asks ts-node to typecheck with `files: true`, which
// keeps a language-service program for all of src/. Requiring the migration
// set that way climbs past the default ~2GB vitest worker heap (OOM around
// file 350 of ~500) before SQL runs. Transpile-only compiles the same files
// at about 550MB. Each migrate gets its own pool, closed before the next
// prefix, so three knex clients are not live during the heavy work.
const registerMigrations = async () => {
  process.env.TS_NODE_TRANSPILE_ONLY = "true";
  process.env.TS_NODE_FILES = "false";
  await import("ts-node/register");
};

const migratePrefix = async (prefix: string) => {
  const db = openDb(prefix);
  try {
    await db.migrate.latest();
  } finally {
    await db.destroy();
  }
};

describeIf("DB_TABLE_PREFIX isolation", () => {
  const clients: Knex[] = [];

  afterAll(async () => {
    await Promise.all(clients.map((db) => db.destroy()));
  });

  test("migrates an unprefixed schema and two prefixes in one database without sharing rows", async () => {
    await registerMigrations();
    await migratePrefix("");
    await migratePrefix("t1");
    await migratePrefix("t2");

    const plain = openDb("");
    const tenantA = openDb("t1");
    const tenantB = openDb("t2");
    clients.push(plain, tenantA, tenantB);

    const plainOrg = await seedTenant(plain, "plain");
    const orgA = await seedTenant(tenantA, "alpha");
    const orgB = await seedTenant(tenantB, "beta");

    expect(await names(plain)).toEqual([plainOrg]);
    expect(await names(tenantA)).toEqual([orgA]);
    expect(await names(tenantB)).toEqual([orgB]);

    const plainSecret = await plain(TableName.SecretV2).first();
    const secretA = await tenantA(TableName.SecretV2).first();
    const secretB = await tenantB(TableName.SecretV2).first();
    expect(plainSecret?.key).toBe("PLAIN_TOKEN");
    expect(secretA?.key).toBe("ALPHA_TOKEN");
    expect(secretB?.key).toBe("BETA_TOKEN");

    const tables = await plain.raw<{ rows: { tablename: string }[] }>(
      `select tablename from pg_tables where schemaname = 'public' and tablename = any(?)`,
      [
        [
          "organizations",
          "t1_organizations",
          "t2_organizations",
          "vaultix_migrations",
          "t1_vaultix_migrations",
          "t2_vaultix_migrations",
          "audit_logs",
          "t1_audit_logs",
          "t2_audit_logs",
          "secrets_v2",
          "t1_secrets_v2",
          "t2_secrets_v2"
        ]
      ]
    );
    expect(tables.rows.map((row) => row.tablename).sort()).toEqual(
      [
        "audit_logs",
        "organizations",
        "secrets_v2",
        "t1_audit_logs",
        "t1_organizations",
        "t1_secrets_v2",
        "t1_vaultix_migrations",
        "t2_audit_logs",
        "t2_organizations",
        "t2_secrets_v2",
        "t2_vaultix_migrations",
        "vaultix_migrations"
      ].sort()
    );

    const triggers = await plain.raw<{ rows: { tgname: string }[] }>(
      `select tgname from pg_trigger where tgname = any(?)`,
      [["organizations_updatedAt", "t1_organizations_updatedAt", "t2_organizations_updatedAt"]]
    );
    expect(triggers.rows.map((row) => row.tgname).sort()).toEqual(
      ["organizations_updatedAt", "t1_organizations_updatedAt", "t2_organizations_updatedAt"].sort()
    );
  }, 1_200_000);
});
