import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const provider = process.argv[2] ?? "dragonfly";
if (!["dragonfly", "redis"].includes(provider)) throw new Error("Choose dragonfly or redis.");
const specs = process.argv.slice(3);
const selected = specs.length ? specs : [
  "e2e-test/routes/v1/first-owner-atomic.spec.ts",
  "e2e-test/routes/v1/auth-token.spec.ts",
  "e2e-test/routes/v1/auth-refresh-recovery.spec.ts",
  "e2e-test/routes/v3/auth-email-login.spec.ts",
  "e2e-test/routes/v1/vaultix-references.spec.ts",
  "e2e-test/routes/v4/secrets.spec.ts",
  "e2e-test/routes/v1/secret-approval-policy.spec.ts",
  "e2e-test/routes/v1/access-approval-policy.spec.ts",
  "e2e-test/routes/v1/oauth-scope.spec.ts",
  "e2e-test/routes/v1/identity-access-token-redesign.spec.ts",
  "e2e-test/routes/v1/project-env.spec.ts",
  "e2e-test/routes/v3/secret-reference.spec.ts",
  "e2e-test/routes/v1/scim.spec.ts"
];
if (selected.some((spec) => !/^e2e-test\/[a-zA-Z0-9_./-]+\.spec\.ts$/.test(spec) || spec.includes(".."))) throw new Error("Provide spec paths within e2e-test.");
const run = `vaultix-proof-${randomBytes(6).toString("hex")}`;
mkdirSync(resolve(root, ".cache"), { recursive: true });
const temporary = mkdtempSync(resolve(root, ".cache", "core-proof-"));
const envFile = resolve(temporary, "test.env");
const docker = (args, options = {}) => {
  const result = spawnSync("docker", args, { cwd: root, stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`Docker verification step failed: ${args[0]}`);
  return result;
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const ready = async (name, args) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (spawnSync("docker", ["exec", name, ...args], { stdio: "ignore" }).status === 0) return;
    await sleep(1000);
  }
  throw new Error("Isolated test dependency did not become ready.");
};

try {
  docker(["network", "create", run]);
  docker(["run", "-d", "--name", `${run}-db`, "--network", run, "-e", "POSTGRES_USER=vaultix", "-e", "POSTGRES_PASSWORD=verification-only", "-e", "POSTGRES_DB=vaultix_test", "postgres:16.6-alpine"]);
  const cache = provider === "dragonfly"
    ? ["docker.dragonflydb.io/dragonflydb/dragonfly:v1.34.2", "--default_lua_flags=allow-undeclared-keys", "--cache_mode=false", "--proactor_threads=2"]
    : ["redis:7.4-alpine", "redis-server", "--maxmemory-policy", "noeviction"];
  docker(["run", "-d", "--name", `${run}-cache`, "--network", run, ...cache]);
  await Promise.all([ready(`${run}-db`, ["pg_isready", "-U", "vaultix", "-d", "vaultix_test"]), ready(`${run}-cache`, ["redis-cli", "ping"])]);
  writeFileSync(envFile, [
    `DB_CONNECTION_URI=postgres://vaultix:verification-only@${run}-db:5432/vaultix_test`,
    `VAULTIX_CACHE_PROVIDER=${provider}`, `VAULTIX_CACHE_URL=redis://${run}-cache:6379`,
    `ENCRYPTION_KEY=${randomBytes(16).toString("hex")}`, `AUTH_SECRET=${randomBytes(32).toString("hex")}`,
    "NODE_ENV=test", "SITE_URL=http://localhost:8080", "TELEMETRY_ENABLED=false", "OTEL_TELEMETRY_COLLECTION_ENABLED=false", "GO_SIDECAR_ENABLED=false"
  ].join("\n"), { mode: 0o600 });
  docker(["create", "--init", "--name", `${run}-tests`, "--network", run, "--env-file", envFile,
    "--entrypoint", "node", "vaultix:verify-backend", "--max-old-space-size=4096", "node_modules/vitest/vitest.mjs", "run", "-c", "vitest.e2e.config.mts", "--reporter=default", "--reporter=json", "--outputFile=/app/test-results.json", ...selected]);
  for (const entry of ["src", "e2e-test", "vitest.e2e.config.mts"]) docker(["cp", resolve(root, "core/backend", entry), `${run}-tests:/app/`]);
  docker(["start", "--attach", `${run}-tests`]);
  const exit = docker(["inspect", "--format", "{{.State.ExitCode}}", `${run}-tests`], { stdio: "pipe", encoding: "utf8" });
  if (exit.stdout.trim() !== "0") throw new Error("Capability tests failed.");
  console.log(`Vaultix database capability checks passed with ${provider}.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  spawnSync("docker", ["cp", `${run}-tests:/app/test-results.json`, resolve(temporary, "test-results.json")], { stdio: "ignore" });
  console.log(`Capability evidence directory: ${temporary}`);
  for (const suffix of ["tests", "db", "cache"]) spawnSync("docker", ["rm", "-f", `${run}-${suffix}`], { stdio: "ignore" });
  spawnSync("docker", ["network", "rm", run], { stdio: "ignore" });
  rmSync(envFile, { force: true });
}
