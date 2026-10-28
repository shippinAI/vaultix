// Mechanical ownership discovery. This never marks a file read, authored or migrated.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const compare = (a, b) => a === b ? 0 : a < b ? -1 : 1;
export function validatePlan(plan) {
  assert.equal(plan.schemaVersion, 1);
  const streams = new Map(plan.workstreams.map(stream => [stream.id, stream]));
  assert.equal(streams.size, plan.workstreams.length, "Duplicate workstream.");
  const visited = new Set();
  const active = new Set();
  function visit(id) {
    assert.ok(streams.has(id), `Unknown dependency: ${id}`);
    assert.ok(!active.has(id), `Cyclic migration dependency: ${id}`);
    if (visited.has(id)) return;
    const stream = streams.get(id);
    assert.ok(stream.title && stream.gates.length, `Missing acceptance gates: ${id}`);
    active.add(id);
    stream.dependsOn.forEach(visit);
    active.delete(id);
    visited.add(id);
  }
  streams.forEach((_, id) => visit(id));
  for (const rule of plan.rules) {
    assert.ok(streams.has(rule.workstream), `Unknown rule workstream: ${rule.workstream}`);
    new RegExp(rule.pattern, "i");
  }
}

export function moduleFor(path) {
  for (const pattern of [
    /^(core\/backend\/src\/(?:ee\/)?services\/[^/]+)\//,
    /^(core\/backend-go\/internal\/(?:ee\/)?services\/[^/]+)\//,
    /^(core\/frontend\/src\/pages\/[^/]+\/[^/]+)\//,
    /^(core\/frontend\/src\/(?:hooks\/api|components\/v[23]\/(?:generic|platform))\/[^/]+)\//,
    /^(core\/frontend\/src\/(?:components|context|layouts)\/[^/]+)\//,
    /^((?:panel\/internal|internal|cmd)\/[^/]+)\//
  ]) {
    const match = path.match(pattern);
    if (match) return match[1];
  }
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
}

export function targetFor(path) {
  if (/^core\/frontend\/|^web\//.test(path)) return "React-TypeScript";
  if (/^core\/backend\//.test(path)) return "Go-domain-migration";
  if (/^core\/backend-go\//.test(path)) return "Go-native";
  if (/^core\/wasm\//.test(path)) return "Rust-WASM";
  if (/^(cmd|internal)\//.test(path)) return "Go-client-Rust-injection-boundary";
  if (/^panel\//.test(path)) return "reconcile-into-native-product";
  if (/^db\//.test(path)) return "PostgreSQL-compatible";
  return "supporting-tooling-or-contract";
}

export function generateMap(plan, inventory) {
  validatePlan(plan);
  const rules = plan.rules.map(rule => ({ ...rule, regex: new RegExp(rule.pattern, "i") }));
  const included = new Set(["product-code", "test", "build-and-operations", "asset"]);
  const seen = new Set();
  const rows = inventory.filter(row => included.has(row.kind) && !/^docs\/(migration|capabilities)\/generated\//.test(row.path)).map(row => {
    assert.ok(!seen.has(row.path), `Duplicate input path: ${row.path}`);
    seen.add(row.path);
    const module = moduleFor(row.path);
    const stream = rules.find(rule => rule.regex.test(row.path))?.workstream;
    assert.ok(stream, `Unmapped path: ${row.path}`);
    return { ...row, module, stream, target: targetFor(row.path), language: extname(row.path).slice(1) || "build-config" };
  }).sort((a, b) => compare(a.path, b.path));
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.module}\t${row.stream}\t${row.target}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const fileMap = "path\tmodule\tworkstream\ttarget\tlanguage\tgit_blob\treview_state\n" + rows.map(row =>
    [row.path, row.module, row.stream, row.target, row.language, row.git_blob, row.review_status].join("\t")).join("\n") + "\n";
  const modules = "module\tworkstream\ttarget\tfiles\tsource_digest\treviewed_files\tmigration_state\n" + [...groups.entries()].sort(([a], [b]) => compare(a, b)).map(([key, files]) => {
    const digest = createHash("sha256").update(files.map(row => `${row.path}:${row.git_blob}`).join("\n")).digest("hex");
    const reviewed = files.filter(row => ["reviewed", "authored", "verified"].includes(row.review_status)).length;
    return `${key}\t${files.length}\t${digest}\t${reviewed}\tunassessed`;
  }).join("\n") + "\n";
  const counts = plan.workstreams.map(stream => ({ id: stream.id, files: rows.filter(row => row.stream === stream.id).length, dependsOn: stream.dependsOn }));
  return { fileMap, modules, summary: { schemaVersion: 1, scope: "Discovery only; module boundaries and assignments require review. No module is marked migrated.", mappedFiles: rows.length, moduleGroups: groups.size, excludedKinds: ["documentation", "dependency-lock", "vendored", "generated", "archive"], workstreams: counts } };
}

function main() {
  const mode = process.argv[2] ?? "--check";
  assert.ok(["--write", "--check"].includes(mode));
  const plan = JSON.parse(readFileSync(resolve(root, "docs/migration/workstreams.json"), "utf8"));
  const [header, ...lines] = readFileSync(resolve(root, "docs/code-audit/inventory.tsv"), "utf8").trim().split(/\r?\n/);
  const keys = header.split("\t");
  const inventory = lines.map(line => Object.fromEntries(line.split("\t").map((value, index) => [keys[index], value])));
  const result = generateMap(plan, inventory);
  if (mode === "--check") {
    assert.equal(result.summary.workstreams.find(stream => stream.id === "intake")?.files, 0,
      "Unclassified source files require an explicit workstream assignment before CI can pass.");
  }
  const output = resolve(root, "docs/migration/generated");
  mkdirSync(output, { recursive: true });
  for (const [name, content] of [["files.tsv", result.fileMap], ["modules.tsv", result.modules], ["summary.json", `${JSON.stringify(result.summary, null, 2)}\n`]]) {
    const path = resolve(output, name);
    if (mode === "--write") writeFileSync(path, content);
    else assert.equal(readFileSync(path, "utf8").replaceAll("\r\n", "\n"), content, `Stale migration map: ${name}. Review assignment changes before --write.`);
  }
  console.log(JSON.stringify({ mappedFiles: result.summary.mappedFiles, moduleGroups: result.summary.moduleGroups, intakeFiles: result.summary.workstreams.find(stream => stream.id === "intake").files }));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
