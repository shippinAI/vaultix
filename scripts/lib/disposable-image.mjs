// Shared disposable-image test infrastructure; no operator targets or raw diagnostics.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

export function createDisposableImageHarness(requestedImage, getPhase) {
  assert.ok(/^[a-zA-Z0-9][a-zA-Z0-9:._/@-]{0,255}$/.test(requestedImage ?? ""), "Provide a local standalone image");
  const resources = [];
  let network;
  function docker(args, { input, env = {}, allowFailure = false, timeout = 120_000 } = {}) {
    const result = spawnSync("docker", args, { input, env: { ...process.env, ...env },
      timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    if (!allowFailure) assert.ok(!result.error && result.status === 0, `Docker ${args[0]} failed during ${getPhase()}`);
    return result;
  }
  const output = (args, options) => docker(args, options).stdout.toString().trim();
  const artifact = JSON.parse(output(["image", "inspect", "--format",
    '{"id":{{json .Id}},"title":{{json (index .Config.Labels "org.opencontainers.image.title")}},"url":{{json (index .Config.Labels "org.opencontainers.image.url")}},"revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}}}', requestedImage]));
  assert.ok(/^sha256:[a-f0-9]{64}$/.test(artifact.id) && artifact.title === "Vaultix" && artifact.url === "https://vaultix.cloud");
  assert.match(artifact.revision, /^[a-f0-9]{40}$/);
  const pause = ms => new Promise(done => setTimeout(done, ms));
  async function waitFor(test, description, timeout = 120_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await test()) return; await pause(1000); }
    throw new Error(`Timed out: ${description}`);
  }
  function container(name, image, args = [], env = {}) {
    assert.ok(network, "Create an owned network first");
    const id = output(["create", "--pull=never", "--init", "--name", name, "--network", network,
      ...Object.keys(env).flatMap(key => ["-e", key]), image, ...args], { env });
    assert.match(id, /^[a-f0-9]{64}$/);
    resources.push(id);
    output(["start", id]);
    return id;
  }
  // Execute HTTP inside the application container: the isolated network has no
  // public port or outbound route. Payloads and responses stay in process memory.
  function http(id, path, options = {}) {
    const runner = `let input="";process.stdin.on("data",b=>input+=b).on("end",async()=>{
      try { const q=JSON.parse(input); const r=await fetch("http://127.0.0.1:8080"+q.path,
        {...q.options,signal:AbortSignal.timeout(20000)});
        process.stdout.write(JSON.stringify({status:r.status,body:await r.text()}));
      } catch { process.exitCode=1; }
    });`;
    const result = docker(["exec", "-i", id, "node", "-e", runner], {
      input: JSON.stringify({ path, options }), allowFailure: true, timeout: 25_000
    });
    if (result.status !== 0 || result.error) return null;
    return JSON.parse(result.stdout.toString());
  }
  async function ready(id) {
    await waitFor(() => http(id, "/api/status")?.status === 200, "application readiness");
  }
  async function request(id, path, { method = "GET", body, token, status = 200 } = {}) {
    const r = http(id, path, { method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.ok(r, `HTTP connection failed during ${getPhase()}`);
    assert.equal(r.status, status, `Unexpected HTTP status during ${getPhase()}`);
    const result = JSON.parse(r.body);
    if (status >= 400) assert.equal(typeof result.error, "string", "Expected a plain API error");
    return result;
  }
  function sql(db, query) {
    return output(["exec", "-i", db, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "vaultix", "-d", "vaultix", "-At"], { input: query });
  }

  function createNetwork(name) {
    assert.equal(network, undefined, "This harness already owns a network");
    assert.match(name, /^vaultix-[a-z-]+-[a-f0-9]{16}$/);
    network = output(["network", "create", "--internal", name]);
    assert.match(network, /^[a-f0-9]{64}$/);
  }
  function cleanup() {
    const removed = resources.reverse().map(id => docker(["rm", "-f", "-v", id], { allowFailure: true }).status === 0);
    const networkRemoved = !network || docker(["network", "rm", network], { allowFailure: true }).status === 0;
    return removed.every(Boolean) && networkRemoved;
  }
  return { artifact, docker, output, container, http, request, ready, waitFor, sql, createNetwork, cleanup };
}
