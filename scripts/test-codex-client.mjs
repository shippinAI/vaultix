// Real installed Codex -> native Vaultix CLI -> canonical image acceptance.
// Only disposable accounts/containers are provisioned. No model credential is
// read, copied, or supplied by this harness; Codex owns its existing sign-in.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDisposableImageHarness } from "./lib/disposable-image.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
assert.ok(process.argv.length <= 3, "Usage: node scripts/test-codex-client.mjs [inputs.json]");
const inputs = JSON.parse(readFileSync(resolve(root, process.argv[2] ?? ".cache/codex-client-inputs.json")));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
assert.match(inputs.image, /^sha256:[a-f0-9]{64}$/);
assert.match(inputs.cliSha256, /^[a-f0-9]{64}$/);
assert.equal(hash(readFileSync(inputs.cli)), inputs.cliSha256, "CLI does not match its accepted receipt");
let phase = "inspection";
const h = createDisposableImageHarness(inputs.image, () => phase);
const { docker, container, request, ready, waitFor } = h;
const native = (args, options = {}) =>
  spawnSync(inputs.codex ?? "codex", ["--version", ...args], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10000,
    ...options
  });
const clientVersion = native([]);
assert.equal(clientVersion.status, 0, "An installed Codex CLI is required");
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache/codex-client-"));
const workspace = mkdtempSync(resolve(tmpdir(), "vaultix-codex-client-"));
const run = `vaultix-codex-${randomBytes(8).toString("hex")}`;
const sensitive = [
  `Vx9!${[...randomBytes(24)].map((b) => b.toString(16).padStart(2, "0")).join("-")}`,
  randomBytes(24).toString("hex"),
  randomBytes(32).toString("hex")
];
const [password, databasePassword, canary] = sensitive;
const report = {
  passed: false,
  artifact: h.artifact,
  cliSha256: inputs.cliSha256,
  codex: clientVersion.stdout.trim(),
  checks: [],
  clientRuns: [],
  limitations: [
    "Disposable account and reference fixtures; no operator data",
    "Explicit token authentication; built-in browser CLI login remains unfinished",
    "No MCP graphical rendering or manual accessibility acceptance",
    "No production deployment or complete enterprise parity"
  ]
};
const check = (message) => {
  report.checks.push(message);
  console.log(`Vaultix real Codex: ${message}`);
};
const safe = (text) => sensitive.every((value) => !text.includes(value));
const encode = (value) => JSON.stringify(value); // TOML basic strings/arrays, never shell text.
let app;
const cli = (args, input = "", success = true) => {
  const p = docker(["exec", "-i", "-e", "VAULTIX_HOME=/tmp/vaultix-codex-home", app, "/tmp/vaultix", ...args], {
    input,
    allowFailure: true
  });
  assert.ok(!p.error && (p.status === 0) === success, `CLI failed during ${phase}`);
  assert.ok(safe(p.stdout.toString()) && safe(p.stderr.toString()), "CLI disclosed a fixture credential/value");
  return p.stdout.toString();
};
async function codex(label, prompt, expectDenial = false) {
  const args = [
    "exec",
    "--ignore-user-config",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--json",
    "--color",
    "never",
    "-C",
    workspace,
    "--disable",
    "apps",
    "--disable",
    "plugins",
    "--disable",
    "browser_use",
    "--disable",
    "computer_use",
    "--disable",
    "multi_agent",
    "-c",
    'mcp_servers.vaultix.command="docker"',
    "-c",
    `mcp_servers.vaultix.args=${encode(["exec", "-i", "-e", "VAULTIX_HOME=/tmp/vaultix-codex-home", app, "/tmp/vaultix", "mcp"])}`,
    "-c",
    "mcp_servers.vaultix.startup_timeout_sec=20",
    "-c",
    "mcp_servers.vaultix.enabled=true",
    "-c",
    "mcp_servers.vaultix.required=true",
    "-c",
    "mcp_servers.vaultix.tool_timeout_sec=30",
    "-c",
    "features.shell_tool=false",
    prompt
  ];
  const p = spawn(inputs.codex ?? "codex", args, {
    cwd: workspace,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "",
    stderr = "",
    overflow = false,
    timedOut = false;
  const collect = (field, data) => {
    if (stdout.length + stderr.length + data.length > 4 * 1024 * 1024) {
      overflow = true;
      p.kill();
      return;
    }
    if (field === "out") stdout += data;
    else stderr += data;
  };
  p.stdout.on("data", (b) => collect("out", b.toString()));
  p.stderr.on("data", (b) => collect("err", b.toString()));
  const timer = setTimeout(() => {
    timedOut = true;
    p.kill();
  }, 120000);
  const exit = await new Promise((done, reject) => {
    p.once("error", reject);
    p.once("exit", done);
  }).finally(() => clearTimeout(timer));
  assert.ok(safe(stdout) && safe(stderr), "Real AI client received or disclosed a fixture credential/value");
  const events = stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const visibleEvents = events.filter((event) => event.item?.type !== "reasoning");
  const visibleOutput = visibleEvents.map((event) => JSON.stringify(event)).join("\n") + "\n";
  writeFileSync(resolve(evidence, label + ".jsonl"), visibleOutput, { mode: 0o600 });
  writeFileSync(resolve(evidence, label + ".stderr.txt"), stderr, { mode: 0o600 });
  report.clientRuns.push({
    label,
    exit,
    timedOut,
    overflow,
    eventsSha256: hash(visibleOutput),
    diagnosticsSha256: hash(stderr)
  });
  assert.ok(!timedOut && !overflow, "Real Codex client timed out or exceeded the output limit");
  if (expectDenial) {
    assert.ok(Number.isInteger(exit) && exit !== 0, "Revoked required MCP connection did not fail client startup");
    assert.match(
      stderr,
      /required MCP servers failed to initialize: vaultix/i,
      "Client failed for a reason other than the required Vaultix connection"
    );
  } else assert.equal(exit, 0, "Real Codex client did not complete successfully");
  const items = events.filter((e) => e.type === "item.completed").map((e) => e.item);
  assert.ok(
    !items.some((item) => ["command_execution", "web_search", "file_change"].includes(item.type)),
    "Client used an unrequested shell/web/file tool"
  );
  return { events, items, stderr };
}
function toolContent(item) {
  const result = item.result;
  if (!result || result.isError || item.error) return null;
  const texts = result.content?.filter((c) => c.type === "text").map((c) => c.text) ?? [];
  for (const text of texts) {
    try {
      return JSON.parse(text);
    } catch {}
  }
  return null;
}
try {
  phase = "disposable instance";
  h.createNetwork(run);
  const dbName = run + "-db",
    cacheName = run + "-cache";
  const db = container(dbName, "postgres:16.6-alpine", [], {
    POSTGRES_USER: "vaultix",
    POSTGRES_DB: "vaultix",
    POSTGRES_PASSWORD: databasePassword
  });
  const cache = container(cacheName, "docker.dragonflydb.io/dragonflydb/dragonfly:v1.34.2", [
    "--default_lua_flags=allow-undeclared-keys",
    "--cache_mode=false",
    "--maxmemory=512mb",
    "--proactor_threads=2"
  ]);
  await waitFor(
    () => docker(["exec", db, "pg_isready", "-U", "vaultix", "-d", "vaultix"], { allowFailure: true }).status === 0,
    "database"
  );
  await waitFor(() => docker(["exec", cache, "redis-cli", "ping"], { allowFailure: true }).status === 0, "cache");
  app = container(run + "-app", h.artifact.id, [], {
    DB_CONNECTION_URI: `postgres://vaultix:${databasePassword}@${dbName}:5432/vaultix`,
    VAULTIX_CACHE_PROVIDER: "dragonfly",
    VAULTIX_CACHE_URL: `redis://${cacheName}:6379`,
    ENCRYPTION_KEY: randomBytes(16).toString("hex"),
    AUTH_SECRET: randomBytes(32).toString("hex"),
    SITE_URL: "http://127.0.0.1:8200",
    TELEMETRY_ENABLED: "false",
    DISABLE_UPDATE_CHECK: "true"
  });
  await ready(app);
  docker(["cp", inputs.cli, `${app}:/tmp/vaultix`]);
  docker(["exec", "--user", "0", app, "chmod", "755", "/tmp/vaultix"]);
  docker(["exec", app, "mkdir", "-m", "700", "/tmp/vaultix-codex-home"]);
  const api = (path, opts) => request(app, path, opts);
  phase = "independent API provisioning";
  const owner = await api("/api/v1/admin/signup", {
    method: "POST",
    body: {
      email: `${run}@vaultix.invalid`,
      password,
      firstName: "Client proof",
      organizationName: "Disposable AI proof"
    }
  });
  const { token } = await api("/api/v3/auth/select-organization", {
    method: "POST",
    token: owner.token,
    body: { organizationId: owner.organization.id }
  });
  sensitive.push(token, owner.token);
  const projectName = "Codex proof " + randomBytes(5).toString("hex");
  const { project } = await api("/api/v1/projects", { method: "POST", token, body: { projectName } });
  const { identity } = await api("/api/v1/identities", {
    method: "POST",
    token,
    body: { name: "Disposable reference client", organizationId: owner.organization.id, role: "member" }
  });
  await api(`/api/v1/projects/${project.id}/memberships/identities/${identity.id}`, {
    method: "POST",
    token,
    body: { roles: [{ role: "admin", isTemporary: false }] }
  });
  await api(`/api/v1/auth/token-auth/identities/${identity.id}`, {
    method: "POST",
    token,
    body: { accessTokenTTL: 600, accessTokenMaxTTL: 600 }
  });
  const issued = await api(`/api/v1/auth/token-auth/identities/${identity.id}/tokens`, {
    method: "POST",
    token,
    body: { name: "Actual Codex proof" }
  });
  sensitive.push(issued.accessToken);
  const reference = "CODEX_REFERENCE_" + randomBytes(5).toString("hex").toUpperCase();
  const scope = { projectId: project.id, environment: "dev", secretPath: "/" };
  await api("/api/v4/secrets/" + reference, {
    method: "POST",
    token,
    body: { ...scope, secretValue: canary, secretComment: canary }
  });
  phase = "native authentication";
  const login = [
    "login",
    "--domain",
    "http://127.0.0.1:8080",
    "--credential-file",
    "/tmp/vaultix-codex-home/credential.json",
    "--token"
  ];
  cli(login, "invalid-fixture\n", false);
  cli(login, issued.accessToken + "\n");
  cli(["auth", "status"]);
  check("Native CLI rejects invalid authentication and verifies real protected access before saving");
  phase = "actual Codex metadata access";
  const prompt =
    "This is a Vaultix MCP acceptance test. Discover the configured vaultix MCP tools if tool discovery is needed, then use only those tools; do not run shell commands, access files, browse, or edit anything. First call vaultix.projects.list. Find the only available project, then call vaultix.secrets.references for that project ID, environment dev, secretPath /. Return the observed project name and secret reference names. Never request or guess secret values. If the MCP server is unavailable or a tool fails, report that honestly without fabricating data.";
  const positive = await codex("authorized", prompt);
  const calls = positive.items.filter((item) => item.type === "mcp_tool_call");
  const projects = calls
    .filter((item) => item.server === "vaultix" && item.tool === "vaultix.projects.list")
    .map(toolContent)
    .find((value) => value?.projects?.some((p) => p.id === project.id && p.name === projectName));
  assert.ok(projects, "Actual Codex did not invoke the native project tool and observe the provisioned project");
  const refs = calls
    .filter((item) => item.server === "vaultix" && item.tool === "vaultix.secrets.references")
    .map(toolContent)
    .find((value) => value?.references?.some((r) => r.name === reference));
  assert.ok(refs, "Actual Codex did not invoke the native reference tool");
  for (const item of refs.references)
    assert.deepEqual(Object.keys(item).sort(), ["createdAt", "id", "name", "updatedAt", "version"]);
  check("Installed Codex invokes project and reference tools through the native CLI; output contains metadata only");
  phase = "revocation and client denial";
  await api(`/api/v1/auth/token-auth/tokens/${issued.tokenData.id}/revoke`, { method: "POST", token, body: {} });
  cli(["auth", "status"], "", false);
  cli(["mcp"], "", false);
  const denied = await codex("revoked", prompt, true);
  assert.ok(
    !denied.items.some((item) => item.type === "mcp_tool_call" && toolContent(item)?.references),
    "Revoked client obtained references"
  );
  assert.ok(
    !JSON.stringify(denied.events).includes(reference) && !JSON.stringify(denied.events).includes(projectName),
    "Revoked client received protected fixture metadata"
  );
  assert.match(denied.stderr, /vaultix|MCP/i, "Client did not report unavailable MCP connection");
  check("Server revocation denies native access and a new real Codex connection without disclosing protected metadata");
  report.passed = true;
} catch (error) {
  report.failure = {
    phase,
    message:
      error.code === "ERR_ASSERTION" ? error.message.split("\n")[0] : "Operation failed; raw diagnostics withheld"
  };
  process.exitCode = 1;
} finally {
  report.cleanupPassed = h.cleanup();
  try {
    assert.equal(dirname(workspace), resolve(tmpdir()));
    assert.ok(workspace.startsWith(resolve(tmpdir(), "vaultix-codex-client-")));
    rmSync(workspace, { recursive: true, force: true });
  } catch {
    report.cleanupPassed = false;
  }
  if (!report.cleanupPassed) {
    report.passed = false;
    process.exitCode = 1;
  }
  const file = resolve(evidence, "result.json");
  writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(
    resolve(root, ".cache/actual-codex-client.json"),
    JSON.stringify({ path: file, ...report }, null, 2) + "\n"
  );
  console.log(
    JSON.stringify({
      passed: report.passed,
      cleanupPassed: report.cleanupPassed,
      checks: report.checks,
      failure: report.failure,
      evidence
    })
  );
}
