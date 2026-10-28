import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requestedImage = process.argv[2];
if (!requestedImage || !/^[a-zA-Z0-9][a-zA-Z0-9:._/@-]{0,255}$/.test(requestedImage)) {
  throw new Error("Provide a locally built standalone Vaultix image.");
}
const inspected = spawnSync("docker", ["image", "inspect", "--format",
  '{"id":{{json .Id}},"title":{{json (index .Config.Labels "org.opencontainers.image.title")}},"source":{{json (index .Config.Labels "org.opencontainers.image.source")}}}',
  requestedImage], { encoding: "utf8", timeout: 20_000 });
if (inspected.status !== 0) throw new Error("Cannot inspect the local standalone image.");
const artifact = JSON.parse(inspected.stdout);
if (artifact.title !== "Vaultix" || artifact.source !== "https://github.com/shippinAI/vaultix" ||
    !/^sha256:[a-f0-9]{64}$/.test(artifact.id)) throw new Error("Expected the canonical Vaultix artifact.");

mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache", "identity-policy-proof-"));
const age = "MAX_MACHINE_IDENTITY_TOKEN_AGE";
const date = "LEGACY_IDENTITY_ACCESS_TOKEN_EXPIRATION_ENFORCED_AT";
const cases = [
  ["invalid-duration", age, "nonsense"], ["zero", age, "0"], ["negative", age, "-1s"],
  ["subsecond", age, "500ms"], ["overflow", age, "999999999999999999years"],
  ["compound", age, "1h30m"], ["exponent", age, "1e3s"],
  ["invalid-date", date, "not-a-date"], ["date-range", date, "2026-99-99T00:00:00Z"]
];
const results = [];
for (const runtime of ["issuer", "native"]) {
  for (const [name, key, value] of cases) {
    const container = `vaultix-policy-${randomBytes(8).toString("hex")}`;
    let run;
    try {
      run = spawnSync("docker", ["run", "--rm", "--pull=never", "--network=none", "--name", container,
        "-e", "NODE_ENV=test", "-e", "AUTH_SECRET=startup-fixture-only",
        "-e", "ENCRYPTION_KEY=0123456789abcdef0123456789abcdef",
        "-e", "DB_CONNECTION_URI=postgres://fixture:fixture@127.0.0.1:1/unused",
        "-e", "REDIS_URL=redis://127.0.0.1:1", "-e", `${key}=${value}`,
        "--entrypoint", runtime === "native" ? "/backend/go-sidecar" : "node",
        artifact.id, ...(runtime === "issuer" ? ["dist/main.mjs"] : [])],
      { encoding: "utf8", timeout: 20_000, maxBuffer: 1024 * 1024 });
    } finally {
      spawnSync("docker", ["rm", "-f", container], { stdio: "ignore", timeout: 20_000 });
    }
    // Retain only the expected field match and exit status. Raw application logs
    // are never evidence, even for these isolated non-secret configuration cases.
    const diagnosticMatched = `${run.stdout ?? ""}${run.stderr ?? ""}`.includes(key);
    const passed = [1, 255].includes(run.status) && !run.error && diagnosticMatched;
    results.push({ runtime, case: name, exitCode: run.status, diagnosticMatched, passed });
  }
}
const report = { status: results.every(result => result.passed) ? "passed" : "failed", image: artifact.id, results };
writeFileSync(resolve(evidence, "result.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status: report.status, passed: results.filter(result => result.passed).length,
  total: results.length, evidence }));
if (report.status !== "passed") process.exitCode = 1;
