import assert from "node:assert/strict";
import { collectGoTestEvidence } from "./go-test-evidence.mjs";

const credential = "fixture-credential-must-never-enter-evidence";
const payload = [
  { Action: "output", Package: "fixture/secrets", Output: `infra: starting nodejs: context deadline exceeded ${credential}` },
  { Action: "output", Package: "fixture/auth", Output: `infra.bootstrap: returned 500: {"token":"${credential}"}` },
  { Action: "output", Package: "fixture/auth", Output: `--- PASS: TestTimeout (${credential})` },
  { Action: "output", Package: "fixture/auth", Output: { token: credential } },
  { Action: "pass", Package: "fixture/auth", Test: "TestToken", Elapsed: 0.25, Output: credential, token: credential },
  { Action: "fail", Package: "fixture/secrets", Output: credential },
  { Action: "skip", Package: "fixture/provider", Test: "TestExternalProvider" }
].map(event => JSON.stringify(event)).join("\n");
const result = collectGoTestEvidence(`not-json ${credential}\nnull\n${payload}\n`);
assert.deepEqual(result.events, [
  { action: "pass", package: "fixture/auth", test: "TestToken", elapsed: 0.25 },
  { action: "fail", package: "fixture/secrets", test: null, elapsed: 0 },
  { action: "skip", package: "fixture/provider", test: "TestExternalProvider", elapsed: 0 }
]);
assert.deepEqual(result.diagnostics, [
  { package: "fixture/secrets", phase: "application", causes: ["deadline"] },
  { package: "fixture/auth", phase: "bootstrap", causes: [] }
]);
assert.equal(JSON.stringify(result).includes(credential), false);
assert.deepEqual(collectGoTestEvidence(""), { events: [], diagnostics: [] });
console.log("Go evidence checks passed: outcomes retained; setup diagnostics exclude payloads and credentials.");
