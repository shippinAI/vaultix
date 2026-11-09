import assert from "node:assert/strict";
import test from "node:test";

import { assertDisposableDatabase, assertReplaceableEnv } from "./prepare-local-integration.mjs";

test("replaces only an absent or disposable-owned vaultix_itest database", () => {
  assert.doesNotThrow(() => assertDisposableDatabase({ name: "vaultix_itest", owner: "" }));
  assert.doesNotThrow(() => assertDisposableDatabase({ name: "vaultix_itest", owner: "vaultix_itest" }));
  assert.throws(() => assertDisposableDatabase({ name: "postgres", owner: "postgres" }), /unexpected database/);
  assert.throws(() => assertDisposableDatabase({ name: "vaultix_itest", owner: "postgres" }), /another role/);
});

test("replaces an env file only when it already targets the loopback disposable database", () => {
  assert.doesNotThrow(() => assertReplaceableEnv(undefined));
  assert.doesNotThrow(() => assertReplaceableEnv("postgres://vaultix_itest:secret@127.0.0.1:5432/vaultix_itest"));
  assert.throws(() => assertReplaceableEnv("postgres://vaultix:secret@127.0.0.1:5432/vaultix"), /disposable loopback/);
  assert.throws(() => assertReplaceableEnv("postgres://vaultix_itest:secret@db.example:5432/vaultix_itest"), /disposable loopback/);
});
