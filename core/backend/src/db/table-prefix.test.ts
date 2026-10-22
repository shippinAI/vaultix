import { readFileSync } from "node:fs";
import path from "node:path";

import { createSqlPrefixer, fitIdent, knownPhysicalTables, normalizeTablePrefix, ROUTINES } from "./table-prefix";

const prefixed = (raw = "t1") => createSqlPrefixer(normalizeTablePrefix(raw));

describe("normalizeTablePrefix", () => {
  test("empty stays empty and a missing underscore is added", () => {
    expect(normalizeTablePrefix("")).toBe("");
    expect(normalizeTablePrefix(undefined)).toBe("");
    expect(normalizeTablePrefix("  ")).toBe("");
    expect(normalizeTablePrefix("acme")).toBe("acme_");
    expect(normalizeTablePrefix("acme_")).toBe("acme_");
  });

  test("rejects prefixes that are not safe postgres name stems", () => {
    expect(() => normalizeTablePrefix("T1")).toThrow(/DB_TABLE_PREFIX/);
    expect(() => normalizeTablePrefix("1acme")).toThrow(/DB_TABLE_PREFIX/);
    expect(() => normalizeTablePrefix("acme-prod")).toThrow(/DB_TABLE_PREFIX/);
    expect(() => normalizeTablePrefix("abcdefghijkl")).toThrow(/DB_TABLE_PREFIX/);
  });
});

describe("createSqlPrefixer", () => {
  test("an empty prefix leaves SQL and bindings unchanged", () => {
    const prefixer = createSqlPrefixer("");
    const sql = `select * from "users" where id = ?`;
    expect(prefixer.prefixSql(sql)).toBe(sql);
    expect(prefixer.prefixBindings(sql, ["users"])).toEqual(["users"]);
    expect(prefixer.rewriteQuery({ sql, bindings: ["abc"] })).toEqual({ sql, bindings: ["abc"] });
  });

  test("prefixes quoted and unquoted tables without touching column names", () => {
    const prefixer = prefixed();
    expect(prefixer.prefixSql(`select * from users`)).toBe(`select * from t1_users`);
    expect(prefixer.prefixSql(`select "alerts"."projectId" from "alerts"`)).toBe(
      `select "t1_alerts"."projectId" from "t1_alerts"`
    );
    expect(prefixer.prefixSql(`select public.users from public.users`)).toBe(`select t1_users from t1_users`);
    expect(prefixer.prefixSql(`select "public"."users" from public."users"`)).toBe(`select "t1_users" from "t1_users"`);
  });

  test("prefixes primary keys, foreign keys, and knex-style constraint names", () => {
    const prefixer = prefixed();
    const sql = `create table "users" ("id" uuid not null, "usersId" uuid, "orgId" uuid, constraint "users_pkey" primary key ("id"), constraint "users_orgid_foreign" foreign key ("orgId") references "organizations" ("id"))`;
    expect(prefixer.prefixSql(sql)).toBe(
      `create table "t1_users" ("id" uuid not null, "usersId" uuid, "orgId" uuid, constraint "t1_users_pkey" primary key ("id"), constraint "t1_users_orgid_foreign" foreign key ("orgId") references "t1_organizations" ("id"))`
    );
  });

  test("prefixes index names that do not start with the table name", () => {
    const prefixer = prefixed();
    const sql = `create unique index concurrently if not exists "idx_identity_metadata_identity_id" on "identity_metadata" ("identityId") where "identityId" is not null`;
    expect(prefixer.prefixSql(sql)).toBe(
      `create unique index concurrently if not exists "t1_idx_identity_metadata_identity_id" on "t1_identity_metadata" ("identityId") where "identityId" is not null`
    );
    expect(prefixer.prefixSql(`drop index if exists "idx_a", "idx_b"`)).toBe(
      `drop index if exists "t1_idx_a", "t1_idx_b"`
    );
    expect(prefixer.prefixSql(`drop index concurrently if exists "idx_a"`)).toBe(
      `drop index concurrently if exists "t1_idx_a"`
    );
    expect(prefixer.prefixSql(`create index "public"."idx_foo" on "users" ("id")`)).toBe(
      `create index "t1_idx_foo" on "t1_users" ("id")`
    );
    expect(
      prefixer.prefixSql(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_identity_access_tokens_num_uses_with_limit\nON identity_access_tokens ("id")\nWHERE "accessTokenNumUses" >= "identity_access_tokens"."accessTokenNumUsesLimit"`
      )
    ).toBe(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS t1_idx_identity_access_tokens_num_uses_with_limit\nON t1_identity_access_tokens ("id")\nWHERE "accessTokenNumUses" >= "t1_identity_access_tokens"."accessTokenNumUsesLimit"`
    );
  });

  test("prefixes triggers and the shared updated-at routine, including calls", () => {
    const prefixer = prefixed();
    const fn = `CREATE OR REPLACE FUNCTION on_update_timestamp() RETURNS TRIGGER AS $$ BEGIN NEW."updatedAt" = NOW();\nRETURN NEW;\nEND;\n$$ LANGUAGE plpgsql;`;
    const rewrittenFn = prefixer.prefixSql(fn);
    expect(rewrittenFn).toContain("FUNCTION t1_on_update_timestamp()");
    expect(rewrittenFn).toContain(`NEW."updatedAt"`);
    expect(rewrittenFn).not.toContain(`NEW."t1_updatedAt"`);

    expect(
      prefixer.prefixSql(
        `CREATE TRIGGER "projects_updatedAt"\nBEFORE UPDATE ON projects\nFOR EACH ROW\nEXECUTE PROCEDURE on_update_timestamp();`
      )
    ).toBe(
      `CREATE TRIGGER "t1_projects_updatedAt"\nBEFORE UPDATE ON t1_projects\nFOR EACH ROW\nEXECUTE PROCEDURE t1_on_update_timestamp();`
    );

    expect(prefixer.prefixSql(`DROP FUNCTION IF EXISTS on_update_timestamp() CASCADE;`)).toBe(
      `DROP FUNCTION IF EXISTS t1_on_update_timestamp() CASCADE;`
    );
  });

  test("rewrites catalog lookup strings and leaves secret values alone", () => {
    const prefixer = prefixed();
    expect(prefixer.prefixSql(`SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'projects_updatedAt');`)).toBe(
      `SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 't1_projects_updatedAt');`
    );

    expect(
      prefixer.prefixSql(
        `SELECT tablename FROM pg_tables WHERE tablename LIKE 'certificate_requests_%' AND schemaname = 'public'`
      )
    ).toBe(
      `SELECT tablename FROM pg_tables WHERE tablename LIKE 't1_certificate_requests_%' AND schemaname = 'public'`
    );

    expect(
      prefixer.prefixSql(
        `SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid WHERE c.relname = 'idx_identity_metadata_org_id' AND NOT i.indisvalid`
      )
    ).toContain(`c.relname = 't1_idx_identity_metadata_org_id'`);

    expect(prefixer.prefixSql(`insert into "secrets_v2" ("key") values ('users_token')`)).toBe(
      `insert into "t1_secrets_v2" ("key") values ('users_token')`
    );
  });

  test("rewrites username-merge regclass casts to an unqualified prefixed table", () => {
    const prefixer = prefixed();
    const hardcoded = `AND c.confrelid = 'public.users'::regclass AND attrelid = 'public.users'::regclass`;
    expect(prefixer.prefixSql(hardcoded)).toBe(
      `AND c.confrelid = 't1_users'::regclass AND attrelid = 't1_users'::regclass`
    );
    const unqualified = `AND c.confrelid = 'users'::regclass AND c.conrelid::regclass::text = 'users'`;
    expect(prefixer.prefixSql(unqualified)).toBe(
      `AND c.confrelid = 't1_users'::regclass AND c.conrelid::regclass::text = 'users'`
    );
    expect(prefixer.prefixSql(`SELECT 'pg_class'::regclass`)).toBe(`SELECT 'pg_class'::regclass`);
    expect(
      prefixer.prefixBindings(`WHERE c.oid = ?::regclass OR inhparent = ?::regclass`, ["audit_logs", "public.users"])
    ).toEqual(["t1_audit_logs", "t1_users"]);
    expect(prefixer.prefixBindings(`WHERE c.oid = ?::regclass`, ["pg_class"])).toEqual(["pg_class"]);

    const migration = readFileSync(path.join(__dirname, "migrations/20260404140728_username-merge.ts"), "utf8");
    const mirror = readFileSync(
      path.join(__dirname, "../../../../db/migrations/20260404140728_username-merge.ts"),
      "utf8"
    );
    expect(migration).toBe(mirror);
    expect(migration).not.toContain("'public.users'::regclass");
    expect(migration).toContain("'users'::regclass");
    expect(migration).toContain("quoteRegclass(ref.table_name)");

    const fkQuery = `SELECT c.conrelid::regclass::text AS table_name
    FROM pg_constraint c
    WHERE c.confrelid = 'users'::regclass
      AND c.confkey = ARRAY(
          SELECT attnum FROM pg_attribute
          WHERE attrelid = 'public.users'::regclass AND attname = 'id'
      )`;
    const rewritten = prefixer.prefixSql(fkQuery);
    expect(rewritten).toContain("c.confrelid = 't1_users'::regclass");
    expect(rewritten).toContain("attrelid = 't1_users'::regclass");
    expect(rewritten).not.toContain("public.");
  });

  test("does not rewrite statement settings, information_schema, or advisory locks", () => {
    const prefixer = prefixed();
    expect(prefixer.prefixSql(`SET statement_timeout = 60000`)).toBe(`SET statement_timeout = 60000`);
    expect(prefixer.prefixSql(`select * from information_schema.tables where table_schema = current_schema()`)).toBe(
      `select * from information_schema.tables where table_schema = current_schema()`
    );
    const lock = `SELECT pg_try_advisory_xact_lock(?) as lock_acquired`;
    expect(prefixer.prefixSql(lock)).toBe(lock);
    expect(prefixer.prefixBindings(lock, [42])).toEqual([42]);
  });

  test("prefixes bound catalog names and leaves column-name bindings alone", () => {
    const prefixer = prefixed();
    expect(
      prefixer.prefixBindings(
        `select * from information_schema.tables where table_name = ? and table_schema = current_schema()`,
        ["users"]
      )
    ).toEqual(["t1_users"]);

    expect(
      prefixer.prefixBindings(
        `select * from information_schema.columns where table_name = ? and column_name = ? and table_schema = current_schema()`,
        ["users", "certificateId"]
      )
    ).toEqual(["t1_users", "certificateId"]);

    expect(
      prefixer.prefixBindings(`SELECT 1 FROM pg_indexes WHERE tablename = ? AND indexname = ?`, [
        "projects",
        "idx_projects_slug"
      ])
    ).toEqual(["t1_projects", "t1_idx_projects_slug"]);

    expect(prefixer.prefixBindings(`WHERE t.relname = ? AND c.conname = ?`, ["projects", "projects_pkey"])).toEqual([
      "t1_projects",
      "t1_projects_pkey"
    ]);

    expect(
      prefixer.prefixBindings(`select * from information_schema.tables where table_name = ?`, [
        "vaultix_migrations_lock"
      ])
    ).toEqual(["t1_vaultix_migrations_lock"]);

    expect(
      prefixer.prefixBindings(`select * from information_schema.tables where table_name = ?`, ["t1_users"])
    ).toEqual(["t1_users"]);
  });

  test("does not double-prefix and keeps long identifiers inside 63 bytes", () => {
    const prefixer = prefixed();
    expect(prefixer.prefixSql(`select * from t1_users`)).toBe(`select * from t1_users`);
    expect(prefixer.prefixSql(`drop index if exists "t1_idx_a"`)).toBe(`drop index if exists "t1_idx_a"`);

    const long = `users_${"x".repeat(80)}`;
    const fitted = fitIdent("t1_", long);
    expect(Buffer.byteLength(fitted)).toBeLessThanOrEqual(63);
    expect(fitIdent("t1_", long)).toBe(fitted);
    expect(prefixer.prefixSql(`select * from ${long}`)).toBe(`select * from ${fitted}`);
  });

  test("rewrites a knex query object", () => {
    const prefixer = prefixed();
    expect(
      prefixer.rewriteQuery({
        sql: `select * from "organizations" where slug = ?`,
        bindings: ["acme"]
      })
    ).toEqual({
      sql: `select * from "t1_organizations" where slug = ?`,
      bindings: ["acme"]
    });
  });
});

describe("sidecar table manifest", () => {
  test("matches the physical names the engine rewrites", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(__dirname, "../../../backend-go/internal/database/pg/prefix/physical-tables.json"), "utf8")
    ) as { tables: string[]; routines: string[] };

    expect([...manifest.tables].sort()).toEqual([...knownPhysicalTables()].sort());
    expect(manifest.routines).toEqual([...ROUTINES]);
  });
});
