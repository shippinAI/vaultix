import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(process.argv[2] ? resolve(process.argv[2]) : resolve(root, "core/backend/package.json"));
const { createMongoAbility } = require("@casl/ability");
const { unpackRules } = require("@casl/ability/extra");
const cases = JSON.parse(readFileSync(resolve(root,
  "core/backend-go/internal/services/permission/testdata/sso-bypass.json"), "utf8"));
for (const test of cases) {
  const rules = test.roles.flatMap(({ role, permissions }) => {
    // The only built-in org-role grant for this capability is admin; the
    // production role definitions remain authoritative for other capabilities.
    if (role === "admin") return [{ action: "bypass-sso-enforcement", subject: "sso" }];
    if (role === "member" || role === "no-access") return [];
    assert.equal(role, "custom");
    return unpackRules(permissions);
  }).sort((a, b) => Number(Boolean(a.inverted)) - Number(Boolean(b.inverted)));
  assert.equal(createMongoAbility(rules).can("bypass-sso-enforcement", "sso"), test.allowed, test.name);
}
console.log(JSON.stringify({ passed: true, vectors: cases.length,
  scope: "Existing CASL subject-type semantics; Go tests consume the same vectors. Provider login is not exercised." }));
