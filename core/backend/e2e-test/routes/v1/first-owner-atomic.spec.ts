import { randomBytes, randomUUID } from "node:crypto";

import jwt from "jsonwebtoken";
import knex from "knex";

import { TDbClient } from "@app/db";
import { TableName, TSuperAdmin } from "@app/db/schemas";
import { KeyStorePrefixes, PgSqlLock } from "@app/keystore/keystore";
import { superAdminDALFactory } from "@app/services/super-admin/super-admin-dal";
import { ADMIN_CONFIG_DB_UUID } from "@app/services/super-admin/super-admin-service";
import { LoginMethod } from "@app/services/super-admin/super-admin-types";

const tables = [
  TableName.Users,
  TableName.UserEncryptionKey,
  TableName.Organization,
  TableName.Project,
  TableName.Membership,
  TableName.MembershipRole,
  TableName.PkiCertificatePolicy,
  TableName.PamAccountTemplate,
  TableName.Identity,
  TableName.IdentityTokenAuth,
  TableName.IdentityAccessToken,
  TableName.AuthTokenSession
];
const counts = () => Promise.all(tables.map(async (table) => Number((await testDb(table).count("*").first())?.count)));
const setupInputs: Array<{ email: string; organizationName: string }> = [];
const input = () => {
  const data = {
    email: `first-owner-${randomUUID()}@example.test`,
    password: `Vx!${randomBytes(24).toString("hex").match(/.{2}/g)!.join("-")}9a`,
    firstName: "Owner",
    organizationName: `Setup ${randomUUID()}`,
    ip: "127.0.0.1",
    userAgent: "Vaultix atomic setup verification"
  };
  setupInputs.push({ email: data.email, organizationName: data.organizationName });
  return data;
};
type SetupInput = ReturnType<typeof input>;
const create = async (kind: "browser" | "machine", data: SetupInput) =>
  testServer.inject({
    method: "POST",
    url: kind === "browser" ? "/api/v1/admin/signup" : "/api/v1/admin/bootstrap",
    headers: { "user-agent": data.userAgent },
    body:
      kind === "browser"
        ? {
            email: data.email,
            password: data.password,
            firstName: data.firstName,
            organizationName: data.organizationName
          }
        : { email: data.email, password: data.password, organization: data.organizationName }
  });
const getServerCfg = async () => {
  const response = await testServer.inject({ method: "GET", url: "/api/v1/admin/config" });
  expect(response.statusCode).toBe(200);
  return response.json().config;
};

describe("First-owner transaction", () => {
  let originalConfig: Pick<TSuperAdmin, "initialized" | "allowSignUp" | "enabledLoginMethods" | "adminIdentityIds">;
  beforeAll(async () => {
    originalConfig = await testDb(TableName.SuperAdmin)
      .where({ id: ADMIN_CONFIG_DB_UUID })
      .first("initialized", "allowSignUp", "enabledLoginMethods", "adminIdentityIds");
  });

  afterAll(async () => {
    await testDb(TableName.Organization)
      .whereIn(
        "name",
        setupInputs.map((data) => data.organizationName)
      )
      .delete();
    await testDb(TableName.Users)
      .whereIn(
        "email",
        setupInputs.map((data) => data.email)
      )
      .delete();
    await testDb(TableName.SuperAdmin).where({ id: ADMIN_CONFIG_DB_UUID }).update(originalConfig);
    await testRedis.del(KeyStorePrefixes.AdminConfig);
  });

  beforeEach(async () => {
    // This suite runs only in the disposable e2e database; existing seeded rows remain the baseline.
    await testDb(TableName.SuperAdmin)
      .where({ id: ADMIN_CONFIG_DB_UUID })
      .update({
        initialized: false,
        allowSignUp: true,
        enabledLoginMethods: [LoginMethod.EMAIL, LoginMethod.OIDC],
        adminIdentityIds: []
      });
    await testRedis.del(KeyStorePrefixes.AdminConfig);
  });

  test("configuration joins its caller's transaction with a one-connection pool and rolls back", async () => {
    const single = knex({
      client: "pg",
      connection: process.env.DB_CONNECTION_URI,
      pool: { min: 0, max: 1 },
      acquireConnectionTimeout: 1500
    });
    const db = Object.assign(single, { replicaNode: () => single }) as TDbClient;
    const dal = superAdminDALFactory(db);
    try {
      await expect(
        single.transaction(async (tx) => {
          const updated = await dal.updateById(ADMIN_CONFIG_DB_UUID, { initialized: true }, tx);
          expect(updated.initialized).toBe(true);
          throw new Error("test rollback");
        })
      ).rejects.toThrow("test rollback");
      expect((await dal.findByIdPrimary(ADMIN_CONFIG_DB_UUID))?.initialized).toBe(false);
      expect((await dal.updateById(ADMIN_CONFIG_DB_UUID, { allowSignUp: false })).allowSignUp).toBe(false);
    } finally {
      await single.destroy();
    }
  });

  test.each([
    ["browser", "browser"],
    ["machine", "machine"],
    ["browser", "machine"]
  ] as const)(
    "competing %s and %s setup requests commit exactly one owner",
    async (left, right) => {
      const before = await counts();
      const requests = [input(), input()];
      let pending: Promise<Awaited<ReturnType<typeof create>>[]> | undefined;
      let outcomes: Awaited<ReturnType<typeof create>>[] = [];
      try {
        await testDb.transaction(async (tx) => {
          await tx.raw("SELECT pg_advisory_xact_lock(?)", [PgSqlLock.SuperAdminInit]);
          pending = Promise.all([create(left, requests[0]), create(right, requests[1])]);
          // Both requests must pass their preflight before either is allowed to commit.
          await vi.waitFor(
            async () => {
              const waiting = await testDb("pg_stat_activity").where({ wait_event: "advisory" }).count("*").first();
              expect(Number(waiting?.count)).toBeGreaterThanOrEqual(2);
            },
            { timeout: 15000, interval: 25 }
          );
        });
      } finally {
        if (pending) outcomes = await pending;
      }
      expect(outcomes.map((outcome) => outcome.statusCode).sort()).toEqual([200, 400]);
      expect(outcomes.find((outcome) => outcome.statusCode === 400)?.json().message).toContain("already been set up");
      const after = await counts();
      expect(after[tables.indexOf(TableName.Users)] - before[tables.indexOf(TableName.Users)]).toBe(1);
      expect(after[tables.indexOf(TableName.Organization)] - before[tables.indexOf(TableName.Organization)]).toBe(1);
      expect(after[tables.indexOf(TableName.Project)] - before[tables.indexOf(TableName.Project)]).toBe(2);
      const config = await testSuperAdminDAL.findByIdPrimary(ADMIN_CONFIG_DB_UUID);
      expect(config?.initialized).toBe(true);
      expect(config?.allowSignUp).toBe(false);
      expect(config?.enabledLoginMethods).toEqual([LoginMethod.EMAIL]);
      expect((await create(left, input())).statusCode).toBe(400);
      expect(await counts()).toEqual(after);
    },
    20000
  );

  test.each([
    ["browser", TableName.Organization, "INSERT"],
    ["machine", TableName.PamAccountTemplate, "INSERT"],
    ["machine", TableName.IdentityAccessToken, "INSERT"],
    ["browser", TableName.SuperAdmin, "UPDATE"],
    ["machine", TableName.SuperAdmin, "UPDATE"]
  ] as const)("%s setup rolls every row back when %s fails", async (kind, table, operation) => {
    const before = await counts();
    const data = input();
    await testDb.raw(
      "CREATE FUNCTION vaultix_test_setup_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'setup fault injection'; END; $$"
    );
    await testDb.raw(
      `CREATE TRIGGER vaultix_test_setup_failure BEFORE ${operation} ON ?? FOR EACH ROW EXECUTE FUNCTION vaultix_test_setup_failure()`,
      [table]
    );
    try {
      expect((await create(kind, data)).statusCode).toBe(500);
      expect(await counts()).toEqual(before);
      expect((await testSuperAdminDAL.findByIdPrimary(ADMIN_CONFIG_DB_UUID))?.initialized).toBe(false);
    } finally {
      await testDb.raw("DROP TRIGGER vaultix_test_setup_failure ON ??", [table]);
      await testDb.raw("DROP FUNCTION vaultix_test_setup_failure()");
    }
    // Retrying the same email succeeds because the failed attempt left no owner behind.
    expect((await create(kind, data)).statusCode).toBe(200);
    expect((await testSuperAdminDAL.findByIdPrimary(ADMIN_CONFIG_DB_UUID))?.initialized).toBe(true);
  });

  test.each(["browser", "machine"] as const)(
    "a lost %s creation response recovers through password sign-in without recreating the owner",
    async (kind) => {
      const data = input();
      expect((await create(kind, data)).statusCode).toBe(200);
      const before = await counts();
      const login = await testServer.inject({
        method: "POST",
        url: "/api/v3/auth/login",
        headers: { "user-agent": data.userAgent },
        body: { email: data.email, password: data.password }
      });
      expect(login.statusCode).toBe(200);
      expect((await create(kind, data)).statusCode).toBe(400);
      const after = await counts();
      expect(after[tables.indexOf(TableName.Users)]).toBe(before[tables.indexOf(TableName.Users)]);
      expect(after[tables.indexOf(TableName.Organization)]).toBe(before[tables.indexOf(TableName.Organization)]);
    }
  );

  test("an initialized instance retains its existing access choices", async () => {
    await testDb(TableName.SuperAdmin)
      .where({ id: ADMIN_CONFIG_DB_UUID })
      .update({
        initialized: true,
        allowSignUp: true,
        enabledLoginMethods: [LoginMethod.OIDC]
      });
    const before = await counts();
    expect((await create("browser", input())).statusCode).toBe(400);
    expect((await create("machine", input())).statusCode).toBe(400);
    const config = await testSuperAdminDAL.findByIdPrimary(ADMIN_CONFIG_DB_UUID);
    expect(config?.allowSignUp).toBe(true);
    expect(config?.enabledLoginMethods).toEqual([LoginMethod.OIDC]);
    expect(await counts()).toEqual(before);
  });

  test("a late pre-setup cache fill cannot reopen setup or public signup", async () => {
    const stale = await getServerCfg();
    expect((await create("browser", input())).statusCode).toBe(200);
    await testRedis.set(KeyStorePrefixes.AdminConfig, JSON.stringify(stale), "EX", 60);
    const config = await getServerCfg();
    expect(config.initialized).toBe(true);
    expect(config.allowSignUp).toBe(false);
    expect(config.enabledLoginMethods).toEqual([LoginMethod.EMAIL]);
  });

  test("machine setup keeps its managed token bounded and rejects repeat HTTP bootstrap", async () => {
    const data = input();
    const response = await create("machine", data);
    expect(response.statusCode).toBe(200);
    const result = response.json();
    const claims = jwt.verify(result.identity.credentials.token, process.env.AUTH_SECRET!) as jwt.JwtPayload;
    expect(typeof claims.exp).toBe("number");
    expect(claims.exp! > claims.iat!).toBe(true);
    const records = await testDb(TableName.IdentityAccessToken).where({ identityId: result.identity.id });
    expect(records).toHaveLength(1);
    expect(Number(records[0].accessTokenTTL)).toBeGreaterThan(0);
    const repeated = await testServer.inject({
      method: "POST",
      url: "/api/v1/admin/bootstrap",
      body: { email: data.email, password: data.password, organization: data.organizationName }
    });
    expect(repeated.statusCode).toBe(400);
    expect(typeof repeated.json().error).toBe("string");
  });
});
