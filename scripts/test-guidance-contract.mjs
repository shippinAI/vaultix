import assert from "node:assert/strict";
import { readGuidance } from "../core/frontend/src/hooks/api/vaultix/guidance-contract.ts";
import { getVaultixGuidance } from "../core/backend/src/services/vaultix/guidance.ts";

const document = getVaultixGuidance();
assert.equal(readGuidance(document).length, 6);
const legacy = structuredClone(document);
delete legacy.workflowGuides;
assert.deepEqual(readGuidance(legacy).map(guide => guide.id), ["references", "connections", "organization", "owner"]);
assert.equal(readGuidance({ ...document, workflowGuides: [] }).length, 4);
for (const workflows of [null, {}, [document.workflowGuides[0], document.workflowGuides[0]], [...document.workflowGuides, document.workflowGuides[0]], [document.guides[0]]]) {
  assert.throws(() => readGuidance({ ...document, workflowGuides: workflows }), /unsupported/);
}
for (const patch of [{ component: "execute-script" }, { target: "environment-name] input" }, { target: "admin-signup-password" }, { id: "../read" }, { body: "x".repeat(1501) }, { title: "" }]) {
  const invalid = structuredClone(document);
  Object.assign(invalid.workflowGuides[0].steps[0], patch);
  assert.throws(() => readGuidance(invalid), /unsupported/);
}
const unknown = structuredClone(document);unknown.workflowGuides[0].id = "untrusted-workflow";
assert.throws(() => readGuidance(unknown), /unsupported/);
const misplaced = structuredClone(document);misplaced.guides[0] = misplaced.workflowGuides[0];
assert.throws(() => readGuidance(misplaced), /unsupported/);
console.log("Guidance contract passed: old/new compatibility, optional workflow limits, strict targets, kinds, IDs and text bounds.");
