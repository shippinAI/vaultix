// Disposable recovery acceptance. Never accepts an operator URL, dump, key or database.
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDisposableImageHarness } from "./lib/disposable-image.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requestedImage = process.argv[2];
assert.ok(process.argv.length === 3 && /^[a-zA-Z0-9][a-zA-Z0-9:._/@-]{0,255}$/.test(requestedImage ?? ""),
  "Usage: node scripts/test-encrypted-recovery.mjs <local-standalone-image>");
let phase = "image inspection";
const harness = createDisposableImageHarness(requestedImage, () => phase);
const { artifact, docker, output, container, request, ready, waitFor, sql } = harness;
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache/encrypted-recovery-"));
const run = `vaultix-recovery-${randomBytes(8).toString("hex")}`;
const report = { passed: false, artifact, fixture: "software-key logical database recovery", checks: [], timingsMs: {},
  exclusions: ["PITR/WAL", "production RPO/RTO", "external KMS/HSM", "queue recovery", "cross-version migration rollback", "full tenant isolation", "off-site backup encryption/custody"] };
const check = name => { report.checks.push(name); console.log(`Vaultix recovery: ${name}`); };
const save = () => writeFileSync(resolve(evidence, "result.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
const key = randomBytes(16).toString("hex");
const auth = randomBytes(32).toString("hex");
const databasePassword = randomBytes(24).toString("hex");
const password = `Vx9!${[...randomBytes(24)].map(byte => byte.toString(16).padStart(2, "0")).join("-")}`;
const email = `${run}@vaultix.invalid`;
const canary = randomBytes(32).toString("hex");
const keyName = "RESTORE_CANARY";
const dbEnv = { POSTGRES_USER: "vaultix", POSTGRES_DB: "vaultix", POSTGRES_PASSWORD: databasePassword };
function appEnv(db, cache, encryptionKey = key) {
  return { DB_CONNECTION_URI: `postgres://vaultix:${databasePassword}@${db}:5432/vaultix`,
    VAULTIX_CACHE_PROVIDER: "dragonfly", VAULTIX_CACHE_URL: `redis://${cache}:6379`,
    ENCRYPTION_KEY: encryptionKey, ROOT_ENCRYPTION_KEY: "", AUTH_SECRET: auth,
    SITE_URL: "http://127.0.0.1:8200", TELEMETRY_ENABLED: "false", DISABLE_UPDATE_CHECK: "true" };
}
const encryptedRows = db => sql(db, `SELECT id || ':' || encode("encryptedValue", 'hex') FROM secrets_v2 ORDER BY id;`);
let dump;
try {
  phase = "disposable services";
  harness.createNetwork(run);
  const sourceDbName = `${run}-source-db`, targetDbName = `${run}-target-db`;
  const sourceDb = container(sourceDbName, "postgres:16.6-alpine", [], dbEnv);
  const targetDb = container(targetDbName, "postgres:16.6-alpine", [], dbEnv);
  const sourceCacheName = `${run}-source-cache`, targetCacheName = `${run}-target-cache`;
  for (const name of [sourceCacheName, targetCacheName]) {
    container(name, "docker.dragonflydb.io/dragonflydb/dragonfly:v1.34.2",
      ["--default_lua_flags=allow-undeclared-keys", "--cache_mode=false", "--maxmemory=512mb", "--proactor_threads=2"]);
  }
  for (const db of [sourceDb, targetDb]) await waitFor(() => docker(["exec", db, "pg_isready", "-U", "vaultix", "-d", "vaultix"], { allowFailure: true }).status === 0, "database readiness");
  for (const cache of [sourceCacheName, targetCacheName]) await waitFor(() => docker(["exec", cache, "redis-cli", "ping"], { allowFailure: true }).status === 0, "cache readiness");
  const sourceApp = container(`${run}-source-app`, artifact.id, [], appEnv(sourceDbName, sourceCacheName));
  const source = sourceApp;
  await ready(source);
  phase = "fixture creation";
  assert.equal((await request(source, "/api/v1/admin/config")).config.initialized, false);
  const owner = await request(source, "/api/v1/admin/signup", { method: "POST", body: { email, password, firstName: "Recovery", organizationName: "Disposable Recovery" } });
  const select = async (base, token) => (await request(base, "/api/v3/auth/select-organization", { method: "POST", token, body: { organizationId: owner.organization.id } })).token;
  const token = await select(source, owner.token);
  const { project } = await request(source, "/api/v1/projects", { method: "POST", token, body: { projectName: "Recovery Fixture" } });
  const body = { projectId: project.id, environment: "dev", secretPath: "/", secretValue: canary };
  await request(source, `/api/v4/secrets/${keyName}`, { method: "POST", token, body });
  const query = new URLSearchParams({ projectId: project.id, environment: "dev", secretPath: "/", expandSecretReferences: "false", includeImports: "false" });
  const secretPath = `/api/v4/secrets/${keyName}?${query}`;
  // Existing compatibility read, strictly inside this synthetic fixture process; no model/tool value output.
  const original = await request(source, `${secretPath}&viewSecretValue=true`, { token });
  assert.ok(original.secret.secretValue === canary, "Source canary decryption failed");
  const before = encryptedRows(sourceDb);
  assert.ok(before.length > 0 && !before.includes(canary), "Expected stored ciphertext");
  check("real API fixture encrypted and readable before backup");

  phase = "logical backup";
  const backupStart = Date.now();
  dump = docker(["exec", sourceDb, "pg_dump", "-U", "vaultix", "-d", "vaultix", "--format=custom", "--compress=0", "--no-owner", "--no-acl"]).stdout;
  report.timingsMs.dump = Date.now() - backupStart;
  assert.ok(dump.length > 0 && !dump.includes(Buffer.from(canary)), "Plaintext canary present in uncompressed archive");
  report.archive = { bytes: dump.length, sha256: createHash("sha256").update(dump).digest("hex"), persisted: false };
  await request(source, "/api/v4/secrets/AFTER_BACKUP", { method: "POST", token, body: { ...body, secretValue: randomBytes(32).toString("hex") } });
  check("logical snapshot excludes plaintext canary and precedes a later committed write");
  // Recovery must work without the source application or source cache.
  output(["stop", "-t", "10", sourceApp]);
  output(["stop", "-t", "10", sourceCacheName]);
  phase = "restore";
  const restoreStart = Date.now();
  assert.equal(sql(targetDb, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"), "0");
  const truncated = docker(["exec", "-i", targetDb, "pg_restore", "-U", "vaultix", "-d", "vaultix", "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl"], { input: dump.subarray(0, Math.floor(dump.length * 0.8)), allowFailure: true });
  assert.ok(!truncated.error && truncated.status !== 0, "Truncated archive must fail");
  assert.equal(sql(targetDb, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"), "0", "Failed restore left partial tables");
  check("truncated archive fails and rolls back partial restore");
  docker(["exec", "-i", targetDb, "pg_restore", "-U", "vaultix", "-d", "vaultix", "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl"], { input: dump });
  report.timingsMs.restore = Date.now() - restoreStart;
  assert.ok(encryptedRows(targetDb) === before, "Restored ciphertext differs from snapshot");
  assert.equal(sql(targetDb, "SELECT count(*) FROM secrets_v2 WHERE key='AFTER_BACKUP';"), "0");
  check("separate empty database restores exact ciphertext and snapshot boundary");

  for (const [name, suppliedKey, diagnostic] of [["missing-key", "", ["Root KMS encryption strategy is set to software. Please set the ENCRYPTION_KEY environment variable and restart your deployment."]], ["wrong-key", randomBytes(16).toString("hex"), ["Unsupported state or unable to authenticate data"]]]) {
    phase = name;
    const bad = container(`${run}-${name}`, artifact.id, [], appEnv(targetDbName, targetCacheName, suppliedKey));
    await waitFor(() => output(["inspect", "--format", "{{.State.Running}}", bad]) === "false", `${name} refusal`, 60_000);
    assert.notEqual(output(["inspect", "--format", "{{.State.ExitCode}}", bad]), "0");
    const logs = docker(["logs", bad]);
    const diagnosticMatched = diagnostic.some(text => Buffer.concat([logs.stdout, logs.stderr]).toString().includes(text));
    assert.ok(diagnosticMatched, `${name} failed for an unexpected reason`);
    assert.ok(encryptedRows(targetDb) === before, "Key refusal changed ciphertext");
    check(`${name} refuses startup without changing ciphertext`);
  }
  phase = "authorized recovery";
  const targetApp = container(`${run}-target-app`, artifact.id, [], appEnv(targetDbName, targetCacheName));
  const target = targetApp;
  await ready(target);
  const login = await request(target, "/api/v3/auth/login", { method: "POST", body: { email, password } });
  const restoredToken = await select(target, login.accessToken);
  const metadata = await request(target, `${secretPath}&viewSecretValue=false`, { token: restoredToken });
  assert.ok(metadata.secret.secretValueHidden === true && !JSON.stringify(metadata).includes(canary), "Metadata response exposed value");
  const recovered = await request(target, `${secretPath}&viewSecretValue=true`, { token: restoredToken });
  assert.ok(recovered.secret.id === original.secret.id && recovered.secret.secretValue === canary, "Recovered canary mismatch");
  await request(target, `${secretPath}&viewSecretValue=true`, { status: 401 });
  await request(target, "/api/v1/admin/signup", { method: "POST", body: { email, password, firstName: "Duplicate" }, status: 400 });
  report.timingsMs.restoreThroughAuthorizedRead = Date.now() - restoreStart;
  check("fresh login, metadata redaction and authorized decryption survive restore");
  check("anonymous read and repeated instance bootstrap remain denied");
  await request(target, "/api/v4/secrets/RECOVERED_WRITE", { method: "POST", token: restoredToken, body });
  check("restored application accepts a new encrypted write");
  report.passed = true;
} catch (error) {
  // Assertions above contain safe labels/status only, never operands with secret values.
  report.failure = { phase, message: error.code === "ERR_ASSERTION" ? error.message : "Recovery operation failed; raw diagnostics withheld." };
  process.exitCode = 1;
} finally {
  dump?.fill(0);
  phase = "cleanup";
  report.cleanupPassed = harness.cleanup();
  if (!report.cleanupPassed) { report.passed = false; process.exitCode = 1; }
  save();
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failure: report.failure, cleanupPassed: report.cleanupPassed, evidence }));
}
