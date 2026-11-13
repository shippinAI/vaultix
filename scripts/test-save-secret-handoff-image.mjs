// Save to Vaultix v1 (docs/0125) in a real browser against a disposable stack from a local
// standalone image: a partner page on an allow-listed loopback origin opens the popup, the person
// signs in, the value crosses by postMessage and is stored with their own session.
// Credentials and the canary value stay in this process; receipts never print them.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDisposableImageHarness } from "./lib/disposable-image.mjs";

assert.equal(process.argv.length, 3, "Usage: node scripts/test-save-secret-handoff-image.mjs <local-standalone-image>");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let phase = "image inspection";
const harness = createDisposableImageHarness(process.argv[2], () => phase);
const { artifact, container, docker, request, ready, waitFor } = harness;
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache/save-secret-handoff-"));
const run = `vaultix-savesecret-${randomBytes(8).toString("hex")}`;
const report = { passed: false, image: artifact.id, imageRevision: artifact.revision, checkoutRevision: head, checks: [], scope: "One disposable stack from the image; partner page served locally on an allow-listed loopback origin; no API mocks" };
const check = name => { report.checks.push(name); console.log(`Save to Vaultix: ${name}`); };
const save = () => writeFileSync(resolve(evidence, "result.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
const password = `Vx9!${[...randomBytes(24)].map(byte => byte.toString(16).padStart(2, "0")).join("-")}`;
const email = `${run}@vaultix.invalid`;
const canary = `vx-canary-${randomBytes(24).toString("base64url")}`;
const decoy = `vx-decoy-${randomBytes(24).toString("base64url")}`;
const nonce = () => randomBytes(24).toString("base64url");

const excludedRanges = () => {
  if (process.platform !== "win32") return [];
  const out = spawnSync("netsh", ["interface", "ipv4", "show", "excludedportrange", "protocol=tcp"], { encoding: "utf8" }).stdout ?? "";
  return [...out.matchAll(/^\s*(\d+)\s+(\d+)/gm)].map(match => [Number(match[1]), Number(match[2])]);
};
const outsideExcluded = (port, ranges) => ranges.every(([start, end]) => port < start || port > end);

const partnerPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Partner</title></head>
<body><main><h1>Partner application</h1><button id="open" type="button">Save to Vaultix</button></main>
<script>
const q = new URLSearchParams(location.search);
const vaultix = q.get("vaultix"), nonce = q.get("nonce");
window.__events = []; window.__value = ""; window.__decoy = "";
let popup = null;
window.addEventListener("message", (event) => {
  window.__events.push({ origin: event.origin, fromPopup: event.source === popup, data: event.data });
  if (event.origin !== vaultix || event.source !== popup || !event.data || event.data.nonce !== nonce) return;
  if (event.data.type !== "vaultix.save-secret.ready") return;
  popup.postMessage({ type: "vaultix.save-secret.value", v: 1, nonce: "Z".repeat(22), value: window.__decoy }, vaultix);
  popup.postMessage({ type: "vaultix.save-secret.value", v: 1, nonce, value: window.__decoy, extra: true }, vaultix);
  popup.postMessage({ type: "vaultix.save-secret.ready", v: 1, nonce, value: window.__decoy }, vaultix);
  popup.postMessage({ type: "vaultix.save-secret.value", v: 1, nonce, value: window.__value }, vaultix);
  popup.postMessage({ type: "vaultix.save-secret.value", v: 1, nonce, value: window.__decoy }, vaultix);
});
document.getElementById("open").addEventListener("click", () => {
  const params = new URLSearchParams({ v: "1", source: "nomen", origin: q.get("claim") || location.origin, name: q.get("name"), kind: "client_secret", nonce });
  for (const [key, value] of new URLSearchParams(q.get("extra") || "")) params.append(key, value);
  popup = window.open(vaultix + "/integrations/save-secret?" + params, "vaultix-save", "popup,width=600,height=900");
});
window.__frame = (src) => new Promise((done) => { const f = document.createElement("iframe"); f.src = src; f.onload = () => done(); document.body.append(f); setTimeout(done, 5000); });
</script></body></html>`;

let server;
let browser;
try {
  phase = "partner page";
  server = createServer((req, res) => {
    if (new URL(req.url, "http://localhost").pathname !== "/partner") { res.writeHead(404).end(); return; }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(partnerPage);
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const partnerPort = server.address().port;
  const partner = `http://localhost:${partnerPort}`;

  phase = "disposable services";
  harness.createNetwork(run, { hostAccess: true });
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
    VAULTIX_INTEGRATION_ORIGINS: JSON.stringify([partner])
  }, { publishHttp: true });
  await ready(app);
  const appPort = Number(harness.output(["port", app, "8080/tcp"]).split("\n")[0].split(":").at(-1));
  const origin = `http://127.0.0.1:${appPort}`;
  const ranges = excludedRanges();
  assert.ok(outsideExcluded(appPort, ranges) && outsideExcluded(partnerPort, ranges), "A port falls in a Windows excluded range");
  report.ports = { vaultix: appPort, partner: partnerPort, excludedRangesChecked: ranges.length };
  check(`disposable stack on free loopback ports outside ${ranges.length} excluded ranges (Vaultix ${appPort}, partner ${partnerPort})`);
  assert.equal(artifact.revision, head, "The image was not built from this checkout's commit");
  check("the image was built from the checked-out commit");

  phase = "configuration and headers";
  const config = (await (await fetch(`${origin}/api/v1/admin/config`)).json()).config;
  assert.deepEqual(config.integrationOrigins, [partner]);
  check("the server config publishes exactly the allow-listed partner origin");
  const page = await fetch(`${origin}/integrations/save-secret?v=1`);
  assert.equal(page.headers.get("content-security-policy"), "frame-ancestors 'none'");
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  assert.equal(page.headers.get("referrer-policy"), "no-referrer");
  assert.equal(page.headers.get("cross-origin-opener-policy"), "unsafe-none");
  const login = await fetch(`${origin}/login`);
  assert.equal(login.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(login.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(login.headers.get("content-security-policy"), null);
  check("the handoff route cannot be framed, sends no referrer and keeps its opener; other routes keep their headers");

  phase = "owner and project";
  const owner = await request(app, "/api/v1/admin/signup", { method: "POST", body: { email, password, firstName: "Handoff", organizationName: "Handoff Proof" } });
  const { token } = await request(app, "/api/v3/auth/select-organization", { method: "POST", token: owner.token, body: { organizationId: owner.organization.id } });
  const { project } = await request(app, "/api/v1/projects", { method: "POST", token, body: { projectName: "Nomen Secrets" } });
  const environment = project.environments?.[0]?.slug ?? "dev";
  check("an owner and a secrets project exist");

  phase = "browser";
  const require = createRequire(resolve(root, "platform/engine/e2e/package.json"));
  const { chromium, expect } = require("@playwright/test");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const external = [];
  const carriers = [];
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || url.origin === partner) return route.continue();
    external.push(url.origin);
    return route.abort();
  });
  context.on("request", req => {
    const body = req.postData() ?? "";
    if (req.url().includes(canary) || body.includes(canary)) carriers.push(`${req.method()} ${new URL(req.url()).pathname}`);
    if (req.url().includes(decoy) && new URL(req.url()).origin === origin) carriers.push(`decoy in ${new URL(req.url()).pathname}`);
    if (body.includes(decoy)) carriers.push(`decoy in ${req.method()} ${new URL(req.url()).pathname}`);
  });
  const partnerTab = await context.newPage();
  const openPartner = async ({ name, extra = "", claim = "" }) => {
    const value = nonce();
    await partnerTab.goto(`${partner}/partner?${new URLSearchParams({ vaultix: origin, nonce: value, name, extra, claim })}`);
    await partnerTab.evaluate(([v, d]) => { window.__value = v; window.__decoy = d; }, [canary, decoy]);
    const popupPromise = partnerTab.waitForEvent("popup");
    await partnerTab.getByRole("button", { name: "Save to Vaultix" }).click();
    return { popup: await popupPromise, nonce: value };
  };
  const events = () => partnerTab.evaluate(() => window.__events.filter(event => event.fromPopup).map(event => ({ origin: event.origin, data: event.data })));

  phase = "refused requests";
  for (const [label, options, text] of [
    ["an origin that is not allow-listed", { name: "x", claim: "https://evil.example.com" }, "not allowed to save secrets here"],
    ["a value in the URL", { name: "x", extra: "value=leaked" }, "parameters Vaultix does not accept"]
  ]) {
    const { popup } = await openPartner(options);
    await expect(popup.getByRole("heading", { name: "This request cannot be used" })).toBeVisible({ timeout: 30000 });
    await expect(popup.getByText(text)).toBeVisible();
    await popup.waitForTimeout(1000);
    assert.deepEqual(await events(), [], `${label}: nothing may be posted`);
    await popup.close();
    check(`${label} shows an error page and posts nothing`);
  }

  phase = "framing";
  await partnerTab.evaluate(src => window.__frame(src), `${origin}/integrations/save-secret?v=1`);
  const frame = partnerTab.frames().find(candidate => candidate !== partnerTab.mainFrame());
  assert.ok(frame && !frame.url().startsWith(origin), "The handoff page loaded inside a frame");
  check("a partner cannot frame the handoff page");

  phase = "sign-in and save";
  const first = await openPartner({ name: "nomen client secret" });
  const popup = first.popup;
  await popup.waitForURL(url => new URL(url).pathname === "/login", { timeout: 60000 });
  assert.deepEqual(await events(), [], "Nothing is posted before sign-in");
  await popup.getByLabel("Email", { exact: true }).fill(email);
  await popup.getByLabel("Password", { exact: true }).fill(password);
  await popup.getByRole("button", { name: "Continue with Email", exact: true }).click();
  await expect(popup.getByRole("heading", { name: "Save a client secret from Nomen" })).toBeVisible({ timeout: 60000 });
  assert.equal(new URL(popup.url()).pathname, "/integrations/save-secret");
  check("sign-in returns the popup to the same handoff URL");
  await expect(popup.getByText("Secret received", { exact: true })).toBeVisible({ timeout: 30000 });
  const name = popup.getByLabel("Secret name", { exact: true });
  await expect(name).toHaveValue("nomen_client_secret");
  await expect(popup.getByLabel("Folder", { exact: true })).toHaveValue("/");
  await popup.screenshot({ path: resolve(evidence, "handoff-form.png"), fullPage: true });
  const readyEvents = await events();
  assert.deepEqual(readyEvents, [{ origin, data: { type: "vaultix.save-secret.ready", v: 1, nonce: first.nonce } }]);
  check("exactly one ready message reaches the partner from the Vaultix origin; the name suggestion is sanitized");
  const created = popup.waitForResponse(response => new URL(response.url()).pathname === "/api/v4/secrets/nomen_client_secret" && response.request().method() === "POST");
  await popup.getByRole("button", { name: "Save to Vaultix" }).click();
  assert.equal((await created).status(), 200);
  await expect(popup.getByText("Saved", { exact: true })).toBeVisible({ timeout: 30000 });
  const storage = await popup.evaluate(() => JSON.stringify({ local: Object.entries(localStorage), session: Object.entries(sessionStorage), href: location.href, cookie: document.cookie, text: document.body.innerText, title: document.title }));
  assert.ok(!storage.includes(canary) && !storage.includes(decoy), "The value reached storage, the URL, the cookie jar or the page");
  await popup.screenshot({ path: resolve(evidence, "handoff-saved.png"), fullPage: true });
  const afterSave = await events();
  assert.deepEqual(afterSave.at(-1), { origin, data: { type: "vaultix.save-secret.result", v: 1, nonce: first.nonce, status: "fulfilled", secretName: "nomen_client_secret", version: 1 } });
  assert.equal(afterSave.length, 2, "Exactly one result after one ready");
  assert.ok(!JSON.stringify(afterSave).includes(canary), "The value was posted back");
  check("decoys and the wrong nonce are ignored, one fulfilled result comes back, and the value is never posted back");
  const stored = (await request(app, `/api/v4/secrets/nomen_client_secret?${new URLSearchParams({ projectId: project.id, environment, secretPath: "/", viewSecretValue: "true" })}`, { token })).secret;
  assert.ok(stored.secretValue === canary, "The stored value is not the partner's value");
  assert.equal(stored.version, 1);
  assert.equal(stored.secretComment, "Saved from Nomen (client secret)");
  check("the stored secret holds exactly the partner's value, version 1, with the source in its comment");
  const closed = popup.waitForEvent("close");
  await popup.getByRole("button", { name: "Close Window" }).click();
  await closed;
  check("the popup closes itself after the result");

  phase = "dashboard";
  const dashboard = await context.newPage();
  await dashboard.goto(`${origin}/organizations/${owner.organization.id}/projects/secret-management/${project.id}/secrets/${environment}`);
  await expect(dashboard.getByText("nomen_client_secret").first()).toBeVisible({ timeout: 60000 });
  await dashboard.screenshot({ path: resolve(evidence, "dashboard.png"), fullPage: true });
  assert.ok(!(await dashboard.evaluate(() => document.body.innerText)).includes(canary), "The dashboard shows the value unmasked");
  check("the saved secret is listed in the project dashboard");

  phase = "cancel";
  const second = await openPartner({ name: "CANCEL_ME" });
  await expect(second.popup.getByText("Secret received", { exact: true })).toBeVisible({ timeout: 60000 });
  await second.popup.getByRole("button", { name: "Cancel" }).click();
  await expect(second.popup.getByText("Cancelled", { exact: true })).toBeVisible();
  const afterCancel = await events();
  assert.deepEqual(afterCancel.map(event => event.data.type), ["vaultix.save-secret.ready", "vaultix.save-secret.result"]);
  assert.deepEqual(afterCancel[1].data, { type: "vaultix.save-secret.result", v: 1, nonce: second.nonce, status: "declined" });
  const missing = await request(app, `/api/v4/secrets/CANCEL_ME?${new URLSearchParams({ projectId: project.id, environment, secretPath: "/" })}`, { token, status: 404 });
  assert.equal(typeof missing.error, "string");
  await second.popup.close();
  check("signed in already, Cancel posts declined and stores nothing");

  phase = "no opener";
  const direct = await context.newPage();
  await direct.goto(`${origin}/integrations/save-secret?${new URLSearchParams({ v: "1", source: "nomen", origin: partner, name: "x", kind: "pat", nonce: nonce() })}`);
  await expect(direct.getByText("This window is not connected to Nomen", { exact: false })).toBeVisible({ timeout: 60000 });
  check("opened without a partner window, the page shows an error");

  phase = "hygiene";
  assert.deepEqual(carriers, ["POST /api/v4/secrets/nomen_client_secret"], "Only the create call may carry the value");
  report.blockedExternalOrigins = [...new Set(external)];
  check(`the value left the browser only in the create call; ${report.blockedExternalOrigins.length} external origins were attempted and blocked`);
  report.passed = true;
} catch (error) {
  const scrub = text => String(text).replaceAll(canary, "[canary]").replaceAll(decoy, "[decoy]").replaceAll(password, "[password]").replaceAll(email, "[email]");
  const known = error.code === "ERR_ASSERTION" || error.name === "TimeoutError" || /Timed out|toBeVisible|toHaveValue/.test(String(error.message));
  report.failure = { phase, message: known ? scrub(error.message).slice(0, 2000) : `Failed during ${phase}; raw diagnostics withheld.` };
  for (const [index, open] of (browser?.contexts().flatMap(context => context.pages()) ?? []).entries()) {
    report.failure[`page${index}`] = scrub(open.url());
    await open.screenshot({ path: resolve(evidence, `failure-${index}.png`), fullPage: true }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  phase = "cleanup";
  await browser?.close().catch(() => {});
  await new Promise(done => (server ? server.close(done) : done()));
  report.cleanupPassed = harness.cleanup();
  if (!report.cleanupPassed) { report.passed = false; process.exitCode = 1; }
  save();
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failure: report.failure, cleanupPassed: report.cleanupPassed, evidence }));
}
