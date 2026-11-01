// Verify committed CLI binaries across the packaged application boundary.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

assert.equal(process.argv.length, 4,
  "Usage: node scripts/test-cli-delivery.mjs <self-hosted-build-result.json> <linux-go-test-image-id>");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const command = (name, args) => execFileSync(name, args, {
  cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true
}).trim();
assert.equal(command("git", ["status", "--porcelain"]), "", "Verify a clean committed candidate");
const revision = command("git", ["rev-parse", "HEAD"]);
const build = JSON.parse(readFileSync(resolve(process.argv[2]), "utf8"));
const cli = JSON.parse(readFileSync(resolve(root, ".cache/committed-cli.json"), "utf8"));
for (const receipt of [build, cli]) {
  assert.equal(receipt.passed, true);
  assert.equal(receipt.revision, revision, "Build receipt belongs to another candidate");
}
for (const name of ["canonical-image", "image-identity", "identity-lifetime", "dragonfly-application",
  "redis-application", "encrypted-recovery", "tenant-isolation", "proxy-boundary", "admission-dragonfly", "admission-redis"]) {
  assert.ok(build.steps.some(step => step.name === name && step.passed && step.exitCode === 0), `Missing ${name} gate`);
}
assert.ok(build.steps.every(step => step.passed));
assert.match(process.argv[3], /^sha256:[a-f0-9]{64}$/);
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache/cli-delivery-"));
const report = { passed: false, revision, image: build.imageId, canonicalBuild: resolve(process.argv[2]),
  cli: cli.artifacts, testImage: process.argv[3], checks: [],
  exclusions: ["real Nomen approval and identity mapping", "Windows Credential Manager acceptance", "full CLI/platform parity"] };
const run = (label, name, args, options = {}) => {
  const result = spawnSync(name, args, { cwd: root, encoding: "utf8", windowsHide: true,
    maxBuffer: 32 * 1024 * 1024, ...options });
  writeFileSync(resolve(evidence, `${label}.log`), (result.stdout ?? "") + (result.stderr ?? ""), { mode: 0o600 });
  assert.ok(!result.error && result.status === 0, `${label} failed; inspect local evidence`);
  report.checks.push(label);
  return result.stdout;
};
try {
  run("image-identity", process.execPath, ["scripts/check-image-identity.mjs", build.imageId, "engine", revision]);
  const sha256 = file => createHash("sha256").update(readFileSync(file)).digest("hex");
  for (const artifact of cli.artifacts) {
    assert.equal(artifact.files.length, 2);
    for (const file of artifact.files) assert.equal(sha256(file), artifact.sha256);
    if (artifact.platform === `${process.platform === "win32" ? "windows" : process.platform}/amd64` && process.arch === "x64") {
      for (const [index, file] of artifact.files.entries()) {
        const name = index === 0 ? "vaultix" : "vaultixl";
        const help = run(`${name}-help`, file, ["--help"]);
        assert.ok(help.startsWith(`usage: ${name} <command>`) && help.includes("--domain=https://vaultix.cloud") && !/infisical/i.test(help));
        const login = run(`${name}-login-help`, file, ["login", "--help"]);
        assert.ok(login.includes("-domain") && !/infisical/i.test(login));
      }
    }
  }
  const linux = cli.artifacts.find(artifact => artifact.platform === "linux/amd64");
  assert.ok(linux, "Missing Linux native CLI");
  const source = resolve(dirname(dirname(linux.files[0])), "source");
  assert.equal(sha256(resolve(source, "../source.tar")), cli.sourceArchiveSha256);
  const events = run("linux-race", "docker", ["run", "--rm", "--mount",
    `type=bind,source=${source},target=/cli,readonly`, "--workdir", "/cli", process.argv[3],
    "go", "test", "-race", "-json", "./..."]).split("\n").filter(line => line.startsWith("{")).map(JSON.parse);
  report.linuxTests = events.filter(event => event.Action === "pass" && event.Test).length;
  assert.equal(events.filter(event => event.Action === "skip" && event.Test).length, 0, "Linux suite must exercise POSIX checks");
  run("vet", "go", ["vet", "./..."]);
  run("packaged-cli", process.execPath, ["scripts/test-cli-headless.mjs", build.imageId, linux.files[1]]);
  assert.equal(command("git", ["rev-parse", "HEAD"]), revision);
  assert.equal(command("git", ["status", "--porcelain"]), "");
  report.passed = true;
} finally {
  writeFileSync(resolve(evidence, "result.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  writeFileSync(resolve(root, ".cache/cli-domain-acceptance.json"), JSON.stringify({ ...report, evidence }, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ passed: report.passed, revision, checks: report.checks, linuxTests: report.linuxTests, evidence }));
}
