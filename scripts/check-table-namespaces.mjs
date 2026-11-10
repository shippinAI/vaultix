// Fails when an inherited table name comes back where code names a relation (docs/0119).
// Migrations may still name the raw-SQL tables they create under inherited names; the
// namespace migration renames those afterwards.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findReferences, sourceFiles } from "./lib/legacy-table-references.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const map = JSON.parse(readFileSync(resolve(root, "docs/schema/table-namespaces.json"), "utf8"));
const legacy = map.tables.map(table => table.legacy);
const raw = new Set(map.tables.filter(table => !table.tableNameKey).map(table => table.legacy));

// Lines that name a table through a database call; other exact-name strings are JSON keys,
// permission subjects and route words.
const dbCall = /tableName\s*[:=]|\.(From|Into|Table|Update|Delete|Insert|from|into|table|join|leftJoin|innerJoin|hasTable|withSchema)\s*\(|\b(knex|db|tx|trx)\s*\(/;
const exempt = [
  /^core\/backend\/src\/db\/table-namespaces\.ts$/,
  /^core\/backend\/src\/db\/table-namespace-rename\.ts$/,
  /^scripts\/(map-table-namespaces|check-table-namespaces)\.mjs$/,
  /^scripts\/lib\/(table-namespaces|legacy-table-references)\.mjs$/,
  // Generic query-builder tests use "users" as sample input, not the store's table.
  /^core\/backend-go\/internal\/database\/pg\/qb\/(delete|insert|update)_test\.go$/,
  // The ClickHouse audit table lives in another database.
  /^core\/backend-go\/internal\/config\/config\.go$/,
  // Historical upgrade tests pinned to images from before the vx_ names. They seed and inspect
  // a store under its inherited names, and the rollback ones run an older binary on an advanced
  // store, which the rename deliberately ends (docs/0119).
  /^scripts\/(test-(device-grant|early-access|nomen-binding)-migration|verify-device-(delivery|source)-rollback)\.mjs$/
];
// Column names that happen to equal a table name.
const columnWords = /\b(t\.(jsonb|specificType|text|string)\("roles"|"roles"\s*:)/;

const failures = [];
for (const { path, rel } of sourceFiles(root, ["core/backend/src", "core/backend/e2e-test", "core/backend-go", "scripts", "internal", "cmd"])) {
  if (exempt.some(pattern => pattern.test(rel))) continue;
  const migration = rel.includes("/db/migrations/");
  for (const hit of findReferences(readFileSync(path, "utf8"), legacy)) {
    if (migration && raw.has(hit.name)) continue;
    if (hit.kind === "literal" && (!dbCall.test(hit.text) || columnWords.test(hit.text))) continue;
    if (migration && hit.kind === "literal" && hit.name === "queue_jobs") continue;
    failures.push(`${rel}:${hit.line} ${hit.name}: ${hit.text.slice(0, 120)}`);
  }
}
assert.equal(failures.length, 0, `Inherited table names must use their vx_ names (docs/0119):\n${failures.slice(0, 50).join("\n")}`);
console.log(JSON.stringify({ tables: legacy.length, checked: true }));
