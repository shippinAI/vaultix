import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const scan = cwd => {
  const result = spawnSync(bash, ["scripts/check-owned.sh"], {
    cwd, encoding: "utf8", windowsHide: true, timeout: 30000
  });
  assert.ifError(result.error);
  return { status: result.status, output: result.stdout + result.stderr };
};
assert.equal(scan(root).status, 0, "The actual Vaultix checkout must pass before testing rejection");
mkdirSync(resolve(root, ".cache"), { recursive: true });
const fixture = mkdtempSync(resolve(root, ".cache/owned-branding-"));
for (const path of [
  "scripts/check-owned.sh", "platform/engine/PIN", "core/SHIPPIN.md", "platform/engine/frontend/index.html",
  "compose/vaultix.yml", "platform/engine/Dockerfile.standalone-vaultix", "platform/engine/Dockerfile.ghcr",
  ".github/workflows/ghcr.yml", "platform/engine/backend/src/lib/config/env.ts",
  "docs/0015-frozen-no-connection.md", "panel/internal/vault/engine.go",
  ...["vaultix-mark.svg", "vaultix-wordmark.svg", "vaultix-loading.svg", "vaultix-social.png"]
    .map(name => `platform/engine/frontend/public/images/${name}`)
]) {
  mkdirSync(dirname(resolve(fixture, path)), { recursive: true });
  copyFileSync(resolve(root, path), resolve(fixture, path));
}
mkdirSync(resolve(fixture, "platform/engine/frontend/src"), { recursive: true });
const probe = resolve(fixture, "platform/engine/frontend/src/brand-proof.tsx");
writeFileSync(probe, 'export const label = "Vaultix — vaultix.cloud — DevSCIF.com";\n');
assert.equal(scan(fixture).status, 0, "Owned product names must remain accepted");
for (const label of ["Infisical", "INFISICAL", "infisical.com", "support@infisical.com"]) {
  writeFileSync(probe, `export const label = ${JSON.stringify(label)};\n`);
  const denied = scan(fixture);
  assert.notEqual(denied.status, 0, "Retired customer branding must fail the scanner");
  assert.ok(denied.output.includes("customer chrome still carries the snapshot brand"));
}
writeFileSync(probe, 'export const label = "Vaultix";\n');
assert.equal(scan(fixture).status, 0, "Removing the retired label must restore acceptance");
console.log("Vaultix branding: real checkout and owned names accepted; four retired-brand cases rejected; recovery passed.");
