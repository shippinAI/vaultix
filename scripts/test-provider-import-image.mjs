// Provider import between two disposable instances of one packaged image: the source serves the
// instance API (the API Infisical and Vaultix share) to a machine identity; the target reviews,
// approves and imports through its own routes. Values stay in process memory and never print.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDisposableImageHarness } from "./lib/disposable-image.mjs";

assert.equal(process.argv.length, 3, "Usage: node scripts/test-provider-import-image.mjs <local-standalone-image>");
// Fixture-only mode for images without the import routes: provisions both instances and stops
// before the first import route. It is never a pass for the import contract.
const preflightOnly = process.env.VAULTIX_PROVIDER_IMPORT_PREFLIGHT === "1";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let phase = "image inspection";
const harness = createDisposableImageHarness(process.argv[2], () => phase);
const { artifact, container, docker, http, request, ready, waitFor } = harness;
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache/provider-import-"));
const run = `vaultix-pimport-${randomBytes(8).toString("hex")}`;
const report = { passed: false, preflightOnly, artifact, checks: [],
  scope: "Two packaged instances of one image on a private network; the target imports from the source through an external-vaultix connection",
  exclusions: ["Infisical Cloud or a real Infisical server", "Doppler's API", "browser UI", "change-request approval and merge"] };
const check = name => { report.checks.push(name); console.log(`Vaultix provider import: ${name}`); };
const password = `Vx9!${[...randomBytes(24)].map(byte => byte.toString(16).padStart(2, "0")).join("-")}`;
const value = () => randomBytes(24).toString("hex");
const sourceValues = { PI_ALPHA: value(), PI_BETA: value(), PI_GAMMA: value() };
const targetBetaValue = value();
const allValues = [...Object.values(sourceValues), targetBetaValue];
const leaks = text => allValues.some(secret => text.includes(secret));

function startInstance(label, extraEnv = {}) {
  const databasePassword = randomBytes(24).toString("hex");
  const dbName = `${run}-${label}-db`, cacheName = `${run}-${label}-cache`, appName = `${run}-${label}-app`;
  const db = container(dbName, "postgres:16.6-alpine", [], { POSTGRES_USER: "vaultix", POSTGRES_DB: "vaultix", POSTGRES_PASSWORD: databasePassword });
  const cache = container(cacheName, "docker.dragonflydb.io/dragonflydb/dragonfly:v1.34.2",
    ["--default_lua_flags=allow-undeclared-keys", "--cache_mode=false", "--maxmemory=512mb", "--proactor_threads=2"]);
  return { label, db, cache, appName, start: async () => {
    await waitFor(() => docker(["exec", db, "pg_isready", "-U", "vaultix", "-d", "vaultix"], { allowFailure: true }).status === 0, `${label} database readiness`);
    await waitFor(() => docker(["exec", cache, "redis-cli", "ping"], { allowFailure: true }).status === 0, `${label} cache readiness`);
    const app = container(appName, artifact.id, [], {
      DB_CONNECTION_URI: `postgres://vaultix:${databasePassword}@${dbName}:5432/vaultix`,
      VAULTIX_CACHE_PROVIDER: "dragonfly", VAULTIX_CACHE_URL: `redis://${cacheName}:6379`,
      ENCRYPTION_KEY: randomBytes(16).toString("hex"), AUTH_SECRET: randomBytes(32).toString("hex"),
      SITE_URL: "http://127.0.0.1:8200", TELEMETRY_ENABLED: "false", DISABLE_UPDATE_CHECK: "true", ...extraEnv
    });
    await ready(app);
    return app;
  } };
}

// One admin, organization and secrets project per instance, through the first-run API.
async function bootstrap(app, label) {
  const api = (path, options) => request(app, path, options);
  assert.equal((await api("/api/v1/admin/config")).config.initialized, false, `${label} instance is not fresh`);
  const owner = await api("/api/v1/admin/signup", { method: "POST",
    body: { email: `${run}-${label}@vaultix.invalid`, password, firstName: `Import ${label}`, organizationName: `Import ${label}` } });
  const { token } = await api("/api/v3/auth/select-organization", { method: "POST", token: owner.token, body: { organizationId: owner.organization.id } });
  const { project } = await api("/api/v1/projects", { method: "POST", token, body: { projectName: `Import ${label} Project` } });
  assert.ok(project.environments.some(environment => environment.slug === "dev"), `${label} project lacks a dev environment`);
  return { api, token, userId: owner.user.id, organization: owner.organization, project };
}

const createSecret = (instance, key, secretValue, secretPath) => instance.api(`/api/v4/secrets/${key}`, { method: "POST", token: instance.token,
  body: { projectId: instance.project.id, environment: "dev", secretPath, secretValue } });

// Target secrets by name, read through the target's own API; values compared in memory only.
async function targetSecrets(target) {
  const query = new URLSearchParams({ projectId: target.project.id, environment: "dev", secretPath: "/", viewSecretValue: "true", expandSecretReferences: "false" });
  const { secrets } = await target.api(`/api/v4/secrets?${query}`, { token: target.token });
  return new Map(secrets.map(secret => [secret.secretKey, secret.secretValue]));
}

// Raw call, for bodies that must be scanned for values or whose 4xx status may vary.
function raw(app, path, { method = "GET", body, token } = {}) {
  const response = http(app, path, { method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.ok(response, `HTTP connection failed during ${phase}`);
  return response;
}
function expectClientError(response, description) {
  assert.ok(response.status >= 400 && response.status < 500, `${description}: expected a 4xx response, got ${response.status}`);
  assert.equal(typeof JSON.parse(response.body).error, "string", `${description}: expected a plain error string`);
  assert.ok(!leaks(response.body), `${description}: the error carried a secret value`);
}

try {
  phase = "disposable services";
  harness.createNetwork(run);
  const sourceServices = startInstance("a");
  // The target reaches the source over the private test network, which the URL guard blocks by default.
  const targetServices = startInstance("b", { ALLOW_INTERNAL_IP_CONNECTIONS: "true" });
  const sourceApp = await sourceServices.start();
  const targetApp = await targetServices.start();
  const sourceUrl = `http://${sourceServices.appName}:8080`;

  phase = "source fixtures";
  const source = await bootstrap(sourceApp, "a");
  await source.api("/api/v2/folders", { method: "POST", token: source.token, body: { projectId: source.project.id, environment: "dev", name: "app", path: "/" } });
  for (const [key, secretValue] of Object.entries(sourceValues)) await createSecret(source, key, secretValue, "/app");
  const { identity } = await source.api("/api/v1/identities", { method: "POST", token: source.token,
    body: { name: "Provider import source", organizationId: source.organization.id, role: "member" } });
  await source.api(`/api/v1/projects/${source.project.id}/memberships/identities/${identity.id}`, { method: "POST", token: source.token,
    body: { roles: [{ role: "viewer", isTemporary: false }] } });
  const { identityUniversalAuth } = await source.api(`/api/v1/auth/universal-auth/identities/${identity.id}`, { method: "POST", token: source.token,
    body: { accessTokenTTL: 600, accessTokenMaxTTL: 600 } });
  const { clientSecret } = await source.api(`/api/v1/auth/universal-auth/identities/${identity.id}/client-secrets`, { method: "POST", token: source.token,
    body: { description: "Provider import proof" } });
  assert.match(identityUniversalAuth.clientId ?? "", /^[0-9a-f-]{36}$/, "Universal Auth did not issue a client ID");
  check("source: project, /app folder, three secrets and a viewer machine identity with Universal Auth");

  phase = "cross-instance source read";
  // The same calls the target's adapter makes, from inside the target container. Only names and
  // types come back; the values are compared to the fixtures inside the container.
  const remoteRead = docker(["exec", "-i", targetApp, "node", "-e", `let input="";process.stdin.on("data",b=>input+=b).on("end",async()=>{
    try { const q=JSON.parse(input); const login=await fetch(q.url+"/api/v1/auth/universal-auth/login",{method:"POST",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({clientId:q.clientId,clientSecret:q.clientSecret}),signal:AbortSignal.timeout(20000)});
      const {accessToken}=await login.json();
      const params=new URLSearchParams({workspaceId:q.projectId,environment:"dev",secretPath:"/app",recursive:"false",include_imports:"false",expandSecretReferences:"false"});
      const r=await fetch(q.url+"/api/v3/secrets/raw?"+params,{headers:{Authorization:"Bearer "+accessToken},signal:AbortSignal.timeout(20000)});
      const body=await r.json();
      process.stdout.write(JSON.stringify({login:login.status,status:r.status,secrets:(body.secrets??[]).map(s=>({key:s.secretKey,type:s.type,matches:q.expected[s.secretKey]===s.secretValue}))}));
    } catch { process.exitCode=1; }
  });`], { input: JSON.stringify({ url: sourceUrl, clientId: identityUniversalAuth.clientId, clientSecret, projectId: source.project.id, expected: sourceValues }), allowFailure: true, timeout: 60_000 });
  assert.equal(remoteRead.status, 0, "The target container could not run the source read");
  const remote = JSON.parse(remoteRead.stdout.toString());
  assert.ok(remote.login === 200 && remote.status === 200, `Source API refused the machine identity (login ${remote.login}, read ${remote.status})`);
  assert.deepEqual(remote.secrets.map(secret => secret.key).sort(), Object.keys(sourceValues).sort(), "Source API returned unexpected secret names");
  assert.ok(remote.secrets.every(secret => secret.type === "shared" && secret.matches), "Source API returned unexpected secret types or values");
  check("target container reaches the source over the private network; the machine identity reads /app through /api/v3/secrets/raw");

  phase = "target fixtures";
  const target = await bootstrap(targetApp, "b");
  await createSecret(target, "PI_BETA", targetBetaValue, "/");
  const { appConnection } = await target.api("/api/v1/app-connections/external-vaultix", { method: "POST", token: target.token,
    body: { name: "provider-import-source", method: "machine-identity-universal-auth",
      credentials: { instanceUrl: sourceUrl, machineIdentityClientId: identityUniversalAuth.clientId, machineIdentityClientSecret: clientSecret } } });
  assert.ok(appConnection.id && appConnection.app === "external-vaultix", "The target did not create the instance connection");
  const listedConnection = await target.api(`/api/v1/app-connections/external-vaultix/${appConnection.id}`, { token: target.token });
  assert.ok(!JSON.stringify(listedConnection).includes(clientSecret), "The connection response returned its client secret");
  check("target: pre-existing PI_BETA and a validated external-vaultix connection to the source (client secret not returned)");

  const policyName = `pimport-${randomBytes(3).toString("hex")}`;
  const createPolicy = () => target.api("/api/v2/secret-approvals", { method: "POST", token: target.token,
    body: { projectId: target.project.id, name: policyName, environment: "dev", secretPath: "/", approvers: [{ type: "user", id: target.userId }], approvals: 1 } });
  if (preflightOnly) {
    phase = "preflight fixtures";
    // Proves the policy and value-read payloads on images without the import routes, then stops.
    const { approval } = await createPolicy();
    assert.ok(approval.id, "The target did not create the approval policy");
    const before = await targetSecrets(target);
    assert.ok(before.get("PI_BETA") === targetBetaValue && before.size === 1, "Unexpected target secrets");
    check("preflight: approval policy payload accepted and target secrets readable through the API");
    report.passed = true;
  } else {
    const scope = { connectionId: appConnection.id,
      source: { project: source.project.id, environment: "dev", secretPath: "/app" },
      target: { projectId: target.project.id, environment: "dev", secretPath: "/" } };
    const route = path => `/api/v3/external-migration${path}`;

    phase = "provider runtime";
    const runtime = await target.api(route(`/providers?projectId=${target.project.id}`), { token: target.token });
    const byProvider = new Map(runtime.providers.map(provider => [provider.provider, provider]));
    const instance = byProvider.get("external-vaultix"), doppler = byProvider.get("doppler");
    assert.ok(instance && doppler, "Runtime must list both providers");
    assert.deepEqual(instance.connections.map(connection => connection.id), [appConnection.id], "Runtime lost the instance connection");
    assert.deepEqual(doppler.connections, [], "Runtime invented a Doppler connection");
    for (const provider of [instance, doppler]) {
      assert.deepEqual(provider.lifecycle, ["review", "approve", "import"], "Unexpected lifecycle");
      assert.equal(provider.referenceSafe, true, "Provider is not reference-safe");
      assert.equal(provider.unavailableReason, null, "A provider whose connections were listed reported itself unavailable");
    }
    assert.ok(!leaks(JSON.stringify(runtime)), "Runtime carried a secret value");
    check("runtime lists the external-vaultix connection and Doppler with no connections");

    phase = "review";
    const reviewKeys = review => Object.fromEntries(review.keys.map(entry => [entry.key, entry.action]));
    const firstRaw = raw(targetApp, route("/providers/external-vaultix/review"), { method: "POST", token: target.token, body: scope });
    assert.equal(firstRaw.status, 200, `Review failed with ${firstRaw.status}`);
    assert.ok(!leaks(firstRaw.body), "Review response carried a secret value");
    const first = JSON.parse(firstRaw.body);
    assert.ok(first.sourceCount === 3 && first.createCount === 2 && first.existingCount === 1, "Unexpected review counts");
    // An admin reviewing values a viewer identity can read: no "denied" or "unreadable" keys expected.
    assert.deepEqual(reviewKeys(first), { PI_ALPHA: "create", PI_BETA: "exists", PI_GAMMA: "create" }, "Unexpected review plan");
    assert.ok(first.approvalRequired === false && first.approvalPolicyName === null, "Review reported an approval policy that does not exist");
    check("review: three source names, PI_BETA marked existing, no approval policy, no values in the response");

    phase = "import";
    const importedRaw = raw(targetApp, route("/providers/external-vaultix/import"), { method: "POST", token: target.token, body: { ...scope, keys: ["PI_ALPHA"] } });
    assert.equal(importedRaw.status, 200, `Import failed with ${importedRaw.status}`);
    assert.ok(!leaks(importedRaw.body), "Import response carried a secret value");
    const imported = JSON.parse(importedRaw.body);
    assert.ok(imported.status === "imported" && imported.imported === 1 && imported.skipped === 1 && imported.approvalRequestId === null, "Unexpected import result");
    const afterImport = await targetSecrets(target);
    assert.ok(afterImport.get("PI_ALPHA") === sourceValues.PI_ALPHA, "PI_ALPHA did not arrive with the source value");
    assert.ok(!afterImport.has("PI_GAMMA"), "An unapproved secret was imported");
    assert.ok(afterImport.get("PI_BETA") === targetBetaValue, "The existing PI_BETA was overwritten");
    check("import: only the approved PI_ALPHA written, with the source value; PI_BETA kept; PI_GAMMA left out");

    phase = "stale review";
    const stale = raw(targetApp, route("/providers/external-vaultix/import"), { method: "POST", token: target.token, body: { ...scope, keys: ["PI_ALPHA"] } });
    assert.equal(stale.status, 400, `Stale import returned ${stale.status}`);
    expectClientError(stale, "Stale import");
    assert.equal(JSON.parse(stale.body).error, "StaleImportReview", "Stale import was refused for another reason");
    const afterStale = await targetSecrets(target);
    assert.ok(afterStale.size === afterImport.size && [...afterStale].every(([key, secretValue]) => afterImport.get(key) === secretValue), "A stale import changed the target");
    check("re-importing a key that now exists is refused as a stale review, nothing changed");

    phase = "approval policy";
    const { approval } = await createPolicy();
    assert.ok(approval.id, "The target did not create the approval policy");
    const governedRaw = raw(targetApp, route("/providers/external-vaultix/review"), { method: "POST", token: target.token, body: scope });
    assert.equal(governedRaw.status, 200, `Governed review failed with ${governedRaw.status}`);
    assert.ok(!leaks(governedRaw.body), "Governed review carried a secret value");
    const governed = JSON.parse(governedRaw.body);
    assert.ok(governed.approvalRequired === true && governed.approvalPolicyName === policyName, "Review did not report the approval policy");
    assert.deepEqual(reviewKeys(governed), { PI_ALPHA: "exists", PI_BETA: "exists", PI_GAMMA: "create" }, "Unexpected governed review plan");
    const requestedRaw = raw(targetApp, route("/providers/external-vaultix/import"), { method: "POST", token: target.token, body: { ...scope, keys: ["PI_GAMMA"] } });
    assert.equal(requestedRaw.status, 200, `Governed import failed with ${requestedRaw.status}`);
    assert.ok(!leaks(requestedRaw.body), "Governed import carried a secret value");
    const requested = JSON.parse(requestedRaw.body);
    assert.ok(requested.status === "approval-required" && requested.imported === 0 && typeof requested.approvalRequestId === "string" && requested.approvalRequestId.length > 0, "Governed import did not open a change request");
    assert.ok(!(await targetSecrets(target)).has("PI_GAMMA"), "A governed import wrote before approval");
    check("approval policy: review reports it, import opens a change request and writes nothing yet");

    phase = "invalid requests";
    expectClientError(raw(targetApp, route("/providers/external-vaultix/review"), { method: "POST", token: target.token, body: { ...scope, connectionId: randomUUID() } }), "Unknown connection");
    expectClientError(raw(targetApp, route("/providers/doppler/review"), { method: "POST", token: target.token, body: scope }), "Connection of another provider");
    const anonymous = raw(targetApp, route("/providers/external-vaultix/review"), { method: "POST", body: scope });
    assert.equal(anonymous.status, 401, `Anonymous review returned ${anonymous.status}`);
    check("unknown connection, mismatched provider and anonymous review are refused with plain errors");
    report.passed = true;
  }
} catch (error) {
  report.failure = { phase, message: error.code === "ERR_ASSERTION" ? error.message : "Provider import operation failed; raw diagnostics withheld." };
  process.exitCode = 1;
} finally {
  phase = "cleanup";
  report.cleanupPassed = harness.cleanup();
  if (!report.cleanupPassed) { report.passed = false; process.exitCode = 1; }
  writeFileSync(resolve(evidence, "result.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ passed: report.passed, preflightOnly, checks: report.checks, failure: report.failure, cleanupPassed: report.cleanupPassed, evidence }));
}
