// Fails when an inherited table name comes back where code names a relation (docs/0119).
//
// Distinctive names (with an underscore, such as vaultix_device_session_events) are flagged
// anywhere in runtime code, constants included. Generic one-word names (users, secrets) are
// flagged in SQL positions and as the table argument of a database or identifier call, since
// elsewhere they are JSON keys, permission subjects and route words. Migrations may still name
// the raw-SQL tables they create under inherited names; the namespace migration renames those.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findReferences, sourceFiles } from "./lib/legacy-table-references.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const map = JSON.parse(readFileSync(resolve(root, "docs/schema/table-namespaces.json"), "utf8"));
const legacy = map.tables.map(table => table.legacy);
const raw = new Set(map.tables.filter(table => !table.tableNameKey).map(table => table.legacy));
const distinctive = legacy.filter(name => name.includes("_")).sort((a, b) => b.length - a.length);
const generic = legacy.filter(name => !name.includes("_")).sort((a, b) => b.length - a.length);

const anywhere = new RegExp(`(?<![A-Za-z0-9_$])(${distinctive.join("|")})(?![A-Za-z0-9_])`, "g");
// The table argument of a database or identifier call, in TypeScript, JavaScript and Go.
const callArgument = new RegExp(
  `\\b(?:knex|db|tx|trx|connection|conn|client|from|into|table|join|leftJoin|innerJoin|rightJoin|hasTable|withSchema|createTable|alterTable|dropTable|dropTableIfExists|Identifier|Table|From|Into|Update|Delete|Insert|Join)\\s*(?:\\(|\\{)\\s*["'\`](${generic.join("|")})["'\`]`,
  "g"
);

const exempt = [
  /^core\/backend\/src\/db\/table-namespaces\.ts$/,
  /^core\/backend\/src\/db\/table-namespace-(rename|names|index-names)\.ts$/,
  /^scripts\/(map-table-namespaces|check-table-namespaces)\.mjs$/,
  /^scripts\/lib\/(table-namespaces|legacy-table-references)\.mjs$/,
  // Generic query-builder tests use "users" as sample input, not the store's table.
  /^core\/backend-go\/internal\/database\/pg\/qb\/(delete|insert|update)_test\.go$/,
  // The ClickHouse audit table lives in another database.
  /^core\/backend-go\/internal\/config\/config\.go$/,
  // The upgrade tool reads either side of the rename by design.
  /^internal\/platform\/(schema|docker)\.go$/,
  /^scripts\/test-server-lifecycle\.mjs$/,
  // Historical upgrade tests pinned to images from before the vx_ names. They seed and inspect
  // a store under its inherited names, and the rollback ones run an older binary on an advanced
  // store, which the rename deliberately ends (docs/0119).
  /^scripts\/(test-(device-grant|early-access|nomen-binding)-migration|verify-device-(delivery|source)-rollback)\.mjs$/
];

// Exact, reviewed uses of a table-like word that are not this store's tables.
const notTables = [
  // A column alias in SQL, not the super_admin table.
  { file: /^core\/backend-go\/internal\/services\/auth\/apiauth\/authenticator\.go$/, text: 'db:"super_admin"' },
  // ClickHouse keeps its own audit_logs table in another database.
  {
    file: /^core\/backend\/src\/(lib\/config\/env|db\/run-clickhouse-migrations|db\/clickhouse-migration-runner|auto-start-migrations|shippin\/services\/audit-log\/audit-log-queue\.test)\.ts$/,
    text: /ClickHouse|CLICKHOUSE|DEFAULT_TABLE_NAME = "audit_logs"|default\("audit_logs"\)/
  },
  // An error category and metric names.
  { file: /^core\/backend\/src\/lib\/errors\/classify(\.test)?\.ts$/, text: "rate_limit" },
  { file: /^core\/backend\/src\/lib\/telemetry\/(metrics|telemetry-attributes)\.ts$/, text: "rate_limit." },
  // Datadog's API path.
  { file: /^core\/backend\/src\/shippin\/services\/secret-rotation-v2\/datadog-api-key\//, text: "api_keys" },
  // Progress messages inside migrations.
  { file: /\/db\/migrations\//, text: /console\.(info|log)|\blog\(|^\s*"[^"]*",?\s*$/ }
];
const matches = (entry, source) => (typeof entry.text === "string" ? source.includes(entry.text) : entry.text.test(source));

const failures = [];
for (const { path, rel } of sourceFiles(root, ["core/backend/src", "core/backend/e2e-test", "core/backend-go", "scripts", "internal", "cmd"])) {
  if (exempt.some(pattern => pattern.test(rel))) continue;
  const migration = rel.includes("/db/migrations/");
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");
  const report = (line, name, why) => {
    if (migration && raw.has(name)) return;
    const source = lines[line - 1];
    if (notTables.some(entry => entry.file.test(rel) && matches(entry, source))) return;
    failures.push(`${rel}:${line} ${name} (${why}): ${source.trim().slice(0, 120)}`);
  };
  for (const hit of findReferences(text, legacy)) if (hit.kind === "sql") report(hit.line, hit.name, "sql");
  lines.forEach((line, index) => {
    if (/^\s*(\/\/|\*|#)/.test(line)) return;
    for (const match of line.matchAll(anywhere)) report(index + 1, match[1], "name");
    for (const match of line.matchAll(callArgument)) report(index + 1, match[1], "call");
  });
}
const unique = [...new Set(failures)];
assert.equal(unique.length, 0, `Inherited table names must use their vx_ names (docs/0119):\n${unique.slice(0, 80).join("\n")}${unique.length > 80 ? `\n… ${unique.length - 80} more` : ""}`);
console.log(JSON.stringify({ tables: legacy.length, checked: true }));
