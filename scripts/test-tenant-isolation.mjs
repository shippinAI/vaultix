// Real packaged HTTP/MCP authority checks; no operator URLs or identity fixtures in SQL.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDisposableImageHarness } from "./lib/disposable-image.mjs";

assert.equal(process.argv.length, 3, "Usage: node scripts/test-tenant-isolation.mjs <local-standalone-image>");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let phase = "image inspection";
const harness = createDisposableImageHarness(process.argv[2], () => phase);
const { artifact, container, docker, request, ready, waitFor } = harness;
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache/tenant-isolation-"));
const run = `vaultix-tenants-${randomBytes(8).toString("hex")}`;
const report = { passed: false, artifact, checks: [],
  scope: "Two API-created organizations with independent machine identities on one packaged application",
  exclusions: ["human tenant enrollment", "Nomen issuer/session acceptance", "all inherited endpoints", "jobs/imports/exports", "fairness under load", "multi-replica consistency"] };
const check = name => { report.checks.push(name); console.log(`Vaultix isolation: ${name}`); };
const password = `Vx9!${[...randomBytes(24)].map(byte => byte.toString(16).padStart(2, "0")).join("-")}`;
const databasePassword = randomBytes(24).toString("hex");
const canary = randomBytes(32).toString("hex");
try {
  phase = "disposable services";
  harness.createNetwork(run);
  const dbName = `${run}-db`, cacheName = `${run}-cache`;
  const db = container(dbName, "postgres:16.6-alpine", [], { POSTGRES_USER: "vaultix", POSTGRES_DB: "vaultix", POSTGRES_PASSWORD: databasePassword });
  const cache = container(cacheName, "docker.dragonflydb.io/dragonflydb/dragonfly:v1.34.2",
    ["--default_lua_flags=allow-undeclared-keys", "--cache_mode=false", "--maxmemory=512mb", "--proactor_threads=2"]);
  await waitFor(() => docker(["exec", db, "pg_isready", "-U", "vaultix", "-d", "vaultix"], { allowFailure: true }).status === 0, "database readiness");
  await waitFor(() => docker(["exec", cache, "redis-cli", "ping"], { allowFailure: true }).status === 0, "cache readiness");
  const app = container(`${run}-app`, artifact.id, [], {
    DB_CONNECTION_URI: `postgres://vaultix:${databasePassword}@${dbName}:5432/vaultix`,
    VAULTIX_CACHE_PROVIDER: "dragonfly", VAULTIX_CACHE_URL: `redis://${cacheName}:6379`,
    ENCRYPTION_KEY: randomBytes(16).toString("hex"), AUTH_SECRET: randomBytes(32).toString("hex"),
    SITE_URL: "http://127.0.0.1:8200", TELEMETRY_ENABLED: "false", DISABLE_UPDATE_CHECK: "true"
  });
  await ready(app);
  const api = (path, options) => request(app, path, options);
  const mcp = (name, args, token, status = 200) => api("/api/v1/vaultix/mcp", {
    method: "POST", token, status, body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }
  });
  phase = "organization fixtures";
  assert.equal((await api("/api/v1/admin/config")).config.initialized, false);
  const signup = { email: `${run}@vaultix.invalid`, password, firstName: "Isolation", organizationName: "Tenant A" };
  const owner = await api("/api/v1/admin/signup", { method: "POST", body: signup });
  const second = await api("/api/v2/organizations", { method: "POST", token: owner.token, body: { name: "Tenant B" } });
  const tenants = [];
  for (const [index, organization] of [owner.organization, second.organization].entries()) {
    phase = `tenant ${index + 1} provisioning`;
    const { token: admin } = await api("/api/v3/auth/select-organization", { method: "POST", token: owner.token, body: { organizationId: organization.id } });
    const { project } = await api("/api/v1/projects", { method: "POST", token: admin, body: { projectName: `Tenant ${index + 1} Project` } });
    const { identity } = await api("/api/v1/identities", { method: "POST", token: admin, body: { name: `Tenant ${index + 1} Machine`, organizationId: organization.id, role: "member" } });
    await api(`/api/v1/projects/${project.id}/memberships/identities/${identity.id}`, { method: "POST", token: admin, body: { roles: [{ role: "admin", isTemporary: false }] } });
    await api(`/api/v1/auth/token-auth/identities/${identity.id}`, { method: "POST", token: admin, body: { accessTokenTTL: 600, accessTokenMaxTTL: 600 } });
    const issued = await api(`/api/v1/auth/token-auth/identities/${identity.id}/tokens`, { method: "POST", token: admin, body: { name: "Disposable isolation proof" } });
    const scope = { projectId: project.id, environment: "dev", secretPath: "/" };
    const name = `TENANT_${index + 1}_REFERENCE`;
    await api(`/api/v4/secrets/${name}`, { method: "POST", token: issued.accessToken,
      body: { ...scope, secretValue: canary, secretComment: canary, secretMetadata: [{ key: "fixture", value: canary, isEncrypted: false }] } });
    tenants.push({ organization, project, identity, admin, token: issued.accessToken, tokenId: issued.tokenData.id, scope, name });
  }
  check("two organizations, projects and independent scoped identities provisioned through real APIs");
  for (const [index, tenant] of tenants.entries()) {
    const foreign = tenants[1 - index];
    phase = `tenant ${index + 1} authority`;
    const listed = await api("/api/v1/vaultix/projects", { token: tenant.token });
    assert.ok(listed.projects.length === 1 && listed.projects[0].id === tenant.project.id, "Project list escaped tenant authority");
    const toolList = JSON.parse((await mcp("vaultix.projects.list", {}, tenant.token)).result.content[0].text);
    assert.ok(JSON.stringify(listed) === JSON.stringify(toolList), "HTTP and MCP project lists differ");
    const references = `/api/v1/vaultix/secret-references?${new URLSearchParams(tenant.scope)}`;
    const own = await api(references, { token: tenant.token });
    const ownTool = await mcp("vaultix.secrets.references", tenant.scope, tenant.token);
    assert.ok(own.references.length === 1 && own.references[0].name === tenant.name, "Expected own secret reference");
    assert.deepEqual(Object.keys(own.references[0]).sort(), ["createdAt", "id", "name", "updatedAt", "version"]);
    assert.ok(JSON.stringify(own) === ownTool.result.content[0].text, "HTTP and MCP references differ");
    assert.ok(!JSON.stringify([listed, own, ownTool]).includes(canary), "Sensitive canary escaped reference boundary");
    check(`tenant ${index + 1}: HTTP/MCP agree and expose only owned reference metadata`);

    const absentScope = { ...tenant.scope, projectId: randomUUID() };
    const missing = await api(`/api/v1/vaultix/secret-references?${new URLSearchParams(absentScope)}`, { token: tenant.token, status: 404 });
    // Both tenants have already warmed their own permissions/reference paths.
    const denied = await api(`/api/v1/vaultix/secret-references?${new URLSearchParams(foreign.scope)}`, { token: tenant.token, status: 404 });
    const deniedTool = await mcp("vaultix.secrets.references", foreign.scope, tenant.token, 404);
    assert.ok(JSON.stringify(missing) === JSON.stringify(denied) && JSON.stringify(denied) === JSON.stringify(deniedTool), "Foreign resources are distinguishable from unavailable resources");
    await api(`${references}&actorOrgId=${foreign.organization.id}`, { token: tenant.token, status: 400 });
    await mcp("vaultix.secrets.references", { ...foreign.scope, actorOrgId: foreign.organization.id }, tenant.token, 400);
    check(`tenant ${index + 1}: foreign and missing resources share denial; supplied authority is rejected`);

    phase = `tenant ${index + 1} write denial`;
    const write = harness.http(app, "/api/v4/secrets/CROSS_TENANT_WRITE", { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tenant.token}` },
      body: JSON.stringify({ ...foreign.scope, secretValue: canary }) });
    assert.ok(write && [403, 404].includes(write.status), "Cross-tenant write was not denied by authorization");
    const writeError = JSON.parse(write.body);
    assert.equal(typeof writeError.error, "string");
    assert.ok(!write.body.includes(canary), "Denied write reflected a value");
    const after = await api(`/api/v1/vaultix/secret-references?${new URLSearchParams(foreign.scope)}`, { token: foreign.token });
    assert.ok(after.references.length === 1 && after.references[0].name === foreign.name, "Denied write changed foreign references");
    check(`tenant ${index + 1}: cross-tenant write denied and foreign data unchanged`);

    phase = `tenant ${index + 1} administration denial`;
    await api("/api/v1/admin/config", { method: "PATCH", token: tenant.token, body: { allowSignUp: true }, status: 403 });
    const config = (await api("/api/v1/admin/config", { token: tenant.token })).config;
    assert.ok(config.allowSignUp === false && !Object.hasOwn(config, "instanceId"), "Tenant gained instance administration");
    await api("/api/v1/admin/signup", { method: "POST", token: tenant.token, body: signup, status: 400 });
    check(`tenant ${index + 1}: instance configuration and repeated bootstrap denied`);
  }
  phase = "revocation";
  const revoked = tenants[0];
  await api(`/api/v1/auth/token-auth/tokens/${revoked.tokenId}/revoke`, { method: "POST", token: revoked.admin, body: {} });
  await api("/api/v1/vaultix/projects", { token: revoked.token, status: 401 });
  await mcp("vaultix.secrets.references", revoked.scope, revoked.token, 401);
  await api("/api/v1/vaultix/projects", { status: 401 });
  await mcp("vaultix.secrets.references", tenants[1].scope, undefined, 401);
  const surviving = await api("/api/v1/vaultix/projects", { token: tenants[1].token });
  assert.ok(surviving.projects.length === 1 && surviving.projects[0].id === tenants[1].project.id, "Revoking one tenant disrupted the other");
  check("revoked and anonymous credentials denied while the other tenant retains access");
  phase = "restart persistence";
  harness.output(["restart", app]);
  await ready(app);
  await api("/api/v1/vaultix/projects", { token: revoked.token, status: 401 });
  await mcp("vaultix.secrets.references", revoked.scope, revoked.token, 401);
  const afterRestart = await mcp("vaultix.secrets.references", tenants[1].scope, tenants[1].token);
  const retained = JSON.parse(afterRestart.result.content[0].text);
  assert.ok(retained.references.length === 1 && retained.references[0].name === tenants[1].name, "Tenant access changed after restart");
  assert.ok(!JSON.stringify(afterRestart).includes(canary), "Restart exposed a sensitive value");
  check("revocation persists across application restart while the other tenant retains reference access");
  report.passed = true;
} catch (error) {
  report.failure = { phase, message: error.code === "ERR_ASSERTION" ? error.message : "Isolation operation failed; raw diagnostics withheld." };
  process.exitCode = 1;
} finally {
  phase = "cleanup";
  report.cleanupPassed = harness.cleanup();
  if (!report.cleanupPassed) { report.passed = false; process.exitCode = 1; }
  writeFileSync(resolve(evidence, "result.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failure: report.failure, cleanupPassed: report.cleanupPassed, evidence }));
}
