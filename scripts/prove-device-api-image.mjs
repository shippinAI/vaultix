import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { createDisposableImageHarness } from "./lib/disposable-image.mjs";

let phase = "image inspection";
const h = createDisposableImageHarness(process.argv[2], () => phase);
mkdirSync(".cache", { recursive: true });
const evidence = mkdtempSync(resolve(".cache/device-api-image-"));
const report = {
  passed: false,
  artifact: h.artifact,
  harnessSha256: createHash("sha256")
    .update(readFileSync(new URL(import.meta.url)))
    .digest("hex"),
  checks: [],
  sources: [],
  scope:
    "Actual native image resource routes and real built-in browser-to-device grant issuance on disposable stores. Public TypeScript routes, CLI/MCP, approval UI and live federation are separate unfinished gates.",
};
const run = "vaultix-device-api-" + randomBytes(8).toString("hex");
try {
  phase = "compile disposable grant issuer";
  const source = resolve(evidence, "source");
  cpSync("platform/engine/backend-go", source, { recursive: true });
  function normalize(dir, relative = "") {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name),
        rel = relative ? relative + "/" + e.name : e.name;
      if (e.isDirectory()) normalize(p, rel);
      else {
        if (/\.(go|mod|sum|yml|yaml)$/.test(p)) {
          const x = readFileSync(p, "utf8");
          if (x.includes("\r\n")) writeFileSync(p, x.replaceAll("\r\n", "\n"));
        }
        report.sources.push({
          path: rel,
          sha256: createHash("sha256").update(readFileSync(p)).digest("hex"),
        });
      }
    }
  }
  normalize(source);
  const output = resolve(evidence, "bin");
  mkdirSync(output);
  const runner =
    "sha256:812899ac172fd5cb46363316d1d0ea65892b17368799a4ff9dfaaa1fecc2d0cd";
  report.fixtureRunner = runner;
  const compiled = h.docker(
    [
      "run",
      "--rm",
      "--pull=never",
      "--mount",
      "type=bind,source=" +
        source.replaceAll("\\", "/") +
        ",target=/app,readonly",
      "--mount",
      "type=bind,source=" + output.replaceAll("\\", "/") + ",target=/out",
      "--workdir",
      "/app",
      "-e",
      "GOTOOLCHAIN=local",
      "-e",
      "GOTELEMETRY=off",
      "-e",
      "CGO_ENABLED=0",
      runner,
      "go",
      "build",
      "-mod=readonly",
      "-tags",
      "integration",
      "-o",
      "/out/device-proof",
      "./tests/fixtures/deviceconsumer",
    ],
    { timeout: 300000, allowFailure: true },
  );
  report.fixtureCompile = {
    exit: compiled.status,
    timeout: compiled.error?.code === "ETIMEDOUT",
    diagnostics: (compiled.stderr?.toString() ?? "")
      .split("\n")
      .filter((line) => /\.go:\d+:\d+:/.test(line)),
  };
  assert.equal(compiled.status, 0, "Disposable grant issuer must compile");
  report.fixtureBinarySha256 = createHash("sha256")
    .update(readFileSync(resolve(output, "device-proof")))
    .digest("hex");
  phase = "disposable services";
  h.createNetwork(run);
  const pass = randomBytes(24).toString("hex"),
    dbName = run + "-db",
    cacheName = run + "-cache";
  const db = h.container(dbName, "postgres:16.6-alpine", [], {
    POSTGRES_USER: "vaultix",
    POSTGRES_DB: "vaultix",
    POSTGRES_PASSWORD: pass,
  });
  const cache = h.container(
    cacheName,
    "docker.dragonflydb.io/dragonflydb/dragonfly:v1.34.2",
    [
      "--default_lua_flags=allow-undeclared-keys",
      "--cache_mode=false",
      "--maxmemory=512mb",
      "--proactor_threads=2",
    ],
  );
  await h.waitFor(
    () =>
      h.docker(["exec", db, "pg_isready", "-U", "vaultix", "-d", "vaultix"], {
        allowFailure: true,
      }).status === 0,
    "database",
  );
  await h.waitFor(
    () =>
      h.docker(["exec", cache, "redis-cli", "ping"], { allowFailure: true })
        .status === 0,
    "cache",
  );
  const env = {
    DB_CONNECTION_URI: `postgres://vaultix:${pass}@${dbName}:5432/vaultix`,
    VAULTIX_CACHE_PROVIDER: "dragonfly",
    VAULTIX_CACHE_URL: `redis://${cacheName}:6379`,
    ENCRYPTION_KEY: randomBytes(16).toString("hex"),
    AUTH_SECRET: randomBytes(32).toString("hex"),
    SITE_URL: "http://127.0.0.1:8200",
    TELEMETRY_ENABLED: "false",
    DISABLE_UPDATE_CHECK: "true",
    GO_SIDECAR_SPAWN_ENABLED: "true",
    GO_SIDECAR_SHADOW_ENABLED: "false",
    VAULTIX_DEVICE_ACCESS_ENABLED: "true",
  };
  const app = h.container(run + "-app", h.artifact.id, [], env);
  await h.ready(app);
  phase = "built-in owner and project";
  const owner = await h.request(app, "/api/v1/admin/signup", {
    method: "POST",
    body: {
      email: run + "@vaultix.invalid",
      password: "Vx9!" + randomBytes(32).toString("hex"),
      firstName: "Device",
      organizationName: "Device API proof",
    },
  });
  const { token } = await h.request(app, "/api/v3/auth/select-organization", {
    method: "POST",
    token: owner.token,
    body: { organizationId: owner.organization.id },
  });
  const { project } = await h.request(app, "/api/v1/projects", {
    method: "POST",
    token,
    body: { projectName: "Device API proof" },
  });
  for (const id of [project.id, owner.organization.id])
    assert.match(id, /^[a-f0-9-]{36}$/);
  const nativeRunner = `let text='';process.stdin.on('data',b=>text+=b).on('end',async()=>{try{const q=JSON.parse(text);const r=await fetch('http://127.0.0.1:4040/api/v4/secrets?'+new URLSearchParams({projectId:q.projectId,environment:'dev',secretPath:'/',viewSecretValue:'false'}),{headers:q.token?{Authorization:'Bearer '+q.token}:{},signal:AbortSignal.timeout(20000)});const body=await r.json();console.log(JSON.stringify({status:r.status,empty:Array.isArray(body.secrets)&&body.secrets.length===0,plainError:typeof body.error==='string'}));}catch{process.exitCode=1}});`;
  function native(id, credential, expected) {
    const response = h.docker(["exec", "-i", id, "node", "-e", nativeRunner], {
      input: JSON.stringify({ projectId: project.id, token: credential }),
    });
    const result = JSON.parse(response.stdout.toString());
    assert.equal(result.status, expected, `Native status during ${phase}`);
    if (expected === 200) assert.equal(result.empty, true);
    else assert.equal(result.plainError, true);
    return result;
  }
  phase = "browser compatibility";
  native(app, token, 200);
  report.checks.push(
    "Existing built-in browser session reaches the actual native secrets resource",
  );
  phase = "real grant issuance";
  h.docker(["cp", resolve(output, "device-proof"), app + ":/tmp/device-proof"]);
  const issued = h.docker(["exec", "-i", app, "/tmp/device-proof"], {
    input: JSON.stringify({ BrowserToken: token }),
  });
  const session = JSON.parse(issued.stdout.toString());
  for (const id of [session.sessionId, session.userId])
    assert.match(id, /^[a-f0-9-]{36}$/);
  phase = "device resource admission";
  native(app, session.access, 200);
  report.checks.push(
    "Real built-in browser authority approves a grant; one-use redemption issues a separate session accepted by the image resource",
  );
  phase = "credential family denial";
  native(app, session.refresh, 401);
  native(app, session.access.slice(0, -8) + "tampered", 401);
  native(app, undefined, 401);
  report.checks.push(
    "Refresh credentials, tampered access credentials and anonymous requests are denied with plain errors",
  );
  phase = "live tenant isolation";
  const foreignOrg = randomUUID();
  h.sql(
    db,
    `INSERT INTO vx_workspace_organizations(id,name,slug) VALUES('${foreignOrg}','Foreign fixture','${foreignOrg}'); UPDATE vx_workspace_projects SET "orgId"='${foreignOrg}' WHERE id='${project.id}'`,
  );
  native(app, session.access, 403);
  h.sql(
    db,
    `UPDATE vx_workspace_projects SET "orgId"='${owner.organization.id}' WHERE id='${project.id}'`,
  );
  native(app, session.access, 200);
  report.checks.push(
    "Moving the actual project to another tenant denies the same device credential; restoring ownership restores authorized access",
  );
  phase = "current account restriction";
  h.sql(db, `UPDATE vx_auth_users SET "isLocked"=true WHERE id='${session.userId}'`);
  native(app, session.access, 401);
  h.sql(db, `UPDATE vx_auth_users SET "isLocked"=false WHERE id='${session.userId}'`);
  native(app, session.access, 200);
  report.checks.push(
    "Current account lock denies access immediately and recovery revalidates the primary store",
  );
  phase = "primary outage";
  h.docker(["stop", "-t", "1", db]);
  native(app, session.access, 503);
  h.docker(["start", db]);
  await h.waitFor(
    () =>
      h.docker(["exec", db, "pg_isready", "-U", "vaultix", "-d", "vaultix"], {
        allowFailure: true,
      }).status === 0,
    "database recovery",
  );
  native(app, session.access, 200);
  report.checks.push(
    "Unavailable primary authority yields 503 with no authorization fallback; recovery restores access",
  );
  phase = "application restart";
  h.docker(["restart", app]);
  await h.ready(app);
  native(app, session.access, 200);
  report.checks.push(
    "A device session survives application restart with current persistent authority",
  );
  phase = "disabled instance gate";
  const disabled = h.container(run + "-disabled", h.artifact.id, [], {
    ...env,
    VAULTIX_DEVICE_ACCESS_ENABLED: "false",
  });
  await h.ready(disabled);
  native(disabled, session.access, 401);
  native(disabled, token, 200);
  report.checks.push(
    "Disabled device admission rejects the same credential while preserving browser access",
  );
  phase = "canonical session revocation";
  h.sql(db, `DELETE FROM vx_auth_sessions WHERE id='${session.sessionId}'`);
  native(app, session.access, 401);
  native(app, token, 200);
  report.checks.push(
    "Canonical device-session deletion immediately revokes device access and preserves the independent browser session",
  );
  report.passed = true;
} catch (error) {
  report.failure = {
    phase,
    message:
      error.code === "ERR_ASSERTION"
        ? error.message
        : "Device API image proof failed; raw diagnostics withheld.",
    cause: error.message?.startsWith("Timed out:") ? "timeout" : undefined,
  };
  process.exitCode = 1;
} finally {
  report.cleanupPassed = h.cleanup();
  if (!report.cleanupPassed) {
    report.passed = false;
    process.exitCode = 1;
  }
  writeFileSync(
    resolve(evidence, "result.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: report.passed,
      checks: report.checks,
      failure: report.failure,
      evidence,
      cleanupPassed: report.cleanupPassed,
    }),
  );
}
