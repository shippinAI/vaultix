// Runs existing auth e2e specs against the loopback config from prepare-local-integration.mjs.
// Output is redacted before it is printed. This does not mock the database.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const specs = {
  password: ["e2e-test/routes/v1/login.spec.ts", "e2e-test/routes/v3/auth-email-login.spec.ts"],
  machine: ["e2e-test/routes/v1/identity-access-token-redesign.spec.ts"],
  references: ["e2e-test/routes/v1/vaultix-references.spec.ts"]
};
const selected = specs[process.argv[2]];
if (!selected) {
  console.error("Usage: node scripts/run-local-auth-e2e.mjs password|machine|references");
  process.exit(1);
}

const envPath = resolve(root, "platform/engine/.env.test");
const file = readFileSync(envPath, "utf8");
const values = Object.fromEntries(file.split("\n").filter(line => line.includes("=")).map(line => {
  const index = line.indexOf("=");
  return [line.slice(0, index), line.slice(index + 1)];
}));
for (const [label, value] of [["DB_CONNECTION_URI", values.DB_CONNECTION_URI], ["REDIS_URL", values.REDIS_URL], ["SITE_URL", values.SITE_URL]]) {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    console.error(`${label} is not loopback`);
    process.exit(1);
  }
}
const secretValues = [values.DB_CONNECTION_URI, values.ENCRYPTION_KEY, values.AUTH_SECRET, values.REDIS_URL].filter(Boolean);
const redact = text => secretValues.reduce((current, secret) => current.split(secret).join("[redacted]"), text)
  .replace(/postgres(?:ql)?:\/\/[^@\s]+@/g, "postgres://[redacted]@");

const child = spawn(process.execPath, [
  resolve(root, "platform/engine/backend/node_modules/vitest/vitest.mjs"),
  "run",
  "-c",
  "vitest.e2e.config.mts",
  ...selected
], {
  cwd: resolve(root, "platform/engine/backend"),
  env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=6144", PATH: process.env.PATH },
  stdio: ["ignore", "pipe", "pipe"]
});
let failed = false;
const write = (chunk, stream) => stream.write(redact(chunk.toString()));
child.stdout.on("data", chunk => write(chunk, process.stdout));
child.stderr.on("data", chunk => write(chunk, process.stderr));
child.on("close", code => {
  if (code !== 0) failed = true;
  process.exit(failed ? code || 1 : 0);
});
