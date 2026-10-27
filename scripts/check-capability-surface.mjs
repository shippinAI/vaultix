// Route preservation is a regression gate, not proof that a workflow works.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = resolve(root, "contracts/vaultix-capability-surface.v1.json");
const methods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

export function uiRoutes(source) {
  const body = source.match(/export interface FileRoutesByFullPath \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(body, "Generated UI route interface is missing; build the frontend first.");
  const routes = [...body.matchAll(/^\s+'([^']+)':/gm)].map(match => match[1]);
  assert.ok(routes.includes("/") && routes.includes("/login"), "UI route extraction is incomplete.");
  return [...new Set(routes)].sort();
}

export function apiOperations(schema) {
  assert.equal(schema?.info?.title, "Vaultix API", "Expected the running Vaultix OpenAPI document.");
  assert.ok(schema.paths && typeof schema.paths === "object", "Missing OpenAPI paths.");
  const operations = Object.entries(schema.paths).flatMap(([path, definition]) =>
    Object.keys(definition).filter(method => methods.has(method)).map(method => `${method.toUpperCase()} ${path}`)
  ).sort();
  assert.ok(operations.length, "OpenAPI document has no operations.");
  return operations;
}

export function missingSurface(baseline, current) {
  assert.equal(baseline.schemaVersion, 1, "Unsupported capability surface baseline.");
  const missing = {};
  for (const key of ["uiRoutes", "apiOperations"]) {
    assert.ok(Array.isArray(baseline[key]) && baseline[key].length, `Empty baseline ${key}.`);
    assert.ok(baseline[key].every(value => typeof value === "string" && value.length), `Invalid baseline ${key}.`);
    if (current[key] === undefined) continue;
    const available = new Set(current[key]);
    missing[key] = baseline[key].filter(value => !available.has(value));
  }
  return missing;
}

async function main() {
  const [mode, origin] = process.argv.slice(2);
  assert.ok(["--check-ui", "--check", "--capture"].includes(mode), "Use --check-ui, --check ORIGIN, or --capture ORIGIN.");
  const current = { uiRoutes: uiRoutes(readFileSync(resolve(root, "core/frontend/src/routeTree.gen.ts"), "utf8")) };
  if (mode !== "--check-ui") {
    assert.match(origin ?? "", /^http:\/\/127\.0\.0\.1:\d+$/, "Use a local standalone image.");
    const response = await fetch(`${origin}/api/docs/json`, { signal: AbortSignal.timeout(30000), redirect: "error" });
    assert.equal(response.status, 200, "Could not read the image's API schema.");
    current.apiOperations = apiOperations(await response.json());
  }
  if (mode === "--capture") {
    // Deliberate baseline changes must be reviewed with compatibility/migration evidence.
    const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    writeFileSync(baselinePath, `${JSON.stringify({ schemaVersion: 1, sourceCommit,
      scope: "Declared UI paths and documented API method/path pairs only; no behavioral parity claim.", ...current }, null, 2)}\n`);
  } else {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const missing = missingSurface(baseline, current);
    for (const [key, values] of Object.entries(missing)) {
      assert.deepEqual(values, [], `Removed ${key}. Restore them or review an explicit compatibility migration; do not silently recapture the baseline.`);
    }
  }
  console.log(JSON.stringify({ mode, uiRoutes: current.uiRoutes.length, apiOperations: current.apiOperations?.length }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
