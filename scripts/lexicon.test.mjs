#!/usr/bin/env node
// docs/lexicon.json stays well-formed and every path it cites exists.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const lexicon = JSON.parse(readFileSync("docs/lexicon.json", "utf8"));

test("lexicon entries are complete, unique and cite real paths", () => {
  assert.equal(lexicon.schemaVersion, 1);
  const seen = new Set();
  for (const entry of lexicon.terms) {
    for (const key of ["term", "meaning", "status"]) assert.ok(entry[key]?.trim(), `${entry.term}: ${key} is required`);
    assert.ok(Array.isArray(entry.owner_says) && Array.isArray(entry.where), `${entry.term}: owner_says and where are lists`);
    const key = entry.term.toLowerCase();
    assert.ok(!seen.has(key), `duplicate term: ${entry.term}`);
    seen.add(key);
    for (const path of entry.where) assert.ok(existsSync(path), `${entry.term}: ${path} does not exist`);
  }
});
