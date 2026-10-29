// Real-image proxy/IP authorization proof on disposable infrastructure only.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDisposableImageHarness } from "./lib/disposable-image.mjs";

assert.equal(process.argv.length, 3, "Usage: node scripts/test-proxy-boundary.mjs <local-standalone-image>");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let phase = "image inspection";
const harness = createDisposableImageHarness(process.argv[2], () => phase);
const { artifact, container, docker, request, ready, waitFor } = harness;
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache/proxy-boundary-"));
const run = `vaultix-proxy-${randomBytes(8).toString("hex")}`;
const report = { passed: false, artifact, checks: [], exclusions: ["real edge/TLS deployment", "distributed quotas", "all identity methods", "public cloud readiness"] };
const check = name => { report.checks.push(name); console.log(`Vaultix proxy: ${name}`); };
const password = `Vx9!${[...randomBytes(24)].map(byte => byte.toString(16).padStart(2, "0")).join("-")}`;
const databasePassword = randomBytes(24).toString("hex");
try {
  phase = "disposable services";
  harness.createNetwork(run);
  const dbName = `${run}-db`, cacheName = `${run}-cache`;
  const db = container(dbName, "postgres:16.6-alpine", [], { POSTGRES_USER: "vaultix", POSTGRES_DB: "vaultix", POSTGRES_PASSWORD: databasePassword });
  const cache = container(cacheName, "docker.dragonflydb.io/dragonflydb/dragonfly:v1.34.2", ["--default_lua_flags=allow-undeclared-keys", "--cache_mode=false", "--maxmemory=512mb", "--proactor_threads=2"]);
  await waitFor(() => docker(["exec", db, "pg_isready", "-U", "vaultix", "-d", "vaultix"], { allowFailure: true }).status === 0, "database readiness");
  await waitFor(() => docker(["exec", cache, "redis-cli", "ping"], { allowFailure: true }).status === 0, "cache readiness");
  const env = { DB_CONNECTION_URI: `postgres://vaultix:${databasePassword}@${dbName}:5432/vaultix`,
    VAULTIX_CACHE_PROVIDER: "dragonfly", VAULTIX_CACHE_URL: `redis://${cacheName}:6379`,
    ENCRYPTION_KEY: randomBytes(16).toString("hex"), AUTH_SECRET: randomBytes(32).toString("hex"),
    SITE_URL: "http://127.0.0.1:8200", TELEMETRY_ENABLED: "false", DISABLE_UPDATE_CHECK: "true" };
  const direct = container(`${run}-direct`, artifact.id, [], env);
  await ready(direct);
  phase = "API-created scoped identities";
  const owner = await request(direct, "/api/v1/admin/signup", { method: "POST", body: { email: `${run}@vaultix.invalid`, password, firstName: "Proxy", organizationName: "Proxy boundary proof" } });
  const { token: admin } = await request(direct, "/api/v3/auth/select-organization", { method: "POST", token: owner.token, body: { organizationId: owner.organization.id } });
  const { project } = await request(direct, "/api/v1/projects", { method: "POST", token: admin, body: { projectName: "Proxy proof" } });
  const tokens = [];
  for (const [index, ipAddress] of ["127.0.0.1/32", "198.51.100.77/32"].entries()) {
    const { identity } = await request(direct, "/api/v1/identities", { method: "POST", token: admin, body: { name: `Network scoped ${index}`, organizationId: owner.organization.id, role: "member" } });
    await request(direct, `/api/v1/projects/${project.id}/memberships/identities/${identity.id}`, { method: "POST", token: admin, body: { roles: [{ role: "admin", isTemporary: false }] } });
    await request(direct, `/api/v1/auth/token-auth/identities/${identity.id}`, { method: "POST", token: admin, body: { accessTokenTTL: 600, accessTokenMaxTTL: 600, accessTokenTrustedIps: [{ ipAddress }] } });
    const issued = await request(direct, `/api/v1/auth/token-auth/identities/${identity.id}/tokens`, { method: "POST", token: admin, body: { name: "Disposable proxy proof" } });
    tokens.push(issued.accessToken);
  }
  const inspect = (app, token, headers, allowed, mcp = false) => {
    const response = harness.http(app, mcp ? "/api/v1/vaultix/mcp" : "/api/v1/vaultix/projects", {
      method: mcp ? "POST" : "GET", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...headers },
      ...(mcp ? { body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "vaultix.projects.list", arguments: {} } }) } : {}) });
    assert.ok(response && (allowed ? response.status === 200 : [403, 404].includes(response.status)), `Expected ${allowed ? "access" : "denial"} but got HTTP ${response?.status ?? "none"} during ${phase}`);
    assert.ok(tokens.every(value => !response.body.includes(value)), "A credential was reflected");
    const body = JSON.parse(response.body);
    if (allowed) {
      const data = mcp ? JSON.parse(body.result.content[0].text) : body;
      assert.ok(data.projects.length === 1 && data.projects[0].id === project.id, "Scoped project access changed");
    } else assert.equal(typeof body.error, "string", "Expected a plain denial error");
  };
  phase = "direct identity allowlist";
  for (const mcp of [false, true]) { inspect(direct, tokens[0], {}, true, mcp); inspect(direct, tokens[1], {}, false, mcp); }
  check("socket address governs real HTTP/MCP machine-identity allowlists");
  phase = "forged direct identity headers";
  for (const header of ["x-forwarded-for", "cf-connecting-ip", "x-real-ip"]) {
    for (const mcp of [false, true]) {
      inspect(direct, tokens[1], { [header]: "198.51.100.77" }, false, mcp);
      inspect(direct, tokens[0], { [header]: "198.51.100.77" }, true, mcp);
    }
  }
  check("forged forwarding/vendor headers cannot grant denied access or block allowed access");
  phase = "native rate-limit header rotation";
  const probe = `const statuses=[];let plain=false,retry=false;for(let i=0;i<121;i++){const r=await fetch('http://127.0.0.1:8080/api/v1/vaultix/catalog',{headers:{'x-forwarded-for':'198.51.100.'+i,'cf-connecting-ip':'198.51.100.'+i},signal:AbortSignal.timeout(5000)});statuses.push(r.status);if(i===120){plain=typeof (await r.json()).error==='string';retry=Number(r.headers.get('retry-after'))>0;}else await r.arrayBuffer();}console.log(JSON.stringify({statuses,plain,retry}));`;
  const limited = JSON.parse(harness.output(["exec", direct, "node", "--input-type=module", "-e", probe]));
  assert.deepEqual(limited.statuses, [...Array(120).fill(200), 429]);
  assert.ok(limited.plain && limited.retry, "Rate denial lacks plain error or retry guidance");
  check("rotating forwarded headers cannot reset the native route budget");
  phase = "explicit proxy compatibility";
  harness.output(["stop", direct]);
  const trusted = container(`${run}-trusted`, artifact.id, [], { ...env, TRUSTED_PROXY_CIDRS: "127.0.0.1/32,::1/128" });
  await ready(trusted);
  for (const mcp of [false, true]) {
    inspect(trusted, tokens[1], { "x-forwarded-for": "198.51.100.77" }, true, mcp);
    inspect(trusted, tokens[0], { "x-forwarded-for": "198.51.100.77" }, false, mcp);
    inspect(trusted, tokens[1], { "x-forwarded-for": "198.51.100.77,203.0.113.66", "cf-connecting-ip": "198.51.100.77" }, false, mcp);
    inspect(trusted, tokens[0], { "cf-connecting-ip": "198.51.100.77" }, true, mcp);
  }
  check("explicit trusted peer preserves forwarding and stops at the nearest untrusted hop");
  report.passed = true;
} catch (error) {
  report.failure = { phase, message: error.code === "ERR_ASSERTION" ? error.message : "Proxy proof failed; raw diagnostics withheld." };
  process.exitCode = 1;
} finally {
  phase = "cleanup";
  report.cleanupPassed = harness.cleanup();
  if (!report.cleanupPassed) { report.passed = false; process.exitCode = 1; }
  writeFileSync(resolve(evidence, "result.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failure: report.failure, cleanupPassed: report.cleanupPassed, evidence }));
}
