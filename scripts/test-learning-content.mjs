import assert from "node:assert/strict";
import { readVaultixLearning, selectVaultixLearning } from "../core/frontend/src/hooks/api/vaultix/learning.ts";

const tip = { id: "reference-scope", kind: "did-you-know", title: "Choose a scope", description: "Choose your app and environment.", context: ["references"], source: "catalog" };
const catalog = { didYouKnow: [tip], knowledgeDrops: [], enterpriseCapabilities: [{ id: "access", title: "Access", summary: "Access controls", category: "Governance", featurePolicy: "included", reviewStatus: "in-progress" }] };
assert.deepEqual(readVaultixLearning({}), { didYouKnow: [], knowledgeDrops: [], enterpriseCapabilities: [] });
const parsed = readVaultixLearning(catalog);
assert.equal(selectVaultixLearning(parsed.didYouKnow, "references").length, 1);
assert.deepEqual(selectVaultixLearning(parsed.didYouKnow, "connections"), []);
for (const patch of [
  { source: "generated" }, { source: "database" }, { title: "x".repeat(161) }, { description: "x".repeat(1001) },
  { id: "../run" }, { title: " " }, { context: ["references", "references"] }, { context: ["execute"] },
  { context: [] }, { kind: "knowledge-drop" }
]) assert.throws(() => readVaultixLearning({ ...catalog, didYouKnow: [{ ...tip, ...patch }] }), /not supported/);
for (const didYouKnow of [null, {}, [tip, tip], Array.from({ length: 13 }, (_, i) => ({ ...tip, id: `tip-${i}` }))]) {
  assert.throws(() => readVaultixLearning({ ...catalog, didYouKnow }), /not supported/);
}
assert.throws(() => readVaultixLearning({ ...catalog, knowledgeDrops: [{ ...tip, kind: "knowledge-drop" }] }), /not supported/);
assert.throws(() => readVaultixLearning({ ...catalog, enterpriseCapabilities: [{ ...catalog.enterpriseCapabilities[0], reviewStatus: "verified" }] }), /not supported/);
console.log("Learning contract: compatibility, context filtering, bounds, duplicate IDs, provenance and readiness checks passed.");
