import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("..", import.meta.url));
const endpoint = new URL(process.env.VAULTIX_STORYBOOK_URL ?? "http://127.0.0.1:6006/mcp");
assert.equal(endpoint.hostname, "127.0.0.1", "Only the loopback developer workbench may be tested");
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache/storybook-mcp-proof-"));
let session;
let sequence = 0;
const call = async (method, params = {}, extraHeaders = {}) => {
  const id = ++sequence;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json", Accept: "application/json, text/event-stream",
      ...(session ? { "Mcp-Session-Id": session } : {}), ...extraHeaders
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(180_000)
  });
  session = response.headers.get("mcp-session-id") ?? session;
  const body = await response.text();
  if (!response.ok) return { status: response.status };
  const messages = response.headers.get("content-type")?.includes("text/event-stream")
    ? body.split(/\r?\n/).filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)))
    : [JSON.parse(body)];
  const message = messages.find(item => item.id === id);
  assert.ok(message, `No response to ${method}`);
  return { status: response.status, ...message };
};
const initialize = await call("initialize", {
  protocolVersion: "2025-11-25", capabilities: {},
  clientInfo: { name: "vaultix-workbench-verification", version: "1.0.0" }
});
assert.ok(initialize.result?.protocolVersion);
const discovery = await call("tools/list");
const names = discovery.result.tools.map(tool => tool.name);
for (const name of ["docs-list", "docs-show", "stories-preview"]) assert.ok(names.includes(name), `Missing ${name}`);
assert.equal(names.includes("test-run"), process.platform !== "win32", "Advertise only the supported platform runner");
assert.ok(names.every(name => !name.startsWith("vaultix.")), "Developer MCP must not expose product authority");
const denied = await call("tools/list", {}, { Origin: "https://untrusted.invalid" });
assert.equal(denied.status, 403, "Untrusted browser origins must be denied");
const invoke = async (name, args) => {
  const response = await call("tools/call", { name, arguments: args });
  assert.equal(response.error, undefined, `${name} protocol error`);
  assert.ok(!response.result.isError, `${name} reported an error: ${JSON.stringify(response.result)}`);
  writeFileSync(resolve(evidence, `${name}.json`), JSON.stringify(response.result, null, 2));
  return response.result;
};
const docs = await invoke("docs-list", { withStoryIds: true });
assert.match(JSON.stringify(docs), /ProjectProductCard/);
const component = await invoke("docs-show", { id: "pages-organization-projectproductcard" });
assert.match(JSON.stringify(component), /guideSteps/);
const stories = ["default", "disabled", "contextual-help", "narrow-layout", "no-stats"].map(name => ({ storyId: `pages-organization-projectproductcard--${name}` }));
await invoke("stories-preview", { stories });
let tests;
if (process.platform === "win32") {
  const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--project=storybook", "src/pages/organization/ProjectsPage/components/ProjectProductCard.stories.tsx"], {
    cwd: resolve(root, "core/frontend"), encoding: "utf8", timeout: 180_000
  });
  writeFileSync(resolve(evidence, "cli-tests.log"), `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  assert.equal(result.status, 0, "Windows CLI story tests must pass; see evidence log");
  tests = { runner: "local Vitest CLI", passed: true, embeddedMcpTestTool: "unavailable on Windows: upstream #35864" };
} else {
  tests = await invoke("test-run", { stories, a11y: true });
}
console.log(JSON.stringify({ evidence, protocol: initialize.result.protocolVersion, tools: names, originDenied: denied.status, tests }, null, 2));
