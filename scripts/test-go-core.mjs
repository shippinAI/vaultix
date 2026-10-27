import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [image, provider = "dragonfly", runner = "vaultix:verify-go"] = process.argv.slice(2);
if (!image || !["dragonfly", "redis"].includes(provider)) {
  throw new Error("Usage: node scripts/test-go-core.mjs <local standalone image> [dragonfly|redis] [local Go test image]");
}
const inspect = (reference) => {
  const result = spawnSync("docker", ["image", "inspect", reference], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("Build the requested image locally before verification.");
  return JSON.parse(result.stdout)[0];
};
const artifact = inspect(image);
const testArtifact = inspect(runner);
if (artifact.Config.Labels?.["org.opencontainers.image.title"] !== "Vaultix"
  || artifact.Config.Labels?.["org.opencontainers.image.source"] !== "https://github.com/shippinAI/vaultix") {
  throw new Error("The application image must be the canonical Vaultix standalone artifact.");
}
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache", "go-proof-"));
console.log(`Verifying Go integrations with ${provider}; evidence: ${evidence}`);
const result = spawnSync("docker", [
  "run", "--rm", "--init", "--pull=never",
  "--add-host", "host.docker.internal:host-gateway",
  "-v", "/var/run/docker.sock:/var/run/docker.sock",
  "-e", "GOTOOLCHAIN=local", "-e", "GOTELEMETRY=off",
  "-e", "TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal",
  "-e", `VAULTIX_TEST_IMAGE=${artifact.Id}`,
  "-e", `VAULTIX_TEST_CACHE_PROVIDER=${provider}`,
  testArtifact.Id,
  "go", "test", "-mod=readonly", "-count=1", "-p", "1", "-tags", "integration",
  "-race", "-timeout", "300s", "-json", "./tests/..."
], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

// Persist only test identities/outcomes. HTTP diagnostics from the fixture can
// contain credentials; never publish its raw stdout/stderr in CI artifacts.
const events = [];
for (const line of (result.stdout ?? "").split(/\r?\n/)) {
  if (!line) continue;
  try {
    const event = JSON.parse(line);
    if (["pass", "fail", "skip"].includes(event.Action)) {
      events.push({ action: event.Action, package: event.Package, test: event.Test ?? null, elapsed: event.Elapsed ?? 0 });
    }
  } catch {
    // Non-JSON subprocess diagnostics are deliberately excluded.
  }
}
const count = (action) => events.filter((event) => event.test && event.action === action).length;
const failed = events.filter((event) => event.action === "fail");
const passed = result.status === 0 && failed.length === 0 && count("pass") > 0;
const report = {
  status: passed ? "passed" : "failed", provider, image: artifact.Id, runner: testArtifact.Id,
  exitCode: result.status, signal: result.signal, processError: result.error?.code ?? null,
  tests: { passed: count("pass"), failed: count("fail"), skipped: count("skip") }, events,
  limits: ["Provider credentials are not inherited; unavailable external-provider tests remain skipped.",
    "SoftHSM tests require their separate runtime; this suite does not establish hardware certification or complete capability parity."]
};
writeFileSync(resolve(evidence, "result.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status: report.status, tests: report.tests, failed }));
if (!passed) process.exitCode = 1;
