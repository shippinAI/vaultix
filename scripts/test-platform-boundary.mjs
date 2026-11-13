#!/usr/bin/env node
// platform/engine must never depend on platform/shippin (platform/README.md).
// Also holds the older engine-internal shippin folders at a ceiling so that debt only shrinks.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const grep = (...args) => {
  try {
    return execFileSync("git", ["grep", "-lE", ...args], { encoding: "utf8", maxBuffer: 1 << 26 })
      .split("\n").filter(Boolean);
  } catch (error) {
    if (error.status === 1) return [];
    throw error;
  }
};

const crossing = grep("platform/shippin", "--", "platform/engine")
  .filter(path => !/\.(md|mdx|tsv|json)$/.test(path));
assert.deepEqual(crossing, [], `platform/engine must not reference platform/shippin:\n${crossing.join("\n")}`);

const ceilings = { typescript: 356, go: 9 };
const typescript = grep("from ['\"](@app/shippin/|(\\.\\./)+shippin/)", "--",
  "platform/engine/backend/src", ":!platform/engine/backend/src/shippin").length;
const go = grep("internal/shippin", "--",
  "platform/engine/backend-go", ":!platform/engine/backend-go/internal/shippin").length;
assert.ok(typescript <= ceilings.typescript,
  `engine TypeScript files importing the internal shippin folder rose to ${typescript} (ceiling ${ceilings.typescript})`);
assert.ok(go <= ceilings.go,
  `engine Go files importing the internal shippin folder rose to ${go} (ceiling ${ceilings.go})`);

console.log(JSON.stringify({ crossing: 0, internalShippinImporters: { typescript, go }, ceilings }));
