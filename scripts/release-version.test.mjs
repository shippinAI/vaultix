import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { versionForRevision } from "./lib/release-version.mjs";

test("release identity derives from exact owned tags without inventing a release", () => {
  mkdirSync(".cache", { recursive: true });
  const fixture = mkdtempSync(resolve(".cache/release-version-"));
  const env = { ...process.env, GIT_AUTHOR_NAME: "Vaultix fixture", GIT_AUTHOR_EMAIL: "fixture@vaultix.invalid", GIT_COMMITTER_NAME: "Vaultix fixture", GIT_COMMITTER_EMAIL: "fixture@vaultix.invalid" };
  const git = (...args) => execFileSync("git", args, { cwd: fixture, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main");writeFileSync(resolve(fixture, "source.txt"), "fixture");git("add", "source.txt");git("commit", "-m", "fixture");
  const revision = git("rev-parse", "HEAD");
  assert.equal(versionForRevision(fixture, revision), `dev-${revision.slice(0, 12)}`);
  git("tag", "v1.2.3");assert.equal(versionForRevision(fixture, revision), "1.2.3");
  git("tag", "v2.0.0");assert.throws(() => versionForRevision(fixture, revision), /Multiple release/);
  git("tag", "-d", "v1.2.3", "v2.0.0");git("tag", "v2.0.0-rc.2+build.1");
  assert.equal(versionForRevision(fixture, revision), "2.0.0-rc.2+build.1");
  git("tag", "-d", "v2.0.0-rc.2+build.1");git("tag", "v2.0.0-01");
  assert.throws(() => versionForRevision(fixture, revision), /leading zeros/);
  assert.throws(() => versionForRevision(fixture, "not-a-revision"));
});
