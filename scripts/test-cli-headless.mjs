// Real CLI -> packaged Vaultix proof. Credentials stay in stdin/process memory
// and disposable private storage. No operator account or live issuer is used.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDisposableImageHarness } from "./lib/disposable-image.mjs";

assert.equal(process.argv.length, 4, "Usage: node scripts/test-cli-headless.mjs <image> <linux-amd64-cli>");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let phase = "image inspection";
const harness = createDisposableImageHarness(process.argv[2], () => phase);
const { artifact, container, docker, request, ready, waitFor } = harness;
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache/cli-headless-"));
const run = `vaultix-cli-${randomBytes(8).toString("hex")}`;
const report = { passed: false, artifact, cliSha256: createHash("sha256").update(readFileSync(resolve(process.argv[3]))).digest("hex"), checks: [], exclusions: ["live Nomen issuer", "refresh/revocation of Nomen sessions", "interactive Codex inference", "full feature parity"] };
const check = name => { report.checks.push(name); console.log(`Vaultix CLI: ${name}`); };
const password = `Vx9!${randomBytes(32).toString("hex")}`;
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
  phase = "install disposable CLI artifact";
  docker(["cp", resolve(process.argv[3]), `${app}:/tmp/vaultix-cli`]);
  docker(["exec", "--user", "0", app, "chmod", "755", "/tmp/vaultix-cli"]);
  docker(["exec", app, "mkdir", "-m", "700", "/tmp/vaultix-cli-home"]);
  const api = (path, options) => request(app, path, options);
  const connections = await api("/api/v1/vaultix/connections");
  assert.ok(connections.access.includes("vaultix auth status") && connections.access.includes("vaultix mcp config"), "Packaged connection guidance is stale");
  check("packaged UI/MCP connection catalog explains local authenticated setup");
  const sensitive = [password, databasePassword, canary];
  const cli = (args, input = "", success = true) => {
    const r = docker(["exec", "-i", "-e", "VAULTIX_HOME=/tmp/vaultix-cli-home", app, "/tmp/vaultix-cli", ...args], { input, allowFailure: true });
    assert.ok(!r.error && (r.status === 0) === success, `CLI result mismatch during ${phase}`);
    const output = r.stdout.toString(), diagnostics = r.stderr.toString();
    assert.ok(sensitive.every(value => !output.includes(value) && !diagnostics.includes(value)), "CLI disclosed a sensitive canary");
    return output;
  };
  phase = "provisioning";
  const owner = await api("/api/v1/admin/signup", { method: "POST", body: { email: `${run}@vaultix.invalid`, password, firstName: "CLI", organizationName: "CLI Proof" } });
  const { token: admin } = await api("/api/v3/auth/select-organization", { method: "POST", token: owner.token, body: { organizationId: owner.organization.id } });
  sensitive.push(admin, owner.token);
  const { project } = await api("/api/v1/projects", { method: "POST", token: admin, body: { projectName: "CLI Proof Project" } });
  const { identity } = await api("/api/v1/identities", { method: "POST", token: admin, body: { name: "CLI Machine", organizationId: owner.organization.id, role: "member" } });
  await api(`/api/v1/projects/${project.id}/memberships/identities/${identity.id}`, { method: "POST", token: admin, body: { roles: [{ role: "admin", isTemporary: false }] } });
  await api(`/api/v1/auth/token-auth/identities/${identity.id}`, { method: "POST", token: admin, body: { accessTokenTTL: 600, accessTokenMaxTTL: 600 } });
  const issued = await api(`/api/v1/auth/token-auth/identities/${identity.id}/tokens`, { method: "POST", token: admin, body: { name: "CLI proof" } });
  sensitive.push(issued.accessToken);
  const scope = { projectId: project.id, environment: "dev", secretPath: "/" };
  await api("/api/v4/secrets/CLI_REFERENCE", { method: "POST", token: issued.accessToken, body: { ...scope, secretValue: canary, secretComment: canary } });
  const login = ["login", "--api", "http://127.0.0.1:8080", "--credential-file", "/tmp/vaultix-cli-home/credential.json"];
  phase = "invalid credential";
  cli([...login, "--token"], "invalid-fixture-token\n", false);
  check("healthy application rejects invalid CLI login");
  phase = "protected login";
  cli([...login, "--token"], `${issued.accessToken}\n`);
  cli(["auth", "status"]);
  check("token login saves private credentials only after protected access succeeds");
  phase = "MCP protocol and references";
  const messages = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "vaultix-cli-proof", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "vaultix.projects.list", arguments: {} } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "vaultix.secrets.references", arguments: scope } }
  ];
  const lines = cli(["mcp"], messages.map(m => JSON.stringify(m)).join("\n")+"\n").trim().split("\n").map(JSON.parse);
  assert.equal(lines.length, 4, "MCP must not respond to initialized notification");
  assert.ok(lines[1].result.tools.some(tool => tool.name === "vaultix.secrets.references"), "Authenticated tools missing");
  assert.equal(JSON.parse(lines[2].result.content[0].text).projects[0].id, project.id);
  const refs = JSON.parse(lines[3].result.content[0].text).references;
  assert.equal(refs[0].name, "CLI_REFERENCE");
  assert.deepEqual(Object.keys(refs[0]).sort(), ["createdAt", "id", "name", "updatedAt", "version"]);
  check("stdio initialization, notification, tool discovery and authorized metadata reads pass without values");
  assert.ok(cli(["mcp", "config"]).includes("[mcp_servers.vaultix]"), "Missing config fragment");
  check("configuration fragment contains no credentials");
  phase = "revoked access";
  await api(`/api/v1/auth/token-auth/tokens/${issued.tokenData.id}/revoke`, { method: "POST", token: admin, body: {} });
  cli(["auth", "status"], "", false);
  cli(["mcp"], JSON.stringify(messages[0])+"\n", false);
  check("server revocation denies CLI status and MCP startup");
  phase = "machine login";
  const attached = await api(`/api/v1/auth/universal-auth/identities/${identity.id}`, { method: "POST", token: admin, body: { accessTokenTTL: 600, accessTokenMaxTTL: 600 } });
  const secret = await api(`/api/v1/auth/universal-auth/identities/${identity.id}/client-secrets`, { method: "POST", token: admin, body: {} });
  sensitive.push(secret.clientSecret);
  cli([...login, "--universal"], `${attached.identityUniversalAuth.clientId}\n${secret.clientSecret}\n`);
  cli(["auth", "status"]);
  const machineReply = cli(["mcp"], JSON.stringify(messages[3])+"\n");
  assert.ok(JSON.parse(JSON.parse(machineReply).result.content[0].text).projects.some(p => p.id === project.id));
  check("machine identity login obtains scoped access for the same MCP actions");
  phase = "logout";
  cli(["logout"]);
  cli(["auth", "status"], "", false);
  cli(["mcp"], "", false);
  check("local logout removes saved access for subsequent CLI and MCP calls");
  report.passed = true;
} catch (error) {
  report.failure = { phase, message: error.code === "ERR_ASSERTION" ? error.message : "Operation failed; raw diagnostics withheld." };
  process.exitCode = 1;
} finally {
  phase = "cleanup";
  report.cleanupPassed = harness.cleanup();
  if (!report.cleanupPassed) { report.passed = false; process.exitCode = 1; }
  writeFileSync(resolve(evidence, "result.json"), JSON.stringify(report, null, 2)+"\n", { mode: 0o600 });
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failure: report.failure, cleanupPassed: report.cleanupPassed, evidence }));
}
