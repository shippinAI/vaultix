// Source-review consistency only. Behavioral and live-provider gates are separate.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const require = createRequire(resolve(root, ".ai/package.json"));
const Ajv = require("ajv/dist/2020").default;
const read = path => readFileSync(resolve(root, path), "utf8");
const schema = JSON.parse(read("docs/auth/authority-review.schema.json"));
const validate = new Ajv({ strict: true, allErrors: true }).compile(schema);
const review = JSON.parse(read("docs/auth/authority-review.json"));
assert.ok(validate(review), "Authority review must satisfy its versioned schema");
const paths = new Set();
for (const source of review.sources) {
  assert.ok(!paths.has(source.path), "Duplicate review path");
  paths.add(source.path);
  const path = realpathSync(resolve(root, source.path));
  const rel = relative(root, path);
  assert.ok(rel && !rel.startsWith(`..${sep}`) && rel !== "..", "Review path escapes repository");
  const blob = execFileSync("git", ["hash-object", "--", source.path], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  assert.equal(blob, source.blob, `Stale source review: ${source.path}`);
  const lines = read(source.path).trimEnd().split(/\r?\n/).length;
  if (source.read !== "complete") for (const [start, end] of source.read) {
    assert.ok(start <= end && end <= lines, `Invalid reviewed range: ${source.path}`);
  }
}
const contract = read(review.contract);
for (const match of contract.matchAll(/\]\(([^)]+)\)/g)) {
  if (/^https:\/\//.test(match[1])) continue;
  readFileSync(resolve(root, dirname(review.contract), match[1].split("#")[0]));
}
// Negative fixtures ensure this review cannot silently advertise live acceptance.
assert.equal(validate({ ...review, externalBearerAcceptance: "enabled" }), false);
assert.equal(validate({ ...review, sources: [] }), false);
assert.equal(validate({ ...review, sources: [{ ...review.sources[0], blob: "unknown" }] }), false);
assert.ok(validate(review));
console.log(JSON.stringify({ passed: true, reviewedSources: paths.size, negativeFixtures: 3,
  scope: "Source fingerprint, range, local-link and schema consistency only; no runtime or live identity acceptance" }));
