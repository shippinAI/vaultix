// Builds and exercises the real application without a hosted runner or registry.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] ?? "--application";
assert.ok(process.argv.length <= 3 && ["--check", "--application", "--capabilities", "--help"].includes(mode),
  "Usage: node scripts/build-self-hosted.mjs [--check|--application|--capabilities]");
if (mode === "--help") {
  console.log("--check: read-only prerequisites. --application (default): canonical build and real-image acceptance. --capabilities: also run existing native Go/backend capability suites. No publish or deploy.");
  process.exit(0);
}
const command = (name, args) => execFileSync(name, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const cleanRevision = () => {
  assert.equal(command("git", ["status", "--porcelain=v1", "--untracked-files=normal"]), "", "Commit or preserve pending changes before building a source-revision image");
  return command("git", ["rev-parse", "HEAD"]);
};
const revision = cleanRevision();
assert.match(revision, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const nodeMajor = Number(process.versions.node.split(".")[0]);
assert.ok(nodeMajor >= 22, "Node 22 or newer is required");
command(bash, ["--version"]);
command(bash, ["-c", "for tool in node docker rg curl openssl tar; do command -v \"$tool\" >/dev/null || exit 1; done"]);
command("tar", ["--version"]);
command("docker", ["compose", "version", "--short"]);
const daemon = JSON.parse(command("docker", ["info", "--format", '{"os":"{{.OSType}}","architecture":"{{.Architecture}}"}']));
assert.equal(daemon.os, "linux", "Use a Linux Docker engine");
const require = createRequire(resolve(root, "core/e2e/package.json"));
const { chromium } = require("@playwright/test");
require("@axe-core/playwright");
if (!process.env.VAULTIX_BROWSER_CHANNEL) assert.ok(existsSync(chromium.executablePath()), "Install the pinned Playwright Chromium browser from core/e2e before verification");
const preflight = { revision, node: process.versions.node, docker: daemon, scope: mode, automaticPublication: false };
if (mode === "--check") {
  console.log(JSON.stringify(preflight, null, 2));
  process.exit(0);
}

mkdirSync(resolve(root, ".cache"), { recursive: true });
const lock = resolve(root, ".cache/self-hosted-build.lock");
const lockFd = openSync(lock, "wx", 0o600);
writeFileSync(lockFd, JSON.stringify({ pid: process.pid, revision }) + "\n");
closeSync(lockFd);
// Never steal a lock: after an interrupted process, the operator checks it first.
process.on("exit", () => unlinkSync(lock));
const evidence = mkdtempSync(resolve(root, ".cache/self-hosted-build-"));
const source = resolve(evidence, "source");
mkdirSync(source);
const image = `vaultix:${revision}`;
const report = { ...preflight, image, passed: false, steps: [], excluded: ["operator deployment", "registry publication", "external provider/issuer acceptance", "whole-product parity"] };
const save = () => writeFileSync(resolve(evidence, "result.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
const step = (name, executable, args, env = {}) => {
  const log = `${String(report.steps.length + 1).padStart(2, "0")}-${name}.log`;
  const entry = { name, log, passed: false };
  report.steps.push(entry); save();
  console.log(`Vaultix: ${name}`);
  const fd = openSync(resolve(evidence, log), "wx", 0o600);
  let result;
  try {
    result = spawnSync(executable, args, { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", fd, fd] });
  } finally { closeSync(fd); }
  entry.exitCode = result.status;
  entry.passed = result.status === 0 && !result.error;
  save();
  assert.ok(entry.passed, `${name} failed; inspect ${resolve(evidence, log)}`);
};
const node = (name, script, ...args) => step(name, process.execPath, [script, ...args]);
try {
  node("source-inventory", "scripts/audit-codebase.mjs", "--check");
  node("migration-map", "scripts/map-migration.mjs", "--check");
  step("owned-source", bash, ["scripts/check-owned.sh"]);
  // The archive cannot include ignored credentials, build output or local dependency trees.
  step("source-archive", "git", ["archive", "--format=tar", `--output=${resolve(evidence, "source.tar")}`, revision, "core"]);
  step("extract-source", "tar", ["-xf", resolve(evidence, "source.tar"), "-C", source]);
  const context = resolve(source, "core");
  const dockerfile = resolve(context, "Dockerfile.standalone-vaultix");
  step("canonical-image", "docker", ["build", "-f", dockerfile, "--build-arg", `VAULTIX_SOURCE_REVISION=${revision}`, "-t", image, context]);
  report.imageId = command("docker", ["image", "inspect", "--format", "{{.Id}}", image]);
  assert.match(report.imageId, /^sha256:[a-f0-9]{64}$/);
  node("image-identity", "scripts/check-image-identity.mjs", report.imageId, "engine", revision);
  node("identity-lifetime", "scripts/test-identity-policy-startup.mjs", report.imageId);
  step("dragonfly-application", bash, ["scripts/smoke-image.sh", report.imageId, "dragonfly"], { VAULTIX_IMAGE_APP_PROOF: "1" });
  step("redis-application", bash, ["scripts/smoke-image.sh", report.imageId, "redis"], { VAULTIX_IMAGE_APP_PROOF: "0" });
  node("encrypted-recovery", "scripts/test-encrypted-recovery.mjs", report.imageId);
  node("tenant-isolation", "scripts/test-tenant-isolation.mjs", report.imageId);
  node("proxy-boundary", "scripts/test-proxy-boundary.mjs", report.imageId);
  for (const cache of ["dragonfly", "redis"]) node(`admission-${cache}`, "scripts/test-production-admission.mjs", report.imageId, cache);
  if (mode === "--capabilities") {
    step("native-test-image", "docker", ["build", "-f", dockerfile, "--target", "go-builder", "-t", "vaultix:verify-go", context]);
    for (const cache of ["dragonfly", "redis"]) node(`native-${cache}`, "scripts/test-go-core.mjs", report.imageId, cache);
    step("backend-test-image", "docker", ["build", "-f", dockerfile, "--target", "backend-build", "-t", "vaultix:verify-backend", context]);
    node("backend-unit", "scripts/test-unit-core.mjs");
    for (const cache of ["dragonfly", "redis"]) node(`backend-${cache}`, "scripts/test-core.mjs", cache);
  }
  assert.equal(cleanRevision(), revision, "Source changed during verification; no successful receipt will be issued");
  assert.equal(command("docker", ["image", "inspect", "--format", "{{.Id}}", image]), report.imageId, "Image tag changed during verification");
  report.passed = true; save();
  console.log(`Verified ${report.imageId}\nImage: ${image}\nEvidence: ${resolve(evidence, "result.json")}\nNo registry push or deployment was performed.`);
} catch (error) {
  save();
  console.error(error.message);
  console.error(`Incomplete build evidence: ${resolve(evidence, "result.json")}`);
  process.exitCode = 1;
}
