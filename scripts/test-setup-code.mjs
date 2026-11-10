// First-owner setup code on one packaged instance: setup is refused without the code or with
// a wrong one, the right code creates the owner, and afterwards the code opens nothing.
// The code is generated here and never printed.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDisposableImageHarness } from "./lib/disposable-image.mjs";

assert.equal(process.argv.length, 3, "Usage: node scripts/test-setup-code.mjs <local-standalone-image>");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let phase = "image inspection";
const harness = createDisposableImageHarness(process.argv[2], () => phase);
const { artifact, container, docker, http, ready, waitFor } = harness;
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache/setup-code-"));
const run = `vaultix-setupcode-${randomBytes(8).toString("hex")}`;
const report = { passed: false, artifact, checks: [], scope: "One packaged instance installed with a first-owner setup code" };
const check = name => { report.checks.push(name); console.log(`Vaultix setup code: ${name}`); };
const setupCode = `vxs-${randomBytes(16).toString("hex")}`;
const password = `Vx9!${[...randomBytes(24)].map(byte => byte.toString(16).padStart(2, "0")).join("-")}`;

const call = (app, path, body) => {
  const response = http(app, path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.ok(response, `HTTP connection failed during ${phase}`);
  assert.ok(!response.body.includes(setupCode), `${path} echoed the setup code`);
  return { status: response.status, json: JSON.parse(response.body || "{}") };
};
const refused = (result, status, error, description) => {
  assert.equal(result.status, status, `${description}: expected ${status}, got ${result.status}`);
  assert.equal(typeof result.json.error, "string", `${description}: expected a plain error string`);
  if (error) assert.equal(result.json.error, error, `${description}: refused for another reason`);
};

try {
  phase = "disposable services";
  harness.createNetwork(run);
  const databasePassword = randomBytes(24).toString("hex");
  const db = container(`${run}-db`, "postgres:16.6-alpine", [], { POSTGRES_USER: "vaultix", POSTGRES_DB: "vaultix", POSTGRES_PASSWORD: databasePassword });
  const cache = container(`${run}-cache`, "docker.dragonflydb.io/dragonflydb/dragonfly:v1.34.2",
    ["--default_lua_flags=allow-undeclared-keys", "--cache_mode=false", "--maxmemory=512mb", "--proactor_threads=2"]);
  await waitFor(() => docker(["exec", db, "pg_isready", "-U", "vaultix", "-d", "vaultix"], { allowFailure: true }).status === 0, "database readiness");
  await waitFor(() => docker(["exec", cache, "redis-cli", "ping"], { allowFailure: true }).status === 0, "cache readiness");
  const app = container(`${run}-app`, artifact.id, [], {
    DB_CONNECTION_URI: `postgres://vaultix:${databasePassword}@${run}-db:5432/vaultix`,
    VAULTIX_CACHE_PROVIDER: "dragonfly", VAULTIX_CACHE_URL: `redis://${run}-cache:6379`,
    ENCRYPTION_KEY: randomBytes(16).toString("hex"), AUTH_SECRET: randomBytes(32).toString("hex"),
    SITE_URL: "http://127.0.0.1:8200", TELEMETRY_ENABLED: "false", DISABLE_UPDATE_CHECK: "true",
    VAULTIX_SETUP_CODE: setupCode
  });
  await ready(app);

  phase = "before setup";
  const before = call(app, "/api/v1/admin/config");
  assert.ok(before.json.config.initialized === false && before.json.config.setupCodeRequired === true, "A fresh instance with a code must report it as required");
  check("a fresh instance installed with a code reports setupCodeRequired");

  const owner = { email: `${run}@vaultix.invalid`, password, firstName: "Setup", organizationName: "Setup Code Proof" };
  refused(call(app, "/api/v1/admin/signup", owner), 403, "SetupCodeRequired", "Signup without a code");
  refused(call(app, "/api/v1/admin/signup", { ...owner, setupCode: `${setupCode}x` }), 403, "SetupCodeRequired", "Signup with a wrong code");
  refused(call(app, "/api/v1/admin/bootstrap", { email: owner.email, password, organization: "Setup Code Proof" }), 403, "SetupCodeRequired", "Bootstrap without a code");
  assert.equal(call(app, "/api/v1/admin/config").json.config.initialized, false, "A refused attempt initialized the instance");
  check("signup and bootstrap without the code, or with a wrong one, are refused and setup stays open");

  phase = "setup";
  const created = call(app, "/api/v1/admin/signup", { ...owner, setupCode });
  assert.equal(created.status, 200, `Signup with the code failed with ${created.status}`);
  assert.ok(created.json.token && created.json.organization?.id, "Signup did not sign the owner in");
  check("the right code creates the first owner and signs them in");

  phase = "after setup";
  const after = call(app, "/api/v1/admin/config");
  assert.ok(after.json.config.initialized === true && after.json.config.setupCodeRequired === false, "The code must stop being required once the owner exists");
  refused(call(app, "/api/v1/admin/signup", { ...owner, email: `again-${owner.email}`, setupCode }), 400, null, "Signup again with the code");
  const replay = call(app, "/api/v1/admin/bootstrap", { email: `again-${owner.email}`, password, organization: "Again", setupCode });
  assert.ok(replay.status >= 400 && replay.status < 500 && typeof replay.json.error === "string", `Bootstrap after setup returned ${replay.status}`);
  check("after the owner exists the same code opens neither signup nor bootstrap");
  report.passed = true;
} catch (error) {
  report.failure = { phase, message: error.code === "ERR_ASSERTION" ? error.message : "Setup code operation failed; raw diagnostics withheld." };
  process.exitCode = 1;
} finally {
  phase = "cleanup";
  report.cleanupPassed = harness.cleanup();
  if (!report.cleanupPassed) { report.passed = false; process.exitCode = 1; }
  writeFileSync(resolve(evidence, "result.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks, failure: report.failure, cleanupPassed: report.cleanupPassed, evidence }));
}
