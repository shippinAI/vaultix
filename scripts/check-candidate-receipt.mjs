// Confirms the canonical build evidence belongs to this exact commit and includes the invite-only browser proof.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cache = resolve(root, ".cache");
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const receipts = readdirSync(cache).filter(name => name.startsWith("self-hosted-build-"))
  .map(name => resolve(cache, name, "result.json")).filter(existsSync)
  .map(path => ({ path, data: JSON.parse(readFileSync(path, "utf8")) }))
  .filter(({ data }) => data.revision === head);
const passed = receipts.filter(({ data }) => data.passed === true);
assert.ok(passed.length > 0, `No passed canonical receipt for ${head}`);
const { path, data } = passed.at(-1);
assert.ok(data.steps.every(step => step.passed === true && step.exitCode === 0), "A canonical stage failed");
const browserStage = data.steps.find(step => step.name === "dragonfly-application");
assert.ok(browserStage, "Missing the browser application stage");
const evidence = readFileSync(resolve(dirname(path), browserStage.log), "utf8").match(/Real image application checks passed. Evidence: (.+)/)?.[1]?.trim();
assert.ok(evidence, "The browser stage did not record its evidence");
const proof = JSON.parse(readFileSync(resolve(evidence, "invite-only-access.json"), "utf8"));
assert.ok(proof.passed === true && proof.fixtures === false, "Invite-only browser proof did not pass");
assert.deepEqual(proof.invitedCreateRequests, []);
assert.deepEqual(proof.removedCreateRequests, [403]);
console.log(JSON.stringify({ revision: head, image: data.imageId, receipt: path, browserChecks: proof.checks.length }));
