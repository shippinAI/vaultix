import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = `vaultix-unit-${randomBytes(6).toString("hex")}`;
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache", "unit-proof-"));
const docker = (args, options = {}) => {
  const result = spawnSync("docker", args, { cwd: root, stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`Unit verification failed: ${args[0]}`);
  return result;
};
try {
  docker(["create", "--init", "--name", run, "--entrypoint", "node", "vaultix:verify-backend", "--max-old-space-size=4096", "node_modules/vitest/vitest.mjs", "run", "-c", "vitest.unit.config.mts", "--maxWorkers=2", "--reporter=default", "--reporter=json", "--outputFile=/app/test-results.json"]);
  for (const entry of ["src", "vitest.unit.config.mts"]) docker(["cp", resolve(root, "core/backend", entry), `${run}:/app/`]);
  docker(["start", "--attach", run]);
  const exit = docker(["inspect", "--format", "{{.State.ExitCode}}", run], { stdio: "pipe", encoding: "utf8" });
  if (exit.stdout.trim() !== "0") throw new Error("Unit suite failed.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  spawnSync("docker", ["cp", `${run}:/app/test-results.json`, resolve(evidence, "test-results.json")], { stdio: "ignore" });
  spawnSync("docker", ["rm", "-f", run], { stdio: "ignore" });
  console.log(`Unit evidence directory: ${evidence}`);
}
