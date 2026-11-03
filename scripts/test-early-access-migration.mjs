// Old-to-new rehearsal of the early-access schema change against a real store. `vaultix server
// upgrade` refuses a changed migration set, so this is the evidence for the manual path.
// All state is disposable and fixture-owned; no credentials, response bodies or SQL values are printed.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDisposableImageHarness } from "./lib/disposable-image.mjs";

const [candidate, previous] = process.argv.slice(2);
assert.equal(process.argv.length, 4, "Supply candidate and previous local canonical images");
let phase = "inspection";
const h = createDisposableImageHarness(candidate, () => phase);
const old = createDisposableImageHarness(previous, () => phase).artifact;
const run = "vaultix-early-access-" + randomBytes(8).toString("hex");
mkdirSync(resolve(".cache"), { recursive: true });
const directory = mkdtempSync(resolve(".cache/early-access-migration-"));
const report = { passed: false, candidate: h.artifact, previous: old, checks: [],
  sources: ["scripts/test-early-access-migration.mjs", "scripts/lib/disposable-image.mjs"].map(path => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })),
  limits: ["Schema and store compatibility for this one additive migration. Does not change or satisfy the `vaultix server upgrade` refusal of changed migration sets."] };
const check = name => { report.checks.push(name); console.log("Vaultix early access: " + name); };
const migration = "20261102120000_vaultix-early-access-requests.mjs";
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
  assert.equal(h.sql(db, "SELECT to_regclass('public.vaultix_early_access_requests') IS NULL;"), "t");
  const owner = await h.request(before, "/api/v1/admin/signup", { method: "POST", body: { email: run + "@vaultix.invalid", password: "Vx9!" + randomBytes(28).toString("hex"), firstName: "Early", organizationName: "Early access compatibility" } });
  const { token } = await h.request(before, "/api/v3/auth/select-organization", { method: "POST", token: owner.token, body: { organizationId: owner.organization.id } });
  const { project } = await h.request(before, "/api/v1/projects", { method: "POST", token, body: { projectName: "Early access compatibility" } });
  const canary = randomBytes(32).toString("hex");
  await h.request(before, "/api/v4/secrets/EARLY_ACCESS_CANARY", { method: "POST", token, body: { projectId: project.id, environment: "dev", secretPath: "/", secretValue: canary } });
  const cipher = h.sql(db, "SELECT encode(\"encryptedValue\",'hex') FROM secrets_v2 WHERE key='EARLY_ACCESS_CANARY';");
  assert.ok(cipher);
  h.output(["stop", "-t", "10", before]);

  phase = "forward migration";
  const after = h.container(run + "-after", h.artifact.id, [], { ...env, DB_POOL_MAX: "1" }); await h.ready(after);
  assert.equal(h.sql(db, `SELECT count(*) FROM vaultix_migrations WHERE name='${migration}';`), "1");
  assert.equal(h.sql(db, "SELECT count(*) FROM vaultix_early_access_requests;"), "0");
  assert.equal(h.sql(db, "SELECT \"earlyAccessRequestsEnabled\" FROM super_admin;"), "f");
  assert.equal(h.sql(db, "SELECT \"allowSignUp\" FROM super_admin;"), "f");
  assert.equal(h.sql(db, "SELECT encode(\"encryptedValue\",'hex') FROM secrets_v2 WHERE key='EARLY_ACCESS_CANARY';"), cipher);
  const query = new URLSearchParams({ projectId: project.id, environment: "dev", secretPath: "/", viewSecretValue: "true" });
  const read = await h.request(after, "/api/v4/secrets/EARLY_ACCESS_CANARY?" + query, { token });
  assert.ok(read.secret.secretValue === canary, "Existing secret no longer decrypts");
  assert.equal((await h.request(after, "/api/v1/early-access/status")).acceptingRequests, false);
  check("an existing store migrates through canonical startup, stays closed and keeps its secrets");

  phase = "data under the new schema";
  await h.request(after, "/api/v1/admin/config", { method: "PATCH", token, body: { earlyAccessRequestsEnabled: true } });
  const email = run + "-requester@vaultix.invalid";
  await h.request(after, "/api/v1/early-access/requests", { method: "POST", body: { email, useCase: "migration rehearsal" } });
  assert.equal((await h.request(after, "/api/v1/early-access/requests", { token })).totalCount, 1);
  migrate(after, "down", false);
  assert.equal(h.sql(db, "SELECT count(*) FROM vaultix_early_access_requests;"), "1");
  assert.equal(h.sql(db, `SELECT count(*) FROM vaultix_migrations WHERE name='${migration}';`), "1");
  check("down refuses while requests exist, so a rollback cannot erase them");

  phase = "previous binary on migrated store";
  h.output(["stop", "-t", "10", after]);
  const rollback = h.container(run + "-rollback", old.id, [], env); await h.ready(rollback);
  const reread = await h.request(rollback, "/api/v4/secrets/EARLY_ACCESS_CANARY?" + query, { token });
  assert.ok(reread.secret.secretValue === canary, "Existing secret no longer decrypts on the previous image");
  await h.request(rollback, "/api/v1/admin/config", { method: "PATCH", token, body: { allowSignUp: false } });
  assert.equal(h.sql(db, "SELECT count(*) FROM vaultix_early_access_requests;"), "1");
  check("the previous image runs on the migrated store, keeps login and decryption, and leaves requests alone");

  phase = "candidate restart";
  h.output(["stop", "-t", "10", rollback]); h.output(["start", after]); await h.ready(after);
  assert.equal((await h.request(after, "/api/v1/early-access/status")).acceptingRequests, true);
  assert.equal((await h.request(after, "/api/v1/early-access/requests", { token })).requests[0].email, email);
  check("restarting the candidate keeps the setting and the request");

  phase = "empty down and up";
  h.sql(db, "DELETE FROM vaultix_early_access_requests;");
  migrate(after, "down", true);
  assert.equal(h.sql(db, "SELECT to_regclass('public.vaultix_early_access_requests') IS NULL;"), "t");
  assert.equal(h.sql(db, "SELECT count(*) FROM information_schema.columns WHERE table_name='super_admin' AND column_name='earlyAccessRequestsEnabled';"), "0");
  migrate(after, "up", true);
  assert.equal(h.sql(db, "SELECT encode(\"encryptedValue\",'hex') FROM secrets_v2 WHERE key='EARLY_ACCESS_CANARY';"), cipher);
  check("empty down and up restores the schema and preserves ciphertext");
  report.passed = true;
} catch (error) {
  report.failedPhase = phase;
  report.failure = String(error?.message ?? "").slice(0, 300);
  process.exitCode = 1;
} finally {
  report.cleanup = h.cleanup();
  if (!report.cleanup) { report.passed = false; process.exitCode = 1; }
  writeFileSync(resolve(directory, "result.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ passed: report.passed, failedPhase: report.failedPhase, failure: report.failure, checks: report.checks.length, evidence: directory, cleanup: report.cleanup }));
}
