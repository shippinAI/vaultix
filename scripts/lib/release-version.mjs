import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

export const versionForRevision = (root, revision) => {
  assert.match(revision, /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/);
  const tags = execFileSync("git", ["tag", "--points-at", revision], { cwd: root, encoding: "utf8", windowsHide: true }).trim().split(/\r?\n/).filter(Boolean);
  const versions = tags.filter((tag) => /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(tag));
  assert.ok(versions.length <= 1, "Multiple release version tags point to this commit; choose one canonical version before building");
  if (!versions.length) return `dev-${revision.slice(0, 12)}`;
  const version = versions[0].slice(1);
  assert.ok(version.length <= 128, "Release version is too long");
  const [core, pre] = version.split("+")[0].split(/-(.*)/s);
  assert.ok(core.split(".").every((part) => Number.isSafeInteger(Number(part))), "Release version exceeds the supported numeric range");
  assert.ok(!pre?.split(".").some((part) => /^0\d+$/.test(part)), "Numeric prerelease identifiers cannot have leading zeros");
  return version;
};
