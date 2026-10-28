// Orchestration fixtures use real local Git archives; Docker/gates are simulated.
// Real-image acceptance is a separate run of build-self-hosted.mjs.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache/self-hosted-fixtures-"));
const config = resolve(evidence, "empty-git-config");
writeFileSync(config, "");
const env = { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Vaultix fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Vaultix fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const imageId = `sha256:${"a".repeat(64)}`;
const loader = resolve(evidence, "fixture-loader.mjs");
writeFileSync(loader, `
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {appendFileSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const originalExec=cp.execFileSync, originalSpawn=cp.spawnSync;
const trace=(name,args)=>appendFileSync(process.env.FIXTURE_TRACE,JSON.stringify({name,args})+'\\n');
let inspections=0;
cp.execFileSync=(name,args,options)=>{
  if(name!=='docker') return originalExec(name,args,options);
  trace(name,args);
  if(args[0]==='info') return JSON.stringify({os:'linux',architecture:'amd64'});
  if(args[0]==='compose') return '2.0-fixture';
  assert.deepEqual(args.slice(0,4),['image','inspect','--format','{{.Id}}']);
  inspections++;
  return process.env.FIXTURE_CASE==='tag-change' && inspections>1 ? 'sha256:'+'b'.repeat(64) : '${imageId}';
};
cp.spawnSync=(name,args,options)=>{
  trace(name,args);
  if(name==='git'||name==='tar') return originalSpawn(name,args,options);
  if(args[0]==='scripts/check-image-identity.mjs') {
    assert.equal(args[1],'${imageId}','Identity and runtime checks must use the same immutable image');
    assert.equal(args[3],process.env.FIXTURE_REVISION);
  }
  if(name==='docker') {
    assert.equal(args[0],'build','No push, deploy, pruning or container mutations');
    const context=args.at(-1);
    assert.equal(readFileSync(resolve(context,'committed.txt'),'utf8'),'committed source');
    assert.equal(existsSync(resolve(context,'.env')),false,'Ignored operator file must not enter build context');
    assert.equal(existsSync(resolve(context,'node_modules')),false,'Local dependencies must not enter build context');
    assert.ok(args.includes(resolve(context,'Dockerfile.standalone-vaultix')));
    assert.ok(args.includes('VAULTIX_SOURCE_REVISION='+process.env.FIXTURE_REVISION) || args.includes('--target'));
  }
  if(args[0]==='scripts/smoke-image.sh') {
    assert.equal(args[1],'${imageId}','Verify the immutable image');
    if(process.env.FIXTURE_CASE==='source-change') writeFileSync('core/committed.txt','changed during verification');
    if(process.env.FIXTURE_CASE==='application-failure' && args[2]==='dragonfly') return {status:19};
  }
  if(process.env.FIXTURE_CASE==='build-failure' && name==='docker') return {status:23};
  if(args[0]==='scripts/test-encrypted-recovery.mjs') {
    assert.equal(args[1],'${imageId}','Recovery must use the verified immutable image');
    if(process.env.FIXTURE_CASE==='recovery-failure') return {status:24};
  }
  return {status:0};
};
syncBuiltinESMExports();
`);
const cases = [];
for (const name of ["preflight", "application", "capabilities", "dirty", "locked", "build-failure", "application-failure", "recovery-failure", "source-change", "tag-change"]) {
  const cwd = resolve(evidence, name);
  for (const dir of ["scripts", "core/e2e/node_modules/@playwright/test", "core/e2e/node_modules/@axe-core/playwright", ".cache"])
    mkdirSync(resolve(cwd, dir), { recursive: true });
  copyFileSync(resolve(root, "scripts/build-self-hosted.mjs"), resolve(cwd, "scripts/build-self-hosted.mjs"));
  writeFileSync(resolve(cwd, ".gitignore"), ".cache/\n**/node_modules/\n**/.env\n");
  writeFileSync(resolve(cwd, "core/e2e/package.json"), "{}");
  writeFileSync(resolve(cwd, "core/e2e/node_modules/@playwright/test/index.js"), "exports.chromium={executablePath:()=>__filename};");
  writeFileSync(resolve(cwd, "core/e2e/node_modules/@axe-core/playwright/index.js"), "module.exports={};");
  writeFileSync(resolve(cwd, "core/Dockerfile.standalone-vaultix"), "FROM scratch\n");
  writeFileSync(resolve(cwd, "core/committed.txt"), "committed source");
  writeFileSync(resolve(cwd, "core/.env"), "FIXTURE_ONLY=never-archive-operator-values");
  git(cwd, "init", "-b", "main"); git(cwd, "add", "."); git(cwd, "commit", "-m", "Build fixture");
  const revision = git(cwd, "rev-parse", "HEAD");
  if (name === "dirty") writeFileSync(resolve(cwd, "pending.txt"), "preserve this");
  const lock = resolve(cwd, ".cache/self-hosted-build.lock");
  if (name === "locked") writeFileSync(lock, "another build owns this");
  const trace = resolve(evidence, `${name}-trace.jsonl`);
  const result = spawnSync(process.execPath, ["--import", pathToFileURL(loader).href, "scripts/build-self-hosted.mjs",
    name === "preflight" ? "--check" : name === "capabilities" ? "--capabilities" : "--application"], {
    cwd, encoding: "utf8", timeout: 60_000, env: { ...env, FIXTURE_TRACE: trace, FIXTURE_CASE: name, FIXTURE_REVISION: revision }
  });
  const accepted = ["preflight", "application", "capabilities"].includes(name);
  assert.equal(result.status, accepted ? 0 : 1, `${name}: ${result.stdout}${result.stderr}`);
  const records = readdirSync(resolve(cwd, ".cache")).filter(path => path.startsWith("self-hosted-build-") && path !== "self-hosted-build.lock");
  const commands = existsSync(trace) ? readFileSync(trace, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];
  if (["preflight", "dirty", "locked"].includes(name)) {
    assert.equal(records.length, 0);
    assert.ok(commands.every(item => item.name === "docker" && ["info", "compose"].includes(item.args[0])));
  } else {
    assert.equal(records.length, 1);
    const report = JSON.parse(readFileSync(resolve(cwd, ".cache", records[0], "result.json"), "utf8"));
    assert.equal(report.passed, accepted);
    assert.equal(report.revision, revision);
    if (accepted) assert.equal(report.imageId, imageId);
    if (name === "build-failure") assert.equal(report.steps.at(-1).name, "canonical-image");
    if (name === "application-failure") assert.equal(report.steps.at(-1).name, "dragonfly-application");
    if (name === "recovery-failure") assert.equal(report.steps.at(-1).name, "encrypted-recovery");
    if (accepted) assert.ok(report.steps.some(step => step.name === "encrypted-recovery" && step.passed));
    if (name === "capabilities") assert.equal(report.steps.at(-1).name, "backend-redis");
  }
  assert.equal(existsSync(lock), name === "locked", "Release only the lock owned by this invocation");
  if (name === "locked") assert.equal(readFileSync(lock, "utf8"), "another build owns this");
  if (name === "dirty") assert.equal(readFileSync(resolve(cwd, "pending.txt"), "utf8"), "preserve this");
  assert.equal(git(cwd, "rev-parse", "HEAD"), revision);
  assert.equal(readFileSync(resolve(cwd, "core/.env"), "utf8"), "FIXTURE_ONLY=never-archive-operator-values");
  assert.ok(!(result.stdout + result.stderr).includes("never-archive-operator-values"));
  cases.push({ name, fixtures: true, passed: true });
}
writeFileSync(resolve(evidence, "result.json"), JSON.stringify({ fixtures: true, passed: true, cases }, null, 2) + "\n");
console.log(`Self-hosted build orchestration fixtures passed: ${cases.length}. Evidence: ${evidence}`);
