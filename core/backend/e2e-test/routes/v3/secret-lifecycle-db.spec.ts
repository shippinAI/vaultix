import { randomUUID } from "node:crypto";

import { OrgMembershipRole, SecretType, TableName } from "@app/db/schemas";
import { seedData1 } from "@app/db/seed-data";
import { ApproverType } from "@app/shippin/services/access-approval-policy/access-approval-policy-types";

import { createFolder, deleteFolder } from "../../testUtils/folders";

const projectId = seedData1.projectV3.id;
const environment = seedData1.environment.slug;
const folderName = `lifecycle-db-${randomUUID().slice(0, 8)}`;
const secretPath = `/${folderName}`;

const textOf = (value: unknown) => {
  if (value == null) return "";
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const assertPlantedValueAbsent = (row: Record<string, unknown>, planted: string) => {
  Object.entries(row).forEach(([column, value]) => {
    const text = textOf(value);
    expect(text, column).not.toContain(planted);
  });
};

describe("secret lifecycle against loopback Postgres", () => {
  let folderId = "";
  const policyIds: string[] = [];
  const headers = (token = jwtAuthToken) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const folder = await createFolder({
      workspaceId: projectId,
      environmentSlug: environment,
      secretPath: "/",
      name: folderName,
      authToken: jwtAuthToken
    });
    folderId = folder.id;
  });

  afterAll(async () => {
    await Promise.all(
      policyIds.map((id) =>
        testServer.inject({
          method: "DELETE",
          url: `/api/v1/secret-approvals/${id}`,
          headers: headers()
        })
      )
    );
    if (folderId) {
      await deleteFolder({
        workspaceId: projectId,
        environmentSlug: environment,
        secretPath: "/",
        id: folderId,
        authToken: jwtAuthToken
      });
    }
  });

  test("create stores version 1 ciphertext and update increments the stored version", async () => {
    const key = "LIFECYCLE_VERSIONED";
    const createdValue = `lifecycle-create-${randomUUID()}`;
    const updatedValue = `lifecycle-update-${randomUUID()}`;
    const created = await testServer.inject({
      method: "POST",
      url: `/api/v3/secrets/raw/${key}`,
      headers: headers(),
      body: {
        workspaceId: projectId,
        environment,
        type: SecretType.Shared,
        secretPath,
        secretValue: createdValue,
        secretComment: `${createdValue}-comment`
      }
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().secret.version).toBe(1);
    expect(created.body).toContain(createdValue);

    const [stored] = await testDb(TableName.SecretV2).where({ folderId, key });
    expect(stored.version).toBe(1);
    expect(Buffer.isBuffer(stored.encryptedValue) || stored.encryptedValue instanceof Uint8Array).toBe(true);
    assertPlantedValueAbsent(stored, createdValue);

    const createdVersions = await testDb(TableName.SecretVersionV2).where({ secretId: stored.id }).orderBy("version");
    expect(createdVersions.map((row) => row.version)).toEqual([1]);
    assertPlantedValueAbsent(createdVersions[0], createdValue);

    const updated = await testServer.inject({
      method: "PATCH",
      url: `/api/v3/secrets/raw/${key}`,
      headers: headers(),
      body: {
        workspaceId: projectId,
        environment,
        secretPath,
        type: SecretType.Shared,
        secretValue: updatedValue
      }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().secret.version).toBe(2);

    const [afterUpdate] = await testDb(TableName.SecretV2).where({ id: stored.id });
    expect(afterUpdate.version).toBe(2);
    assertPlantedValueAbsent(afterUpdate, createdValue);
    assertPlantedValueAbsent(afterUpdate, updatedValue);
    const versions = await testDb(TableName.SecretVersionV2).where({ secretId: stored.id }).orderBy("version");
    expect(versions.map((row) => row.version)).toEqual([1, 2]);
    versions.forEach((row) => {
      assertPlantedValueAbsent(row, createdValue);
      assertPlantedValueAbsent(row, updatedValue);
    });
  });

  test("an approval policy blocks the secret insert and stores the pending value as ciphertext", async () => {
    const key = "LIFECYCLE_APPROVAL";
    const planted = `lifecycle-approval-${randomUUID()}`;
    const metadataValue = `lifecycle-metadata-${randomUUID()}`;
    const comment = `lifecycle-comment-${randomUUID()}`;
    const policy = await testServer.inject({
      method: "POST",
      url: "/api/v1/secret-approvals",
      headers: headers(),
      body: {
        workspaceId: projectId,
        environment,
        name: `lifecycle-${randomUUID().slice(0, 8)}`,
        secretPath,
        approvers: [{ type: ApproverType.User, id: seedData1.id }],
        approvals: 1
      }
    });
    expect(policy.statusCode).toBe(200);
    const policyId = policy.json().approval.id as string;
    policyIds.push(policyId);

    try {
      const pending = await testServer.inject({
        method: "POST",
        url: `/api/v3/secrets/raw/${key}`,
        headers: headers(),
        body: {
          workspaceId: projectId,
          environment,
          type: SecretType.Shared,
          secretPath,
          secretValue: planted,
          secretComment: comment,
          secretMetadata: [{ key: "note", value: metadataValue }]
        }
      });
      expect(pending.statusCode).toBe(200);
      expect(pending.body).not.toContain(planted);
      expect(pending.body).not.toContain(comment);
      const approvalId = pending.json().approval.id as string;

      const secrets = await testDb(TableName.SecretV2).where({ folderId, key });
      expect(secrets).toHaveLength(0);

      const [request] = await testDb(TableName.SecretApprovalRequest).where({ id: approvalId });
      expect(request).toBeTruthy();
      assertPlantedValueAbsent(request, planted);

      const commits = await testDb(TableName.SecretApprovalRequestSecretV2).where({ requestId: approvalId });
      expect(commits).toHaveLength(1);
      const commit = commits[0];
      expect(commit.op).toBe("create");
      expect(commit.version).toBe(1);
      expect(textOf(commit.encryptedValue)).not.toContain(planted);
      expect(textOf(commit.encryptedValue).length).toBeGreaterThan(planted.length);
      expect(textOf(commit.encryptedComment)).not.toContain(comment);
      expect(textOf(commit.secretMetadata)).toContain(metadataValue);
      expect(textOf(commit.secretMetadata)).not.toContain(planted);
      Object.entries(commit).forEach(([column, value]) => {
        if (column === "secretMetadata") return;
        expect(textOf(value), column).not.toContain(planted);
      });

      const detail = await testServer.inject({
        method: "GET",
        url: `/api/v1/secret-approval-requests/${approvalId}`,
        headers: headers()
      });
      expect(detail.statusCode).toBe(200);
      const visible = detail.json().approval.commits[0];
      expect(visible.secretValue).toBe(planted);
      expect(visible.secretValueHidden).toBe(false);
      expect(visible.secretComment).toBe(comment);

      const duplicate = await testServer.inject({
        method: "POST",
        url: `/api/v3/secrets/raw/${key}`,
        headers: headers(),
        body: {
          workspaceId: projectId,
          environment,
          type: SecretType.Shared,
          secretPath,
          secretValue: planted
        }
      });
      expect(duplicate.statusCode).toBe(200);
      expect(duplicate.body).not.toContain(planted);
      expect(await testDb(TableName.SecretV2).where({ folderId, key })).toHaveLength(0);

      const collision = await testServer.inject({
        method: "POST",
        url: "/api/v3/secrets/raw/LIFECYCLE_VERSIONED",
        headers: headers(),
        body: {
          workspaceId: projectId,
          environment,
          type: SecretType.Shared,
          secretPath,
          secretValue: planted
        }
      });
      expect(collision.statusCode).toBe(400);
      expect(collision.body).toContain("Secret already exists: LIFECYCLE_VERSIONED");
      expect(collision.body).not.toContain(planted);

      const auditRows = await testDb(TableName.AuditLog)
        .where({ projectId })
        .whereRaw(`cast("eventMetadata" as text) like ?`, [`%${planted}%`]);
      expect(auditRows).toEqual([]);
    } finally {
      await testServer.inject({
        method: "DELETE",
        url: `/api/v1/secret-approvals/${policyId}`,
        headers: headers()
      });
    }
  });

  test("a project in another organization is rejected before a secret row is written", async () => {
    const [sourceOrg] = await testDb(TableName.Organization).where({ id: seedData1.organization.id });
    const [sourceProject] = await testDb(TableName.Project).where({ id: projectId });
    const [sourceEnvironment] = await testDb(TableName.Environment).where({ projectId, slug: environment });
    const foreignOrgId = randomUUID();
    const foreignProjectId = randomUUID();
    const foreignEnvironmentId = randomUUID();
    await testDb(TableName.Organization).insert({
      ...sourceOrg,
      id: foreignOrgId,
      name: "lifecycle-foreign",
      slug: `lifecycle-foreign-${foreignOrgId.slice(0, 8)}`,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    await testDb(TableName.Project).insert({
      ...sourceProject,
      id: foreignProjectId,
      orgId: foreignOrgId,
      name: "lifecycle-foreign-project",
      slug: `lifecycle-foreign-${foreignProjectId.slice(0, 8)}`,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    await testDb(TableName.Environment).insert({
      ...sourceEnvironment,
      id: foreignEnvironmentId,
      projectId: foreignProjectId,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    const planted = `lifecycle-foreign-${randomUUID()}`;
    try {
      const rejected = await testServer.inject({
        method: "POST",
        url: "/api/v3/secrets/raw/FOREIGN_SECRET",
        headers: headers(),
        body: {
          workspaceId: foreignProjectId,
          environment,
          type: SecretType.Shared,
          secretPath: "/",
          secretValue: planted
        }
      });
      expect(rejected.statusCode).toBeGreaterThanOrEqual(400);
      expect(rejected.body).toContain("This project does not belong to your selected organization.");
      expect(rejected.body).not.toContain(planted);
      const written = await testDb(TableName.SecretV2).where({ key: "FOREIGN_SECRET" });
      expect(written).toHaveLength(0);
    } finally {
      await testDb(TableName.Environment).where({ id: foreignEnvironmentId }).delete();
      await testDb(TableName.Project).where({ id: foreignProjectId }).delete();
      await testDb(TableName.Organization).where({ id: foreignOrgId }).delete();
    }
  });

  test("a matching forbid wins over create, and rollback requires perform-rollback", async () => {
    const forbiddenName = "LIFECYCLE_FORBID";
    const allowedName = "LIFECYCLE_ALLOWED";
    const planted = `lifecycle-forbid-${randomUUID()}`;
    const roleResponse = await testServer.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/roles`,
      headers: headers(),
      body: {
        slug: `lifecycle-${randomUUID().slice(0, 8)}`,
        name: "Lifecycle describe and conditional create",
        permissions: [
          {
            subject: "secrets",
            action: ["describeSecret", "create"]
          },
          {
            subject: "secrets",
            action: ["create"],
            inverted: true,
            conditions: { secretName: { $eq: forbiddenName } }
          }
        ]
      }
    });
    expect(roleResponse.statusCode).toBe(200);
    const role = roleResponse.json().role as { id: string; slug: string };

    const identityResponse = await testServer.inject({
      method: "POST",
      url: "/api/v1/identities",
      headers: headers(),
      body: {
        name: `lifecycle-${randomUUID().slice(0, 8)}`,
        role: OrgMembershipRole.Member,
        organizationId: seedData1.organization.id
      }
    });
    expect(identityResponse.statusCode).toBe(200);
    const identityId = identityResponse.json().identity.id as string;

    const membership = await testServer.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/memberships/identities/${identityId}`,
      headers: headers(),
      body: { roles: [{ role: role.slug, isTemporary: false }] }
    });
    expect(membership.statusCode).toBe(200);

    const attach = await testServer.inject({
      method: "POST",
      url: `/api/v1/auth/universal-auth/identities/${identityId}`,
      headers: headers(),
      body: { accessTokenTTL: 600, accessTokenMaxTTL: 600, accessTokenNumUsesLimit: 0 }
    });
    expect(attach.statusCode).toBe(200);
    const clientId = attach.json().identityUniversalAuth.clientId as string;
    const secretResponse = await testServer.inject({
      method: "POST",
      url: `/api/v1/auth/universal-auth/identities/${identityId}/client-secrets`,
      headers: headers(),
      body: {}
    });
    expect(secretResponse.statusCode).toBe(200);
    const login = await testServer.inject({
      method: "POST",
      url: "/api/v1/auth/universal-auth/login",
      body: { clientId, clientSecret: secretResponse.json().clientSecret }
    });
    expect(login.statusCode).toBe(200);
    const token = login.json().accessToken as string;

    try {
      const denied = await testServer.inject({
        method: "POST",
        url: `/api/v3/secrets/raw/${forbiddenName}`,
        headers: headers(token),
        body: {
          workspaceId: projectId,
          environment,
          type: SecretType.Shared,
          secretPath,
          secretValue: planted
        }
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.body).not.toContain(planted);
      expect(await testDb(TableName.SecretV2).where({ folderId, key: forbiddenName })).toHaveLength(0);

      const allowed = await testServer.inject({
        method: "POST",
        url: `/api/v3/secrets/raw/${allowedName}`,
        headers: headers(token),
        body: {
          workspaceId: projectId,
          environment,
          type: SecretType.Shared,
          secretPath,
          secretValue: planted
        }
      });
      expect(allowed.statusCode).toBe(200);
      const [allowedRow] = await testDb(TableName.SecretV2).where({ folderId, key: allowedName });
      expect(allowedRow.version).toBe(1);
      assertPlantedValueAbsent(allowedRow, planted);

      const [commit] = await testDb(TableName.FolderCommit).where({ folderId }).orderBy("createdAt", "desc");
      expect(commit).toBeTruthy();
      const revert = await testServer.inject({
        method: "POST",
        url: `/api/v1/pit/commits/${commit.id}/revert`,
        headers: headers(token),
        body: { projectId }
      });
      expect(revert.statusCode).toBe(403);
      expect(revert.body).not.toContain(planted);

      const adminRevert = await testServer.inject({
        method: "POST",
        url: `/api/v1/pit/commits/${commit.id}/revert`,
        headers: headers(),
        body: { projectId }
      });
      expect(adminRevert.statusCode).not.toBe(403);
      expect(adminRevert.body).not.toContain(planted);
      if (adminRevert.statusCode === 400) {
        expect(adminRevert.body).toContain("Cannot revert the first commit");
      } else {
        expect(adminRevert.statusCode).toBe(200);
        expect(adminRevert.json().success).toBe(true);
      }
    } finally {
      await testServer.inject({
        method: "DELETE",
        url: `/api/v1/identities/${identityId}`,
        headers: headers()
      });
      await testServer.inject({
        method: "DELETE",
        url: `/api/v1/projects/${projectId}/roles/${role.id}`,
        headers: headers()
      });
    }
  });
});
