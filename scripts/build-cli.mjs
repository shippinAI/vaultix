// Native CLI delivery from committed source, without a registry or global install.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

assert.ok(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === "--help"),
  "Usage: node scripts/build-cli.mjs [--help]");
if (process.argv[2] === "--help") {
  console.log("Build committed native vaultix and vaultixl binaries for Linux/amd64 and Windows/amd64. Requires Git, tar and the go.mod toolchain. No global installation, download wrapper or publication.");
  process.exit(0);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const command = (name, args, cwd = root, env = {}) => execFileSync(name, args, {
  cwd, env: { ...process.env, ...env }, encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"], windowsHide: true
}).trim();
const cleanRevision = () => {
  assert.equal(command("git", ["status", "--porcelain=v1", "--untracked-files=normal"]), "",
    "Commit or preserve pending changes before building native CLI artifacts");
  return command("git", ["rev-parse", "HEAD"]);
};
const revision = cleanRevision();
mkdirSync(resolve(root, ".cache"), { recursive: true });
const directory = mkdtempSync(resolve(root, ".cache/cli-build-"));
const source = resolve(directory, "source");
mkdirSync(source);
const archive = resolve(directory, "source.tar");
command("git", ["-c", "core.autocrlf=false", "-c", "core.eol=lf", "archive", "--format=tar",
  `--output=${archive}`, revision, "cmd", "internal", "go.mod", "go.sum"]);
command("tar", ["-xf", archive, "-C", source]);
const sha256 = file => createHash("sha256").update(readFileSync(file)).digest("hex");
const receipt = {
  revision, sourceArchiveSha256: sha256(archive), toolchain: command("go", ["version"]),
  passed: false, artifacts: [], exclusions: ["global installation", "hosted login", "full CLI feature parity"]
};
for (const target of ["linux", "windows"]) {
  const platform = `${target}/amd64`;
  const folder = resolve(directory, `${target}-amd64`);
  mkdirSync(folder);
  const suffix = target === "windows" ? ".exe" : "";
  const file = resolve(folder, `vaultix${suffix}`);
  command("go", ["build", "-buildvcs=false", "-trimpath", "-o", file, "./cmd/vaultix"], source,
    { GOOS: target, GOARCH: "amd64", CGO_ENABLED: "0", GOWORK: "off" });
  const alternate = resolve(folder, `vaultixl${suffix}`);
  copyFileSync(file, alternate);
  const digest = sha256(file);
  assert.equal(sha256(alternate), digest, "Native command names must contain the same program");
  receipt.artifacts.push({ platform, files: [file, alternate], sha256: digest });
}
assert.equal(cleanRevision(), revision, "Source changed during CLI delivery");
receipt.passed = true;
writeFileSync(resolve(directory, "result.json"), JSON.stringify(receipt, null, 2) + "\n");
writeFileSync(resolve(root, ".cache/committed-cli.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify(receipt));
