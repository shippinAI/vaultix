// Actual canonical old/new migration acceptance. All state is disposable and
// fixture-owned; no credentials, response bodies or SQL values are printed.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDisposableImageHarness } from "./lib/disposable-image.mjs";

const [candidate, previous] = process.argv.slice(2);
assert.equal(process.argv.length, 4, "Supply candidate and previous local canonical images");
let phase = "inspection";
const h = createDisposableImageHarness(candidate, () => phase);
const old = createDisposableImageHarness(previous, () => phase).artifact;
const run = "vaultix-device-" + randomBytes(8).toString("hex");
mkdirSync(resolve(".cache"), { recursive: true });
const directory = mkdtempSync(resolve(".cache/device-migration-"));
const report = { passed: false, candidate: h.artifact, previous: old, checks: [],
  sources: ["scripts/test-device-grant-migration.mjs", "scripts/lib/disposable-image.mjs"].map(path => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })),
  limits: ["Grant schema compatibility only; policy/session collaborators, public routes, browser/CLI, refresh and live federation are separate acceptance gates."] };
const check = name => { report.checks.push(name); console.log("Vaultix device: " + name); };
const migration = "20261031030000_vaultix-device-authorizations.mjs";
function migrate(app, direction, succeeds) {
  const code = `import knex from 'knex';const db=knex({client:'pg',connection:process.env.DB_CONNECTION_URI});
    try{await db.migrate[${JSON.stringify(direction)}]({directory:'./dist/db/migrations',tableName:'vaultix_migrations',loadExtensions:['.mjs'],name:${JSON.stringify(migration)}})}
    catch{process.exitCode=2}finally{await db.destroy()}`;
  const r = h.docker(["exec", app, "node", "--input-type=module", "-e", code], { allowFailure: true });
  assert.ok(!r.error && r.status === (succeeds ? 0 : 2), "Unexpected migration result");
}
try {
  h.createNetwork(run);
  const dbName = run + "-db", cacheName = run + "-cache", dbPassword = randomBytes(24).toString("hex");
  const db = h.container(dbName, "postgres:16.6-alpine", [], { POSTGRES_USER: "vaultix", POSTGRES_DB: "vaultix", POSTGRES_PASSWORD: dbPassword });
  const cache = h.container(cacheName, "docker.dragonflydb.io/dragonflydb/dragonfly:v1.34.2", ["--default_lua_flags=allow-undeclared-keys", "--cache_mode=false", "--maxmemory=512mb", "--proactor_threads=2"]);
  await h.waitFor(() => h.docker(["exec", db, "pg_isready", "-U", "vaultix", "-d", "vaultix"], { allowFailure: true }).status === 0, "database readiness");
  await h.waitFor(() => h.docker(["exec", cache, "redis-cli", "ping"], { allowFailure: true }).status === 0, "cache readiness");
  const env = { DB_CONNECTION_URI: `postgres://vaultix:${dbPassword}@${dbName}:5432/vaultix`, VAULTIX_CACHE_PROVIDER: "dragonfly", VAULTIX_CACHE_URL: `redis://${cacheName}:6379`, ENCRYPTION_KEY: randomBytes(16).toString("hex"), AUTH_SECRET: randomBytes(32).toString("hex"), SITE_URL: "http://127.0.0.1:8200", TELEMETRY_ENABLED: "false", DISABLE_UPDATE_CHECK: "true" };
  phase = "existing account and secret";
  const before = h.container(run + "-before", old.id, [], env); await h.ready(before);
  assert.equal(h.sql(db, "SELECT to_regclass('public.vaultix_device_authorizations') IS NULL;"), "t");
  const owner = await h.request(before, "/api/v1/admin/signup", { method: "POST", body: { email: run + "@vaultix.invalid", password: "Vx9!" + randomBytes(28).toString("hex"), firstName: "Device", organizationName: "Device compatibility" } });
  const { token } = await h.request(before, "/api/v3/auth/select-organization", { method: "POST", token: owner.token, body: { organizationId: owner.organization.id } });
  const { project } = await h.request(before, "/api/v1/projects", { method: "POST", token, body: { projectName: "Device compatibility" } });
  const canary = randomBytes(32).toString("hex");
  await h.request(before, "/api/v4/secrets/DEVICE_CANARY", { method: "POST", token, body: { projectId: project.id, environment: "dev", secretPath: "/", secretValue: canary } });
  const cipher = h.sql(db, "SELECT encode(\"encryptedValue\",'hex') FROM secrets_v2 WHERE key='DEVICE_CANARY';");
  assert.ok(cipher);
  h.output(["stop", "-t", "10", before]);
  phase = "actual forward migration";
  const after = h.container(run + "-after", h.artifact.id, [], { ...env, DB_POOL_MAX: "1" }); await h.ready(after);
  assert.equal(h.sql(db, `SELECT count(*) FROM vaultix_migrations WHERE name='${migration}';`), "1");
  assert.equal(h.sql(db, "SELECT count(*) FROM vaultix_device_authorizations;"), "0");
  check("existing database receives additive grant schema through canonical startup");
  migrate(after, "down", true);
  assert.equal(h.sql(db, "SELECT to_regclass('public.vaultix_device_authorizations') IS NULL;"), "t");
  migrate(after, "up", true);
  assert.equal(h.sql(db, "SELECT encode(\"encryptedValue\",'hex') FROM secrets_v2 WHERE key='DEVICE_CANARY';"), cipher);
  check("empty down/up preserves encrypted secrets and existing account");
  const pending = randomUUID(), approved = randomUUID(), session = randomUUID();
  h.sql(db, `INSERT INTO auth_token_sessions(id,"userId","accessVersion","refreshVersion",ip,"userAgent","lastUsed","createdAt","updatedAt") VALUES('${session}','${owner.user.id}',1,1,'127.0.0.1','device-migration',NOW(),NOW(),NOW());
    INSERT INTO vaultix_device_authorizations(id,"deviceDigest","userCodeDigest","clientId",resource,scope,"expiresAt","nextPollAt") VALUES('${pending}',decode(repeat('01',32),'hex'),decode(repeat('02',32),'hex'),'vaultix-cli','https://vaultix.example.test','vaultix:user',NOW()+interval '9 minutes',NOW()+interval '5 seconds');
    INSERT INTO vaultix_device_authorizations(id,"deviceDigest","userCodeDigest","clientId",resource,scope,status,"userId","sessionId",approval,"expiresAt","nextPollAt") VALUES('${approved}',decode(repeat('03',32),'hex'),decode(repeat('04',32),'hex'),'vaultix-cli','https://vaultix.example.test','vaultix:user','approved','${owner.user.id}','${session}','{}',NOW()+interval '9 minutes',NOW()+interval '5 seconds');`);
  migrate(after, "down", false);
  assert.equal(h.sql(db, "SELECT count(*) FROM vaultix_device_authorizations;"), "2");
  assert.equal(h.sql(db, `SELECT count(*) FROM vaultix_migrations WHERE name='${migration}';`), "1");
  check("nonempty down refuses to erase active grant state or migration history");
  h.output(["stop", "-t", "10", after]);
  phase = "previous binary on migrated store";
  const rollback = h.container(run + "-rollback", old.id, [], env); await h.ready(rollback);
  const query = new URLSearchParams({ projectId: project.id, environment: "dev", secretPath: "/", viewSecretValue: "true" });
  const result = await h.request(rollback, "/api/v4/secrets/DEVICE_CANARY?" + query, { token });
  assert.ok(result.secret.secretValue === canary, "Existing secret no longer decrypts");
  assert.equal(h.sql(db, "SELECT count(*) FROM vaultix_device_authorizations;"), "2");
  h.sql(db, `DELETE FROM auth_token_sessions WHERE id='${session}';`);
  assert.equal(h.sql(db, `SELECT count(*) FROM vaultix_device_authorizations WHERE id='${approved}';`), "0");
  assert.equal(h.sql(db, `SELECT count(*) FROM vaultix_device_authorizations WHERE id='${pending}';`), "1");
  check("old binary retains existing login and decryption; session deletion removes its approved grant only");
  h.output(["stop", "-t", "10", rollback]); h.output(["start", after]); await h.ready(after);
  assert.equal(h.sql(db, `SELECT count(*) FROM vaultix_device_authorizations WHERE id='${pending}';`), "1");
  assert.equal(h.sql(db, "SELECT encode(\"encryptedValue\",'hex') FROM secrets_v2 WHERE key='DEVICE_CANARY';"), cipher);
  check("candidate restart preserves pending state and ciphertext");
  report.passed = true;
} catch {
  report.failedPhase = phase; process.exitCode = 1;
} finally {
  report.cleanup = h.cleanup();
  if (!report.cleanup) { report.passed = false; process.exitCode = 1; }
  writeFileSync(resolve(directory, "result.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ passed: report.passed, failedPhase: report.failedPhase, checks: report.checks.length, evidence: directory, cleanup: report.cleanup }));
}
