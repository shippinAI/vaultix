// The AI connection and persona schemas (docs/0126) judged by a JSON Schema 2020-12 validator
// against the same fixtures the Go rules are tested on (assistant/documents_test.go). Together the
// two tests mean the schema the UI reads and the rules the server applies accept the same
// documents. Fixtures marked schemaValid:true, valid:false are refused only by server rules.
// strictTypes and strictRequired are authoring lints that 2020-12 does not require; unknown
// keywords and other strict checks stay on.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, ".ai/package.json"));
const Ajv = require("ajv/dist/2020");
const spec = resolve(root, "platform/engine/backend-go/internal/services/assistant/spec");
const read = path => JSON.parse(readFileSync(resolve(spec, path), "utf8"));

let checked = 0;
for (const [schemaFile, fixtureFile] of [
  ["schema/vaultix.ai-connection.v1.schema.json", "testdata/connections.json"],
  ["schema/vaultix.ai-persona.v1.schema.json", "testdata/personas.json"]
]) {
  const ajv = new Ajv({ strict: true, strictTypes: false, strictRequired: false, allErrors: true, unicodeRegExp: true });
  const validate = ajv.compile(read(schemaFile));
  const { cases } = read(fixtureFile);
  assert.ok(cases.length >= 20, `${fixtureFile} has too few cases`);
  for (const c of cases) {
    const expected = c.schemaValid ?? c.valid;
    const actual = validate(c.document);
    assert.equal(actual, expected, `${fixtureFile} / ${c.name}: schema says ${actual}, fixture says ${expected}: ${JSON.stringify(validate.errors)}`);
    checked += 1;
  }
}
console.log(JSON.stringify({ passed: true, checked }));
