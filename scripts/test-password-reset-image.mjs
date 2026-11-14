// Account recovery without email on one packaged image (docs/0122 Stage 3): with no mail server
// configured, an instance administrator issues a one-use reset link, the person sets a new password
// through the same verify and reset routes the email would lead to, the old password stops working,
// the link cannot be used twice, and nobody else can issue one. The host operator then recovers the
// owner with the exact script `vaultix server owner-reset-link` runs, and both issues reach the
// organization's audit log. Values stay in process memory.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDisposableImageHarness } from "./lib/disposable-image.mjs";

assert.equal(process.argv.length, 3, "Usage: node scripts/test-password-reset-image.mjs <local-standalone-image>");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let phase = "image inspection";
const harness = createDisposableImageHarness(process.argv[2], () => phase);
const { artifact, container, docker, http, request, ready, waitFor } = harness;
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache/password-reset-image-"));
const run = `vaultix-reset-${randomBytes(8).toString("hex")}`;
const siteUrl = "http://127.0.0.1:8200";
const report = { passed: false, artifact, checks: [],
  scope: "One packaged instance with no mail server; an instance administrator recovers an account",
  exclusions: ["browser UI", "email delivery", "the host command's instance directory and Compose lookup"] };
const check = name => { report.checks.push(name); console.log(`Vaultix password reset: ${name}`); };
const password = () => `Vx9!${[...randomBytes(24)].map(byte => byte.toString(16).padStart(2, "0")).join("-")}`;
const original = password(), replacement = password(), recovered = password();
// The host command's script, read from its Go source so this proof runs exactly what the command runs.
const hostScript = readFileSync(resolve(root, "internal/platform/owner_recovery.go"), "utf8")
  .match(/const ownerRecoveryScript = `([^`]+)`/)?.[1];
assert.ok(hostScript?.includes("%s"), "the owner recovery script was not found in internal/platform/owner_recovery.go");
const email = `${run}@vaultix.invalid`;

function raw(app, path, { method = "GET", body, token } = {}) {
  const response = http(app, path, { method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.ok(response, `HTTP connection failed during ${phase}`);
  return response;
}

try {
  phase = "instance";
  harness.createNetwork(run);
  const databasePassword = randomBytes(24).toString("hex");
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
    SITE_URL: siteUrl, TELEMETRY_ENABLED: "false", DISABLE_UPDATE_CHECK: "true"
  });
  await ready(app);
  const api = (path, options) => request(app, path, options);

  phase = "owner without email";
  const status = await api("/api/status");
  assert.equal(status.emailConfigured, false, "this proof needs an instance with no mail server");
  const owner = await api("/api/v1/admin/signup", { method: "POST",
    body: { email, password: original, firstName: "Reset", organizationName: "Reset Org" } });
  const userId = owner.user?.id;
  assert.match(userId ?? "", /^[0-9a-f-]{36}$/, "the signup did not return the owner's user ID");
  check("an owner exists on an instance with no mail server");

  phase = "refusals";
  const path = `/api/vx/v1/access/users/${userId}/password-reset-links`;
  assert.equal(raw(app, path, { method: "POST", body: {} }).status, 401);
  const badId = await api("/api/vx/v1/access/users/not-an-id/password-reset-links", { method: "POST", token: owner.token, body: {}, status: 400 });
  assert.equal(typeof badId.error, "string");
  const missing = await api(`/api/vx/v1/access/users/${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}/password-reset-links`,
    { method: "POST", token: owner.token, body: {}, status: 404 });
  assert.match(missing.message, /was not found/);
  check("signed-out requests, malformed IDs and unknown people are refused with a reason");

  phase = "issue";
  const issued = await api(path, { method: "POST", token: owner.token, body: {}, status: 201 });
  const link = new URL(issued.passwordResetLink.url);
  assert.equal(`${link.origin}${link.pathname}`, `${siteUrl}/account-recovery-reset`);
  assert.equal(link.searchParams.get("to"), email);
  const code = link.searchParams.get("token");
  assert.match(code ?? "", /^[0-9a-f]{64}$/);
  assert.ok(Date.parse(issued.passwordResetLink.expiresAt) > Date.now() + 23 * 3600_000);
  check("an instance administrator gets a one-use link to the reset page, valid for a day");

  phase = "reset";
  const verified = await api("/api/v1/account-recovery/verify-email", { method: "POST", body: { email, code } });
  assert.equal(typeof verified.token, "string");
  await api("/api/v2/password/password-reset", { method: "POST", token: verified.token, body: { newPassword: replacement } });
  const signedIn = await api("/api/v3/auth/login", { method: "POST", body: { email, password: replacement } });
  assert.ok(signedIn.accessToken || signedIn.token, "the new password did not sign in");
  assert.ok(raw(app, "/api/v3/auth/login", { method: "POST", body: { email, password: original } }).status >= 400, "the old password still signs in");
  check("the link leads through the normal verify and reset routes; the new password signs in and the old one does not");

  phase = "reuse";
  assert.ok(raw(app, "/api/v1/account-recovery/verify-email", { method: "POST", body: { email, code } }).status >= 400, "the link worked twice");
  check("the link cannot be used a second time");

  phase = "host refusal";
  const guessed = await api("/api/vx/v1/access/owner-password-reset-links", { method: "POST", body: { hostCode: "f".repeat(64) }, status: 403 });
  assert.match(guessed.message, /vaultix server owner-reset-link/);
  check("owner recovery is refused to anyone who has not just written the code inside the container");

  phase = "host recovery";
  const hostCode = randomBytes(32).toString("hex");
  const hostRun = docker(["exec", "-i", app, "node", "-"], { input: hostScript.replace("%s", JSON.stringify({ code: hostCode, email: "" })), allowFailure: true, timeout: 30_000 });
  assert.equal(hostRun.status, 0, "the host script did not run in the container");
  const hostAnswer = JSON.parse(hostRun.stdout.toString());
  assert.equal(hostAnswer.status, 201, `the host script was refused: ${hostAnswer.body?.message}`);
  const hostLink = new URL(hostAnswer.body.passwordResetLink.url);
  assert.equal(hostLink.searchParams.get("to"), email);
  const hostToken = hostLink.searchParams.get("token");
  const hostVerified = await api("/api/v1/account-recovery/verify-email", { method: "POST", body: { email, code: hostToken } });
  await api("/api/v2/password/password-reset", { method: "POST", token: hostVerified.token, body: { newPassword: recovered } });
  const ownerAgain = await api("/api/v3/auth/login", { method: "POST", body: { email, password: recovered } });
  assert.ok(ownerAgain.accessToken || ownerAgain.token, "the owner could not sign in after host recovery");
  const unknown = docker(["exec", "-i", app, "node", "-"], { input: hostScript.replace("%s", JSON.stringify({ code: randomBytes(32).toString("hex"), email: "nobody@vaultix.invalid" })), allowFailure: true, timeout: 30_000 });
  assert.equal(JSON.parse(unknown.stdout.toString()).status, 404, "an unknown administrator email was not refused");
  check("the host command's script recovers the owner with no sign-in, and names an unknown administrator");

  phase = "audit";
  const session = ownerAgain.accessToken || ownerAgain.token;
  let entries = [];
  await waitFor(() => {
    const listed = http(app, "/api/v1/organization/audit-logs?eventType=issue-password-reset-link&limit=10",
      { headers: { Authorization: `Bearer ${session}` } });
    entries = listed?.status === 200 ? JSON.parse(listed.body).auditLogs : [];
    return entries.length >= 2;
  }, "audit log entries for issued reset links");
  const origins = entries.map(entry => entry.event?.metadata?.origin).sort();
  assert.deepEqual(origins, ["administrator", "host"]);
  assert.ok(!JSON.stringify(entries).includes(code) && !JSON.stringify(entries).includes(hostToken), "a reset code reached the audit log");
  check("the organization's audit log records each issued link, by an administrator and by the host, without the code");

  phase = "logs";
  const logs = docker(["logs", app], { allowFailure: true });
  const text = `${logs.stdout}${logs.stderr}`;
  for (const value of [code, hostToken, hostCode, replacement, original, recovered]) assert.ok(!text.includes(value), "a code or password reached the log");
  assert.ok(text.includes(`[origin=administrator] [userId=${userId}] [issuedByUserId=${userId}]`), "issuing the link was not recorded");
  assert.ok(text.includes(`[origin=host] [userId=${userId}] [issuedByUserId=host]`), "host recovery was not recorded");
  check("issuing is recorded with who issued it and for whom; no code or password reaches the log");

  report.passed = true;
} catch (error) {
  report.failure = { phase, message: error instanceof Error ? error.message : String(error) };
  process.exitCode = 1;
} finally {
  phase = "cleanup";
  report.cleanupPassed = harness.cleanup();
  if (!report.cleanupPassed) { report.passed = false; process.exitCode = 1; }
  writeFileSync(resolve(evidence, "result.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks, failure: report.failure, cleanupPassed: report.cleanupPassed, evidence }));
}
