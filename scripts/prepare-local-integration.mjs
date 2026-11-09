// Creates a loopback-only Postgres role and core/.env.test for integration tests.
// Refuses any non-loopback database, cache, or site URL. Does not print secrets.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const database = "vaultix_itest";
const role = "vaultix_itest";
const password = randomBytes(24).toString("hex");
const databaseURL = `postgres://${role}:${password}@127.0.0.1:5432/${database}`;
const redisURL = "redis://127.0.0.1:6379/15";
const siteURL = "http://127.0.0.1:8200";

const loopback = (value, label) => {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    console.error(`${label} must use 127.0.0.1`);
    process.exit(1);
  }
  if (url.protocol === "https:" || url.protocol === "http:") return;
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:" && url.protocol !== "redis:") {
    console.error(`${label} uses an unsupported protocol`);
    process.exit(1);
  }
};
loopback(databaseURL, "database");
loopback(redisURL, "redis");
loopback(siteURL, "site");

const locks = spawnSync("sudo", ["-u", "postgres", "psql", "-d", "postgres", "-tAc", "SHOW max_locks_per_transaction;"], { encoding: "utf8" });
const lockLimit = Number((locks.stdout ?? "").trim());
if (locks.status !== 0 || !Number.isFinite(lockLimit) || lockLimit < 256) {
  console.error("PostgreSQL max_locks_per_transaction must be at least 256 before the e2e schema reset. Set it to 512 and restart PostgreSQL.");
  process.exit(1);
}

const ready = spawnSync("pg_isready", ["-h", "127.0.0.1", "-p", "5432"], { encoding: "utf8" });
if (ready.status !== 0) {
  console.error("PostgreSQL is not accepting connections on 127.0.0.1:5432");
  process.exit(1);
}
const redis = spawnSync("redis-cli", ["-h", "127.0.0.1", "ping"], { encoding: "utf8" });
if (redis.status !== 0 || redis.stdout.trim() !== "PONG") {
  console.error("Redis did not answer PING on 127.0.0.1:6379");
  process.exit(1);
}

const sql = `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database}' AND pid <> pg_backend_pid();\n`
  + `DROP DATABASE IF EXISTS ${database};\nDROP ROLE IF EXISTS ${role};\n`
  + `CREATE ROLE ${role} LOGIN PASSWORD '${password}';\nCREATE DATABASE ${database} OWNER ${role};\n`;
const created = spawnSync("sudo", ["-u", "postgres", "psql", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], {
  input: sql,
  encoding: "utf8"
});
if (created.status !== 0) {
  const detail = `${created.stderr ?? ""}\n${created.stdout ?? ""}`.split(password).join("[redacted]");
  console.error(`Loopback database role setup failed\n${detail.slice(0, 500)}`);
  process.exit(1);
}

const checked = spawnSync("psql", ["-h", "127.0.0.1", "-U", role, "-d", database, "-c", "SELECT 1"], {
  encoding: "utf8",
  env: { ...process.env, PGPASSWORD: password }
});
if (checked.status !== 0) {
  console.error("Loopback database rejected the generated password");
  process.exit(1);
}

const envPath = resolve(root, "core/.env.test");
const lines = [
  "NODE_ENV=test",
  `ENCRYPTION_KEY=${randomBytes(16).toString("hex")}`,
  `AUTH_SECRET=${randomBytes(32).toString("base64")}`,
  `DB_CONNECTION_URI=${databaseURL}`,
  `REDIS_URL=${redisURL}`,
  `SITE_URL=${siteURL}`,
  "HOST=127.0.0.1",
  "PORT=8200",
  "TELEMETRY_ENABLED=false",
  "OTEL_TELEMETRY_COLLECTION_ENABLED=false",
  "CLICKHOUSE_AUDIT_LOG_ENABLED=false",
  "DISABLE_UPDATE_CHECK=true",
  "HTTPS_ENABLED=false",
  "SMTP_HOST=",
  ""
];
writeFileSync(envPath, lines.join("\n"), { mode: 0o600 });
chmodSync(envPath, 0o600);
console.log("Prepared loopback integration config at core/.env.test. Secrets were not printed.");
