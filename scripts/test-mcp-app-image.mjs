// Real packaged CLI -> two packaged server replicas -> shared Dragonfly/store,
// with the returned React resource operated in an independent sandbox host.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDisposableImageHarness } from "./lib/disposable-image.mjs";

assert.equal(process.argv.length, 4, "Usage: node scripts/test-mcp-app-image.mjs <image> <linux-cli>");
let phase = "inspect";
const harness = createDisposableImageHarness(process.argv[2], () => phase);
const { container, docker, request, ready, waitFor, artifact } = harness;
const require = createRequire(resolve("core/e2e/package.json"));
const { chromium, expect } = require("@playwright/test");
const axe = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
mkdirSync(".cache", { recursive: true });
const evidence = mkdtempSync(resolve(".cache/mcp-app-image-"));
const report = { passed: false, artifact, cliSha256: createHash("sha256").update(readFileSync(process.argv[3])).digest("hex"), checks: [], exclusions: ["actual AI client", "manual assistive technology", "ElastiCache/Redis Cluster deployment", "whole-product parity"] };
const check = name => { report.checks.push(name); console.log(`Vaultix MCP Apps: ${name}`); };
const run = `vaultix-mcp-${randomBytes(8).toString("hex")}`;
const password = `Vx9!${[...randomBytes(24)].map(byte => byte.toString(16).padStart(2, "0")).join("-")}`;
const dbPassword = randomBytes(24).toString("hex"), canary = randomBytes(32).toString("hex");
const sensitive = [password, dbPassword, canary];
const safe = value => assert.ok(sensitive.every(secret => !value.includes(secret)), "Sensitive canary crossed the MCP/UI boundary");
let worker, browser, server;
try {
  phase = "provision disposable services";
  harness.createNetwork(run);
  const dbName = `${run}-db`, cacheName = `${run}-cache`;
  const db = container(dbName, "postgres:16.6-alpine", [], { POSTGRES_USER: "vaultix", POSTGRES_DB: "vaultix", POSTGRES_PASSWORD: dbPassword });
  const cache = container(cacheName, "docker.dragonflydb.io/dragonflydb/dragonfly:v1.34.2", ["--default_lua_flags=allow-undeclared-keys", "--cache_mode=false", "--maxmemory=512mb", "--proactor_threads=2"]);
  await waitFor(() => docker(["exec", db, "pg_isready", "-U", "vaultix", "-d", "vaultix"], { allowFailure: true }).status === 0, "database ready");
  await waitFor(() => docker(["exec", cache, "redis-cli", "ping"], { allowFailure: true }).status === 0, "cache ready");
  const environment = { DB_CONNECTION_URI: `postgres://vaultix:${dbPassword}@${dbName}:5432/vaultix`, VAULTIX_CACHE_PROVIDER: "dragonfly", VAULTIX_CACHE_URL: `redis://${cacheName}:6379`, ENCRYPTION_KEY: randomBytes(16).toString("hex"), AUTH_SECRET: randomBytes(32).toString("hex"), SITE_URL: "http://127.0.0.1:8200", TELEMETRY_ENABLED: "false", DISABLE_UPDATE_CHECK: "true" };
  const app = container(`${run}-app`, artifact.id, [], environment);
  await ready(app);
  const replica = container(`${run}-replica`, artifact.id, [], environment);
  await ready(replica);
  const api = (path, options) => request(app, path, options);
  const owner = await api("/api/v1/admin/signup", { method: "POST", body: { email: `${run}@vaultix.invalid`, password, firstName: "MCP", organizationName: "Embedded Proof" } });
  const { token: admin } = await api("/api/v3/auth/select-organization", { method: "POST", token: owner.token, body: { organizationId: owner.organization.id } });
  sensitive.push(admin, owner.token);
  const { project } = await api("/api/v1/projects", { method: "POST", token: admin, body: { projectName: "MCP App Proof" } });
  const { identity } = await api("/api/v1/identities", { method: "POST", token: admin, body: { name: "MCP App Machine", organizationId: owner.organization.id, role: "member" } });
  await api(`/api/v1/projects/${project.id}/memberships/identities/${identity.id}`, { method: "POST", token: admin, body: { roles: [{ role: "admin", isTemporary: false }] } });
  await api(`/api/v1/auth/token-auth/identities/${identity.id}`, { method: "POST", token: admin, body: { accessTokenTTL: 600, accessTokenMaxTTL: 600 } });
  const issued = await api(`/api/v1/auth/token-auth/identities/${identity.id}/tokens`, { method: "POST", token: admin, body: { name: "MCP App proof" } });
  sensitive.push(issued.accessToken);
  const scope = { projectId: project.id, environment: "dev", secretPath: "/" };
  await api("/api/v4/secrets/MCP_APP_REFERENCE", { method: "POST", token: issued.accessToken, body: { ...scope, secretValue: canary, secretComment: canary } });
  const init = { protocolVersion: "2025-11-25", clientInfo: { name: "vaultix-independent-host", version: "1" }, capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } } };
  const http = (target, method, params, context = {}, token = issued.accessToken, verb = "POST") => {
    const code = `let s='';process.stdin.on('data',b=>s+=b).on('end',async()=>{try{const q=JSON.parse(s),r=await fetch('http://127.0.0.1:8080/api/v1/vaultix/mcp',{method:q.verb,headers:q.headers,...(q.verb==='POST'?{body:JSON.stringify(q.body)}:{}),signal:AbortSignal.timeout(20000)});process.stdout.write(JSON.stringify({status:r.status,session:r.headers.get('mcp-session-id'),body:await r.text()}));}catch{process.exitCode=1;}});`;
    return JSON.parse(docker(["exec", "-i", target, "node", "-e", code], { input: JSON.stringify({ verb, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...context }, body: { jsonrpc: "2.0", id: 1, method, params } }) }).stdout.toString());
  };
  phase = "shared session across actual replicas";
  const opened = http(app, "initialize", init);
  assert.equal(opened.status, 200); assert.match(opened.session, /^[a-f0-9]{64}$/);
  const context = { "mcp-session-id": opened.session, "mcp-protocol-version": "2025-11-25" };
  assert.equal(http(replica, "resources/list", {}, context).status, 200);
  assert.equal(http(replica, "resources/list", {}, context, admin).status, 404);
  assert.equal(http(replica, "", {}, context, issued.accessToken, "DELETE").status, 204);
  assert.equal(http(app, "ping", {}, context).status, 404);
  check("Two actual replicas share negotiated context; another actor is denied; retirement propagates");
  phase = "packaged CLI login";
  docker(["cp", resolve(process.argv[3]), `${app}:/tmp/vaultix`]);
  docker(["exec", "--user", "0", app, "chmod", "755", "/tmp/vaultix"]);
  docker(["exec", app, "mkdir", "-m", "700", "/tmp/vaultix-mcp-home"]);
  const login = docker(["exec", "-i", "-e", "VAULTIX_HOME=/tmp/vaultix-mcp-home", app, "/tmp/vaultix", "login", "--domain=http://127.0.0.1:8080", "--credential-file", "/tmp/vaultix-mcp-home/credential.json", "--token"], { input: `${issued.accessToken}\n` });
  safe(login.stdout.toString()); safe(login.stderr.toString());
  worker = spawn("docker", ["exec", "-i", "-e", "VAULTIX_HOME=/tmp/vaultix-mcp-home", app, "/tmp/vaultix", "mcp"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map(); let sequence = 0, buffer = "", workerError = false;
  worker.stderr.on("data", chunk => { safe(chunk.toString()); workerError = true; });
  worker.stdout.on("data", chunk => {
    buffer += chunk.toString();
    if (buffer.length > 2 * 1024 * 1024) { worker.kill(); return; }
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n"), line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      try { safe(line); const value = JSON.parse(line), task = pending.get(value.id); if (task) { clearTimeout(task.timer); pending.delete(value.id); task.resolve(value); } }
      catch { workerError = true; worker.kill(); }
    }
  });
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("Packaged MCP response timed out")); }, 30000);
    pending.set(id, { resolve, reject, timer });
    worker.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const initialized = await rpc("initialize", init);
  assert.ok(initialized.result.capabilities.resources);
  worker.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const tools = (await rpc("tools/list")).result.tools;
  const uri = tools.find(tool => tool.name === "vaultix.secrets.references")._meta.ui.resourceUri;
  const resource = (await rpc("resources/read", { uri })).result.contents[0];
  assert.equal(resource.mimeType, "text/html;profile=mcp-app");
  assert.deepEqual(resource._meta.ui.csp.connectDomains, []);
  const digest = createHash("sha256").update(resource.text).digest("hex");
  assert.equal(uri, `ui://vaultix/references/v1/${digest}.html`);
  report.resourceSha256 = digest;
  check("Actual CLI negotiates resources and reads the image's digest-addressed native React view");
  phase = "real CLI-backed embedded interaction";
  const host = `<!doctype html><html lang="en"><title>MCP image proof host</title><style>body{margin:0}iframe{border:0;width:100%;height:900px}</style><iframe title="Vaultix" sandbox="allow-scripts" src="/app"></iframe><script>
  const view=()=>document.querySelector('iframe').contentWindow;window.send=m=>view().postMessage({jsonrpc:'2.0',...m},'*');
  addEventListener('message',async e=>{if(e.source!==view()||e.data?.jsonrpc!=='2.0')return;const m=e.data;
  if(m.method==='ui/initialize')send({id:m.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'independent-image-host',version:'1'},hostCapabilities:{serverTools:{}},hostContext:{displayMode:'inline'}}});
  else if(m.method==='ui/notifications/initialized')send({method:'ui/notifications/tool-input',params:{arguments:${JSON.stringify(scope)}}});
  else if(m.method==='tools/call'){const result=await(await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(m.params)})).json();send({...result,id:m.id});}});
  </script></html>`;
  server = createServer(async (req, res) => {
    if (req.url === "/app") { res.writeHead(200, { "Content-Type": "text/html", "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'" }); res.end(resource.text); }
    else if (req.url === "/") { res.writeHead(200, { "Content-Type": "text/html" }); res.end(host); }
    else if (req.url === "/rpc" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) { body += chunk.toString(); if (body.length > 16384) { res.writeHead(413); res.end(); return; } }
      try { const result = await rpc("tools/call", JSON.parse(body)); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(result)); }
      catch { res.writeHead(503); res.end("{}"); }
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true, ...(process.env.VAULTIX_BROWSER_CHANNEL ? { channel: process.env.VAULTIX_BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
  const errors = []; page.on("pageerror", () => errors.push("Browser runtime error"));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const view = page.frameLocator("iframe"), frame = page.frames().find(frame => frame.url().endsWith("/app"));
  await expect(view.getByRole("combobox", { name: "App", exact: true })).toContainText("MCP App Proof");
  await view.getByRole("button", { name: "Show References", exact: true }).click();
  await expect(view.getByText("MCP_APP_REFERENCE", { exact: true })).toBeVisible();
  safe(await frame.content());
  await view.getByRole("button", { name: "Guide Me", exact: true }).click();
  await expect(view.getByRole("dialog", { name: "Find the Right Secret Reference", exact: true })).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 900 });
  await frame.evaluate(axe);
  const audit = await frame.evaluate(async () => window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } }));
  report.accessibility = { violations: audit.violations, manualReview: audit.incomplete.map(rule => rule.id) };
  assert.equal(audit.violations.length, 0);
  await page.screenshot({ path: resolve(evidence, "actual-reference-guide.png"), fullPage: true });
  await page.keyboard.press("Escape");
  check("Packaged CLI/server/view show real authorized reference names and mobile guided dialog; canary values never enter MCP or DOM");
  phase = "revocation during open view";
  await api(`/api/v1/auth/token-auth/tokens/${issued.tokenData.id}/revoke`, { method: "POST", token: admin, body: {} });
  await view.getByRole("button", { name: "Show References", exact: true }).click();
  await expect(view.getByRole("alert")).toContainText("access has changed");
  await expect(view.getByText("MCP_APP_REFERENCE", { exact: true })).toHaveCount(0);
  safe(await frame.content());
  check("Revoking the actual credential denies the next long-lived CLI/view read and hides cached references");
  assert.deepEqual(errors, []); assert.equal(workerError, false);
  report.passed = true;
} catch (error) {
  report.failure = { phase, message: error.code === "ERR_ASSERTION" ? error.message : "Operation failed; raw diagnostics withheld." };
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (worker) { worker.stdin.end(); await new Promise(resolve => { if (worker.exitCode !== null) resolve(); else { const timer = setTimeout(() => worker.kill(), 3000); worker.once("close", () => { clearTimeout(timer); resolve(); }); } }); }
  phase = "cleanup"; report.cleanupPassed = harness.cleanup();
  if (!report.cleanupPassed) { report.passed = false; process.exitCode = 1; }
  writeFileSync(resolve(evidence, "result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failure: report.failure, evidence }));
}
