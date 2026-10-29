// Exercise shared admission using two real replicas and disposable dependencies.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDisposableImageHarness } from "./lib/disposable-image.mjs";

assert.ok(process.argv.length === 4 && ["dragonfly", "redis"].includes(process.argv[3]),
  "Usage: node scripts/test-production-admission.mjs <local-standalone-image> <dragonfly|redis>");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const provider = process.argv[3];
let phase = "image inspection";
const harness = createDisposableImageHarness(process.argv[2], () => phase);
const { artifact, container, docker, output, ready, waitFor } = harness;
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache/production-admission-"));
const run = `vaultix-admission-${randomBytes(8).toString("hex")}`;
const report = { passed: false, provider, artifact, checks: [], exclusions: ["tenant fairness", "capacity", "HA/failover", "ElastiCache deployment", "all authentication methods", "public cloud readiness"] };
const check = name => { report.checks.push(name); console.log(`Vaultix admission: ${name}`); };

// The two destinations see the same client. Run traffic inside their private network;
// rotate untrusted forwarding headers and keep credentials out of command arguments.
function probe(client, targets, path, count, method = "GET", body) {
  const runner = `let input='';for await(const b of process.stdin)input+=b;const q=JSON.parse(input);const results=[];
    for(let i=0;i<q.count;i++){const started=Date.now();const r=await fetch('http://'+q.targets[i%q.targets.length]+':8080'+q.path,
      {method:q.method,headers:{'content-type':'application/json','x-forwarded-for':'198.51.100.'+i,'cf-connecting-ip':'198.51.100.'+i},
      ...(q.body===undefined?{}:{body:JSON.stringify(q.body)}),signal:AbortSignal.timeout(8000)});
      const text=await r.text();let parsed;try{parsed=JSON.parse(text)}catch{}
      results.push({status:r.status,elapsedMs:Date.now()-started,plain:typeof parsed?.error==='string',retry:Number(r.headers.get('retry-after')),limit:Number(r.headers.get('x-ratelimit-limit'))});}
    process.stdout.write(JSON.stringify(results));`;
  return JSON.parse(output(["exec", "-i", client, "node", "--input-type=module", "-e", runner], {
    input: JSON.stringify({ targets, path, count, method, body })
  }));
}
const denied = results => {
  assert.ok(results.every(r => r.status === 429 && r.plain && r.retry > 0 && r.retry <= 60), "Expected HTTP 429, plain error and bounded Retry-After");
};
try {
  phase = "disposable services";
  harness.createNetwork(run);
  const dbName = `${run}-db`, cacheName = `${run}-cache`, names = [`${run}-a`, `${run}-b`];
  const databasePassword = randomBytes(24).toString("hex");
  const db = container(dbName, "postgres:16.6-alpine", [], { POSTGRES_USER: "vaultix", POSTGRES_DB: "vaultix", POSTGRES_PASSWORD: databasePassword });
  const cache = provider === "dragonfly"
    ? container(cacheName, "docker.dragonflydb.io/dragonflydb/dragonfly:v1.34.2", ["--default_lua_flags=allow-undeclared-keys", "--cache_mode=false", "--maxmemory=512mb", "--proactor_threads=2"])
    : container(cacheName, "redis:7.4-alpine");
  await waitFor(() => docker(["exec", db, "pg_isready", "-U", "vaultix", "-d", "vaultix"], { allowFailure: true }).status === 0, "database readiness");
  await waitFor(() => docker(["exec", cache, "redis-cli", "ping"], { allowFailure: true }).status === 0, "cache readiness");
  // No license keys or VAULTIX_CLOUD switch: all production installations need protection.
  const env = { DB_CONNECTION_URI: `postgres://vaultix:${databasePassword}@${dbName}:5432/vaultix`,
    VAULTIX_CACHE_PROVIDER: provider, VAULTIX_CACHE_URL: `redis://${cacheName}:6379`,
    ENCRYPTION_KEY: randomBytes(16).toString("hex"), AUTH_SECRET: randomBytes(32).toString("hex"),
    SITE_URL: "http://127.0.0.1:8200", TELEMETRY_ENABLED: "false", DISABLE_UPDATE_CHECK: "true" };
  const first = container(names[0], artifact.id, [], env);
  await ready(first);
  const second = container(names[1], artifact.id, [], env);
  await ready(second);

  phase = "shared authentication budget";
  const login = probe(first, names, "/api/v3/auth/login", 60, "POST", {});
  report.authenticationSample = { statuses: [...new Set(login.map(r => r.status))], limits: [...new Set(login.map(r => r.limit))] };
  const exhausted = probe(first, names, "/api/v3/auth/login", 2, "POST", {});
  report.authenticationSample.afterBudget = exhausted.map(r => r.status);
  denied(exhausted);
  assert.ok(login.every(r => r.status === 422 && r.limit === 60), "Login must validate input within its configured shared budget");
  check("both production replicas share the 60-request authentication budget without license keys");

  phase = "shared native budget";
  const catalog = probe(first, names, "/api/v1/vaultix/catalog", 120);
  assert.ok(catalog.every(r => r.status === 200 && r.limit === 120), "Native routes must retain their 120-request budget without double counting");
  denied(probe(first, names, "/api/v1/vaultix/catalog", 2));
  assert.equal(probe(first, names, "/api/v1/vaultix/product", 1)[0].status, 200);
  check("native routes share one budget across replicas; forged headers cannot reset it; separate routes remain usable");

  phase = "replica restart";
  const restartedAt = Date.now();
  output(["restart", second]);
  await ready(second);
  assert.ok(Date.now() - restartedAt < 45000, "Restart exceeded the remaining rate-limit window");
  denied(probe(first, [names[1]], "/api/v1/vaultix/catalog", 1));
  check("restarting one application replica preserves the shared budget");

  phase = "cache loss";
  output(["stop", cache]);
  const unavailable = probe(first, names, "/api/v1/vaultix/product", 2);
  assert.ok(unavailable.every(r => r.status === 500 && r.plain && r.elapsedMs < 6000), "Cache loss must fail closed within a bounded wait");
  check("both replicas deny protected requests within six seconds when the admission cache is unavailable");
  report.passed = true;
} catch (error) {
  report.failure = { phase, message: error.code === "ERR_ASSERTION" ? error.message : "Admission proof failed; raw diagnostics withheld." };
  process.exitCode = 1;
} finally {
  phase = "cleanup";
  report.cleanupPassed = harness.cleanup();
  if (!report.cleanupPassed) { report.passed = false; process.exitCode = 1; }
  writeFileSync(resolve(evidence, "result.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failure: report.failure, cleanupPassed: report.cleanupPassed, evidence }));
}
