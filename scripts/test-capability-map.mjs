import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtempSync, rmdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { capabilities, phases } from "../docs/capabilities/catalog.mjs";
import { apiGroup, uiGroup, validateCatalog, generate, artifacts } from "./map-capabilities.mjs";
import { createPlanServer } from "./serve-capability-plan.mjs";

validateCatalog();
assert.throws(() => validateCatalog([...capabilities, capabilities[0]]), /Duplicate/);
assert.throws(() => validateCatalog([{ ...capabilities[0], group: "unknown" }]), /Unknown group/);
assert.throws(
  () => validateCatalog([{ ...capabilities[0], implementation: "Shipped" }]),
  /Unknown implementation/,
);
assert.throws(
  () => validateCatalog([{ ...capabilities[0], acceptance: "" }]),
  /missing acceptance/,
);
assert.throws(() => validateCatalog([{ ...capabilities[0], evidence: "Ready" }]), /cannot certify/);
assert.throws(
  () =>
    validateCatalog([{ ...capabilities[0], implementation: "Scoped evidence", references: [] }]),
  /needs references/,
);
assert.throws(
  () => validateCatalog(capabilities, [{ ...phases[0], dependsOn: ["P0"] }, ...phases.slice(1)]),
  /Cyclic/,
);
assert.throws(
  () =>
    validateCatalog(capabilities, [{ ...phases[0], dependsOn: ["unknown"] }, ...phases.slice(1)]),
  /Unknown phase/,
);
assert.throws(() => apiGroup("POST /api/v1/unknown"), /Unclassified/);
assert.throws(() => uiGroup("/unknown/path"), /Unclassified/);
const data = generate();
assert.equal(data.surface.length, data.coverage.uiRoutes + data.coverage.apiOperations);
assert.equal(new Set(data.source.map((row) => row.path)).size, data.source.length);
assert.equal(data.providers.filter((item) => item.family === "Dynamic credentials").length, 27);
assert.ok(
  data.providers.some(
    (item) => item.family === "Dynamic credentials" && item.name === "aws-elasticache",
  ),
);
assert.ok(!data.providers.some((item) => /templateUtils|\/models\.ts|\/index\.ts/.test(item.path)));
assert.ok(
  !data.source.some((item) => /^docs\/(migration|capabilities)\/generated\//.test(item.path)),
);
assert.deepEqual(artifacts(data), artifacts(generate()));
const emptyAdapter = mkdtempSync(fileURLToPath(new URL("../core/backend/src/services/app-connection/.vaultix-empty-provider-", import.meta.url)));
try {
  assert.deepEqual(generate().providers, data.providers, "Empty local directories cannot invent provider capabilities");
} finally {
  rmdirSync(emptyAdapter);
}
assert.equal(
  Object.values(data.domainCounts).reduce((sum, group) => sum + group.api, 0),
  data.coverage.apiOperations,
);
const server = createPlanServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const root = await fetch(origin);
  assert.equal(root.status, 200);
  assert.match(root.headers.get("content-security-policy"), /connect-src 'self'/);
  assert.equal((await fetch(origin, { method: "POST", body: "no actions" })).status, 405);
  assert.equal((await fetch(`${origin}/compose/vaultix.env`)).status, 404);
  assert.equal((await fetch(`${origin}/reference?path=compose%2Fvaultix.env`)).status, 404);
  assert.equal((await fetch(`${origin}/reference?path=..%2F..%2FWindows%2Fwin.ini`)).status, 404);
  assert.equal(
    (await fetch(`${origin}/reference?path=${encodeURIComponent(capabilities[0].references[0])}`))
      .status,
    200,
  );
  assert.equal((await fetch(`${origin}/catalog.json`, { method: "HEAD" })).status, 200);
  const rebindingStatus = await new Promise((resolve, reject) => {
    const call = request(origin, { headers: { host: "untrusted.example" } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    call.on("error", reject);
    call.end();
  });
  assert.equal(rebindingStatus, 403);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
console.log(
  "Capability map checks passed: coverage, unknowns, phase cycles, evidence limits, provider omissions, deterministic output and read-only file boundary.",
);
