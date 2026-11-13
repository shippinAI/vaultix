import { randomUUID } from "node:crypto";

import knex from "knex";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { TDbClient } from "@app/db";

import { deviceEventRecipientDALFactory } from "./device-event-recipient-dal";

describe.sequential("device security notice audiences in PostgreSQL", () => {
  let db: TDbClient;
  let rootOrgId: string;
  let orgId: string;
  let subjectId: string;
  const users: string[] = [];
  const organizations: string[] = [];
  const organization = async (root?: string) => {
    const id = randomUUID();
    await db("vx_workspace_organizations").insert({
      id,
      name: "Device audience",
      slug: id,
      rootOrgId: root,
      parentOrgId: root
    });
    organizations.push(id);
    return id;
  };
  const user = async (overrides: Record<string, unknown> = {}) => {
    const id = randomUUID();
    await db("vx_auth_users").insert({
      id,
      username: id,
      email: `${id}@vaultix.invalid`,
      isAccepted: true,
      ...overrides
    });
    users.push(id);
    return id;
  };
  const membership = async (
    scope: string,
    actor: { actorUserId: string } | { actorGroupId: string },
    role = "admin",
    overrides: Record<string, unknown> = {},
    roleOverrides: Record<string, unknown> = {}
  ) => {
    const id = randomUUID();
    await db("vx_workspace_memberships").insert({
      id,
      scope: "organization",
      scopeOrgId: scope,
      ...actor,
      status: "accepted",
      ...overrides
    });
    await db("vx_workspace_membership_roles").insert({ membershipId: id, role, ...roleOverrides });
    return id;
  };
  const group = async (scope = orgId, owner = rootOrgId) => {
    const id = randomUUID();
    await db("vx_workspace_groups").insert({ id, orgId: owner, name: id, slug: id });
    await membership(scope, { actorGroupId: id });
    return id;
  };
  const join = (groupId: string, userId: string, isPending = false) =>
    db("vx_workspace_user_group_memberships").insert({ groupId, userId, isPending });
  const audience = () => ({ orgId, rootOrgId, subjectId });
  const cleanup = async () => {
    // Children precede their root; only rows created by this fixture are touched.
    for (const id of [...organizations].reverse()) {
      // eslint-disable-next-line no-await-in-loop
      await db("vx_workspace_organizations").where({ id }).delete();
    }
    if (users.length) await db("vx_auth_users").whereIn("id", users).delete();
    organizations.length = 0;
    users.length = 0;
  };
  beforeAll(() => {
    if (!process.env.VAULTIX_SESSION_TEST_DATABASE) throw new Error("Use disposable device recipient runner");
    db = knex({
      client: "pg",
      connection: process.env.VAULTIX_SESSION_TEST_DATABASE,
      pool: { min: 0, max: 1 },
      acquireConnectionTimeout: 2000
    }) as TDbClient;
    db.replicaNode = () => {
      throw new Error("Device recipients must use the primary");
    };
  });
  beforeEach(async () => {
    await cleanup();
    rootOrgId = await organization();
    orgId = await organization(rootOrgId);
    subjectId = await user();
    await membership(rootOrgId, { actorUserId: subjectId });
  });
  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await db?.destroy();
    }
  });

  test("pages every administrator exactly once and excludes the affected subject", async () => {
    const expected: string[] = [];
    for (let i = 0; i < 43; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const id = await user();
      expected.push(id);
      // eslint-disable-next-line no-await-in-loop
      await membership(rootOrgId, { actorUserId: id });
    }
    const dal = deviceEventRecipientDALFactory(db);
    const expectedRoot = rootOrgId;
    let after: string | null = null;
    const observed: string[] = [];
    do {
      // eslint-disable-next-line no-await-in-loop
      const page = await dal.listAdministrators({ ...audience(), after, limit: 7 });
      expect(page.recipients.length).toBeLessThanOrEqual(7);
      expect(page.recipients.every((r) => r.orgId === expectedRoot)).toBe(true);
      observed.push(...page.recipients.map((r) => r.userId));
      after = page.next;
    } while (after);
    expect(observed).toEqual(expected.sort());
  });

  test("retains administrators without email and routes selected-organization administrators once", async () => {
    const id = await user({ email: null });
    await membership(rootOrgId, { actorUserId: id });
    await membership(orgId, { actorUserId: id });
    await join(await group(), id);
    expect(await deviceEventRecipientDALFactory(db).listAdministrators(audience())).toEqual({
      recipients: [{ userId: id, orgId, email: null }],
      next: null
    });
  });

  test.each([{ isActive: false }, { status: "invited" }])(
    "direct denial overrides an active group: %j",
    async (denial) => {
      const id = await user();
      await membership(rootOrgId, { actorUserId: id }, "member");
      await membership(orgId, { actorUserId: id }, "member", denial);
      await join(await group(), id);
      expect((await deviceEventRecipientDALFactory(db).listAdministrators(audience())).recipients).toEqual([]);
    }
  );

  test("pending group membership and foreign-root groups do not qualify", async () => {
    const pending = await user();
    const foreign = await user();
    await membership(rootOrgId, { actorUserId: pending }, "member");
    await membership(rootOrgId, { actorUserId: foreign }, "member");
    await join(await group(), pending, true);
    await join(await group(orgId, await organization()), foreign);
    expect((await deviceEventRecipientDALFactory(db).listAdministrators(audience())).recipients).toEqual([]);
  });

  test("sub-organization administrators need accepted direct root membership", async () => {
    const missing = await user();
    const pending = await user();
    const accepted = await user();
    const groupId = await group();
    await join(groupId, missing);
    await join(groupId, pending);
    await join(groupId, accepted);
    await membership(rootOrgId, { actorUserId: pending }, "member", { status: "invited" });
    await membership(rootOrgId, { actorUserId: accepted }, "member");
    expect(
      (await deviceEventRecipientDALFactory(db).listAdministrators(audience())).recipients.map((r) => r.userId)
    ).toEqual([accepted]);
  });

  test("root organization permits group-only membership but still honors direct denial", async () => {
    const id = await user();
    await join(await group(rootOrgId), id);
    const dal = deviceEventRecipientDALFactory(db);
    const scope = { ...audience(), orgId: rootOrgId };
    expect((await dal.listAdministrators(scope)).recipients.map((r) => r.userId)).toEqual([id]);
    await membership(rootOrgId, { actorUserId: id }, "member", { isActive: false });
    expect((await dal.listAdministrators(scope)).recipients).toEqual([]);
  });

  test("temporary administrator roles must be started, unexpired and fully bounded", async () => {
    const now = Date.now();
    const current = await user();
    const future = await user();
    const expired = await user();
    const incomplete = await user();
    await membership(
      rootOrgId,
      { actorUserId: current },
      "admin",
      {},
      {
        isTemporary: true,
        temporaryAccessStartTime: new Date(now - 60000),
        temporaryAccessEndTime: new Date(now + 60000)
      }
    );
    await membership(
      rootOrgId,
      { actorUserId: future },
      "admin",
      {},
      {
        isTemporary: true,
        temporaryAccessStartTime: new Date(now + 60000),
        temporaryAccessEndTime: new Date(now + 120000)
      }
    );
    await membership(
      rootOrgId,
      { actorUserId: expired },
      "admin",
      {},
      {
        isTemporary: true,
        temporaryAccessStartTime: new Date(now - 120000),
        temporaryAccessEndTime: new Date(now - 60000)
      }
    );
    await membership(
      rootOrgId,
      { actorUserId: incomplete },
      "admin",
      {},
      { isTemporary: true, temporaryAccessEndTime: new Date(now + 60000) }
    );
    expect(
      (await deviceEventRecipientDALFactory(db).listAdministrators(audience())).recipients.map((r) => r.userId)
    ).toEqual([current]);
  });

  test("rejects unrelated tenants and mismatched root binding", async () => {
    const foreignOrg = await organization();
    const id = await user();
    await membership(foreignOrg, { actorUserId: id });
    const dal = deviceEventRecipientDALFactory(db);
    expect((await dal.listAdministrators(audience())).recipients).toEqual([]);
    expect((await dal.listAdministrators({ ...audience(), rootOrgId: foreignOrg })).recipients).toEqual([]);
    expect(await dal.findRecipient({ ...audience(), userId: id, kind: "administrator" })).toBeUndefined();
  });

  test("rechecks current eligibility and address without requiring a second connection in a transaction", async () => {
    const id = await user();
    const member = await membership(rootOrgId, { actorUserId: id });
    const dal = deviceEventRecipientDALFactory(db);
    const request = { ...audience(), userId: id, kind: "administrator" as const };
    expect((await dal.findRecipient(request))?.email).toBe(`${id}@vaultix.invalid`);
    await expect(
      db.transaction(async (tx) => {
        await tx("vx_auth_users").where({ id }).update({ email: "changed@vaultix.invalid" });
        expect((await dal.findRecipient(request, tx))?.email).toBe("changed@vaultix.invalid");
        await tx("vx_workspace_memberships").where({ id: member }).update({ isActive: false });
        expect(await dal.findRecipient(request, tx)).toBeUndefined();
        throw new Error("fixture rollback");
      })
    ).rejects.toThrow("fixture rollback");
    expect((await dal.findRecipient(request))?.email).toBe(`${id}@vaultix.invalid`);
  });

  test("unaccepted and ghost accounts are excluded while a locked subject keeps security notices", async () => {
    const unaccepted = await user({ isAccepted: false });
    const ghost = await user({ isGhost: true });
    await membership(rootOrgId, { actorUserId: unaccepted });
    await membership(rootOrgId, { actorUserId: ghost });
    const dal = deviceEventRecipientDALFactory(db);
    expect((await dal.listAdministrators(audience())).recipients).toEqual([]);
    await db("vx_auth_users").where({ id: subjectId }).update({ isLocked: true });
    expect((await dal.findRecipient({ ...audience(), userId: subjectId, kind: "subject" }))?.userId).toBe(subjectId);
    expect(await dal.findRecipient({ ...audience(), userId: ghost, kind: "subject" })).toBeUndefined();
    await db("vx_auth_users").where({ id: subjectId }).delete();
    expect(await dal.findRecipient({ ...audience(), userId: subjectId, kind: "subject" })).toBeUndefined();
  });

  test("invalid limits, cursors and identities fail before querying recipients", async () => {
    const dal = deviceEventRecipientDALFactory(db);
    for (const limit of [0, 41, -1, 1.5]) {
      // eslint-disable-next-line no-await-in-loop
      await expect(dal.listAdministrators({ ...audience(), limit })).rejects.toThrow("recipient page");
    }
    await expect(dal.listAdministrators({ ...audience(), after: "invalid" })).rejects.toThrow("recipient page");
    await expect(dal.listAdministrators({ ...audience(), orgId: "invalid" })).rejects.toThrow("audience");
  });
});
