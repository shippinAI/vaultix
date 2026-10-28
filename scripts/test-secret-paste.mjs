import assert from "node:assert/strict";
import { getKeyValue } from "../core/frontend/src/helpers/parseEnvVar.ts";

const cases = [
  ["", [":", "="], { key: "", value: "", hasAssignment: false }],
  ["  KEY  ", [":", "="], { key: "KEY", value: "", hasAssignment: false }],
  ["KEY=", [":", "="], { key: "KEY", value: "", hasAssignment: true }],
  [" KEY:  ", [":", "="], { key: "KEY", value: "", hasAssignment: true }],
  ["KEY=value:with=delimiters", [":", "="], { key: "KEY", value: "value:with=delimiters", hasAssignment: true }],
  ["KEY:value=other", ["=", ":"], { key: "KEY", value: "value=other", hasAssignment: true }],
  [" KEY = line one\nline two ", ["="], { key: "KEY", value: "line one\nline two", hasAssignment: true }],
  ["KEY=>", ["=>"], { key: "KEY", value: "", hasAssignment: true }],
  ["KEY=", ["", "="], { key: "KEY", value: "", hasAssignment: true }],
  ["KEY=", [], { key: "KEY=", value: "", hasAssignment: false }],
  ["=value", ["="], { key: "", value: "value", hasAssignment: true }]
];
for (const [input, delimiters, expected] of cases) {
  assert.deepEqual(getKeyValue(input, delimiters), expected);
}
console.log(`Secret paste parser: ${cases.length} compatibility and explicit-empty cases passed.`);
