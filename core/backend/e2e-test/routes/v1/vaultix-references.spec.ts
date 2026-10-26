import { randomUUID } from "node:crypto";

import { TableName } from "@app/db/schemas/models";
import { seedData1 } from "@app/db/seed-data";

import { createFolder, deleteFolder } from "../../testUtils/folders";

describe("native Vaultix reference boundary", () => {
  const projectId = seedData1.projectV3.id;
  const environment = seedData1.environment.slug;
  const folderName = "vaultix-ai-references";
  const secretPath = `/${folderName}`;
  let folderId: string;
  const names = ["VAULTIX_REF_A", "VAULTIX_REF_B", "VAULTIX_REF_C"];
  const canary = "vaultix-e2e-value-must-not-enter-ai";
  const scope = { projectId, environment, secretPath };
  const headers = () => ({ authorization: `Bearer ${jwtAuthToken}` });

  beforeAll(async () => {
    const folder = await createFolder({ workspaceId: projectId, environmentSlug: environment, secretPath: "/", name: folderName, authToken: jwtAuthToken });
    folderId = folder.id;
    for (const name of names) {
      const response = await testServer.inject({ method: "POST", url: `/api/v4/secrets/${name}`, headers: headers(), payload: { ...scope, secretKey: name, secretValue: canary, secretComment: `${canary}-comment`, secretMetadata: [{ key: "note", value: `${canary}-metadata`, isEncrypted: false }], type: "shared" } });
      expect(response.statusCode).toBe(200);
    }
  });
  afterAll(async () => {
    if (folderId) await deleteFolder({ workspaceId: projectId, environmentSlug: environment, secretPath: "/", id: folderId, authToken: jwtAuthToken });
  });

  test("stores ciphertext and exposes only allowlisted references through HTTP and MCP", async () => {
    const stored = await testDb(TableName.SecretV2).where({ folderId }).select("encryptedValue");
    expect(stored).toHaveLength(3);
    stored.forEach((row) => {
      expect(row.encryptedValue).toBeTruthy();
      expect(row.encryptedValue?.toString()).not.toContain(canary);
    });
    const query = new URLSearchParams({ ...scope, limit: "2" });
    const response = await testServer.inject({ url: `/api/v1/vaultix/secret-references?${query}`, headers: headers() });
    expect(response.statusCode).toBe(200);
    const first = response.json();
    expect(first.references.map((reference: { name: string }) => reference.name)).toEqual(names.slice(0, 2));
    expect(first.nextOffset).toBe(2);
    expect(Object.keys(first.references[0]).sort()).toEqual(["createdAt", "id", "name", "updatedAt", "version"]);
    const mcp = await testServer.inject({ method: "POST", url: "/api/v1/vaultix/mcp", headers: headers(), payload: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "vaultix.secrets.references", arguments: { ...scope, limit: 2 } } } });
    expect(mcp.statusCode).toBe(200);
    expect(JSON.parse(mcp.json().result.content[0].text)).toEqual(first);
    expect(response.body + mcp.body).not.toContain(canary);
    query.set("offset", "2");
    const second = await testServer.inject({ url: `/api/v1/vaultix/secret-references?${query}`, headers: headers() });
    expect(second.json().references.map((reference: { name: string }) => reference.name)).toEqual(names.slice(2));
    expect(second.json().nextOffset).toBeNull();
  });

  test("reference queries never select encrypted payloads or custom metadata", async () => {
    const queries: string[] = [];
    const record = (query: { sql: string }) => { queries.push(query.sql); };
    testDb.on("query", record);
    try {
      const response = await testServer.inject({ url: `/api/v1/vaultix/secret-references?${new URLSearchParams(scope)}`, headers: headers() });
      expect(response.statusCode).toBe(200);
    } finally { testDb.removeListener("query", record); }
    const reads = queries.filter((sql) => /select/i.test(sql) && sql.includes('"secrets_v2"'));
    expect(reads.length).toBeGreaterThan(0);
    reads.forEach((sql) => expect(sql).not.toMatch(/encryptedValue|encryptedComment|resource_metadata|select\s+\*/i));
  });

  test("rejects unauthenticated reads and hides out-of-scope projects", async () => {
    const unauthenticated = await testServer.inject(`/api/v1/vaultix/secret-references?${new URLSearchParams(scope)}`);
    expect(unauthenticated.statusCode).toBe(401);
    const unavailable = await testServer.inject({ url: `/api/v1/vaultix/secret-references?${new URLSearchParams({ ...scope, projectId: randomUUID() })}`, headers: headers() });
    expect(unavailable.statusCode).toBe(404);
    expect(typeof unavailable.json().error).toBe("string");
  });

  test("rejects invalid authentication without a 500 or token reflection", async () => {
    const response = await testServer.inject({ url: "/api/v1/vaultix/projects", headers: { authorization: "Bearer invalid-CANARY-token" } });
    expect(response.statusCode).toBe(401);
    expect(typeof response.json().error).toBe("string");
    expect(response.body).not.toContain("CANARY");
  });

  test("another organization's project is absent from lists and indistinguishable from a missing project", async () => {
    const [organization] = await testDb(TableName.Organization).insert({ name: "Foreign test organization", slug: `foreign-${randomUUID()}` }).returning("id");
    const orgId = organization.id;
    let foreignProjectId: string | undefined;
    try {
      const [project] = await testDb(TableName.Project).insert({ orgId, name: "Private other tenant app", slug: `foreign-${randomUUID()}`, type: "secret-manager", version: 3 }).returning("id");
      foreignProjectId = project.id;
      const projects = await testServer.inject({ url: "/api/v1/vaultix/projects", headers: headers() });
      expect(projects.statusCode).toBe(200);
      expect(projects.body).not.toContain(foreignProjectId);
      expect(projects.body).not.toMatch(/encrypted|kmsSecretManager|secretDetectionIgnoreValues/);
      const foreign = await testServer.inject({ url: `/api/v1/vaultix/secret-references?${new URLSearchParams({ ...scope, projectId: foreignProjectId })}`, headers: headers() });
      const absent = await testServer.inject({ url: `/api/v1/vaultix/secret-references?${new URLSearchParams({ ...scope, projectId: randomUUID() })}`, headers: headers() });
      expect(foreign.statusCode).toBe(404);
      expect(foreign.body).toBe(absent.body);
    } finally {
      if (foreignProjectId) await testDb(TableName.Project).where({ id: foreignProjectId }).delete();
      await testDb(TableName.Organization).where({ id: orgId }).delete();
    }
  });
});
