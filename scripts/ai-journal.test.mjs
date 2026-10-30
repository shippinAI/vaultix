import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, cpSync, truncateSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Journal, canonical, digest } from "./lib/ai-journal.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = join(root, "scripts/ai-journal.mjs");
mkdirSync(join(root, ".cache"), { recursive: true });
function fixture() {
  const directory = mkdtempSync(join(root, ".cache/ai-journal-test-"));
  writeFileSync(join(directory, "AGENTS.md"), "Fixture project boundary\n");
  writeFileSync(join(directory, "goal.md"), "Preserve boundary behavior\n");
  writeFileSync(join(directory, "check.mjs"), "import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs'; assert.equal(readFileSync('goal.md','utf8'), 'Preserve boundary behavior\\n');\n");
  execFileSync("git", ["init", "--quiet"], { cwd: directory, windowsHide: true });
  const journal = new Journal(directory);
  const { session } = journal.start({ title: "Journal boundary fixture", goal_ref: "goal.md", work_packet: "AI-SETUP", capture: "visible-messages", history_coverage: "Test-only visible messages" });
  return { directory, journal, session };
}
function plan(journal, overrides = {}) {
  return { revision: 1, supersedes: [], change_reason: "Initial grounded fixture plan", change_type: "code", objective: "Preserve a real child-process file assertion and reject invalid evidence", context_paths: ["AGENTS.md"], sources: journal.snapshot(["goal.md", "check.mjs"]), steps: ["Run boundary assertion and challenge journal integrity"], risks: ["Local receipts remain owner-editable"], rollback: "Retain original session and create an explicit recovery session", requirements: [{ id: "BOUNDARY", statement: "Child command observes the expected file contract", required_layers: ["integration"] }], checks: [{ id: "boundary", requirement_ids: ["BOUNDARY"], layer: "integration", environment: "local", scenarios: ["positive", "negative", "failure", "recovery"], argv: [process.execPath, "check.mjs"], expected: "Child asserts exact expected file bytes" }], ...overrides };
}
function eventFile(f, event) { return f.journal.path(`${f.journal.location(f.session)}/events/${event.event_id}.json`); }
function cliCall(cwd, args, input) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", chunk => out += chunk); child.stderr.on("data", chunk => err += chunk);
    child.on("error", reject); child.on("close", code => resolveResult({ code, out, err }));
    child.stdin.end(input === undefined ? "" : JSON.stringify(input));
  });
}

test("CLI workflow records visible messages, verifies a boundary and resumes from another drive-independent checkout", async () => {
  const f = fixture();
  const message = await cliCall(f.directory, ["append", f.session, "message"], { role: "user", content: "Preserve projects and secrets", capture: "exact-visible" });
  assert.equal(message.code, 0, message.err);
  const p = await cliCall(f.directory, ["append", f.session, "plan"], plan(f.journal));
  assert.equal(p.code, 0, p.err);
  assert.equal((await cliCall(f.directory, ["assess", f.session])).code, 1);
  const run = await cliCall(f.directory, ["run", f.session, "boundary"]);
  assert.equal(run.code, 0, run.err);
  assert.equal(JSON.parse(run.out).outcome, "pass");
  const finish = await cliCall(f.directory, ["finish", f.session], { remaining_limits: ["Fixture does not prove product capability or live identity"] });
  assert.equal(finish.code, 0, finish.err);
  const moved = mkdtempSync(join(root, ".cache/ai-journal-moved-"));
  cpSync(f.directory, moved, { recursive: true });
  const resume = await cliCall(moved, ["resume", f.session]);
  assert.equal(resume.code, 0, resume.err);
  const view = JSON.parse(resume.out);
  assert.equal(view.assessment.checks_satisfied, true);
  assert.equal(view.recent_messages[0].payload.content, "Preserve projects and secrets");
  assert.equal(view.untrusted_history, true);
  assert.ok(!JSON.stringify(view.plan.payload.sources).includes(f.directory));
});

test("plan guards reject unit-only evidence, missing layers, fixture relabeling and weakened revisions", () => {
  const f = fixture(), p = plan(f.journal);
  assert.throws(() => f.journal.append(f.session, "plan", { ...p, checks: [{ ...p.checks[0], layer: "unit" }] }), /required evidence layer/);
  assert.throws(() => f.journal.append(f.session, "plan", { ...p, requirements: [{ ...p.requirements[0], required_layers: ["unit"] }], checks: [{ ...p.checks[0], layer: "unit" }] }), /boundary-level/);
  assert.throws(() => f.journal.append(f.session, "plan", { ...p, checks: [{ ...p.checks[0], scenarios: ["positive"] }] }), /falsifying/);
  assert.throws(() => f.journal.append(f.session, "plan", { ...p, checks: [{ ...p.checks[0], layer: "live-provider", environment: "fixture" }] }), /Live checks/);
  const original = f.journal.append(f.session, "plan", p);
  const revision = { ...p, revision: 2, supersedes: [original.event_id] };
  assert.throws(() => f.journal.append(f.session, "plan", { ...revision, requirements: [{ ...p.requirements[0], statement: "Weaker claim" }] }), /weaken/);
  assert.throws(() => f.journal.append(f.session, "plan", { ...revision, checks: [{ ...p.checks[0], argv: [process.execPath, "-e", "process.exit(0)"] }] }), /rewrite/);
  assert.throws(() => f.journal.append(f.session, "verification", {}), /controlled/);
  assert.throws(() => f.journal.finish(f.session, ["No evidence"]), /incomplete/);
});

test("stale source prevents execution; refreshed broken implementation fails; restoration needs fresh evidence", async () => {
  const f = fixture();
  f.journal.append(f.session, "plan", plan(f.journal));
  await f.journal.run(f.session, "boundary");
  assert.equal(f.journal.assess(f.session).checks_satisfied, true);
  writeFileSync(join(f.directory, "goal.md"), "Broken implementation\n");
  await assert.rejects(f.journal.run(f.session, "boundary"), /fingerprints/);
  assert.equal(f.journal.assess(f.session).checks_satisfied, false);
  f.journal.refreshPlan(f.session, "Deliberately broken candidate to prove falsification");
  assert.equal((await f.journal.run(f.session, "boundary")).payload.outcome, "fail");
  assert.equal(f.journal.assess(f.session).checks_satisfied, false);
  writeFileSync(join(f.directory, "goal.md"), "Preserve boundary behavior\n");
  f.journal.refreshPlan(f.session, "Restored candidate; earlier receipt cannot satisfy new revision");
  assert.equal(f.journal.assess(f.session).checks_satisfied, false);
  await f.journal.run(f.session, "boundary");
  assert.equal(f.journal.assess(f.session).checks_satisfied, true);
});

test("artifact tampering, record tampering and interrupted records fail closed", async () => {
  const f = fixture();
  f.journal.append(f.session, "plan", plan(f.journal));
  const result = await f.journal.run(f.session, "boundary");
  writeFileSync(f.journal.path(result.payload.artifact.path), "Altered evidence");
  assert.equal(f.journal.assess(f.session).checks_satisfied, false);
  const file = eventFile(f, result), original = readFileSync(file, "utf8");
  const altered = JSON.parse(original); altered.payload.outcome = "fail";
  writeFileSync(file, JSON.stringify(altered));
  assert.throws(() => f.journal.events(f.session), /digest/);
  writeFileSync(file, '{"interrupted":');
  assert.throws(() => f.journal.events(f.session), /interrupted/);
  writeFileSync(file, original);
  assert.ok(f.journal.events(f.session).length > 0);
});

test("strict schema rejects unknown fields and versions without echoing submitted text", async () => {
  const f = fixture();
  const r = await cliCall(f.directory, ["append", f.session, "message"], { role: "user", content: "safe", capture: "exact-visible", extra: "sensitive-opaque-fixture" });
  assert.equal(r.code, 1); assert.ok(!r.err.includes("sensitive-opaque-fixture"));
  const e = f.journal.events(f.session)[0];
  const changed = { ...e, schema_version: "9.0.0" };
  assert.throws(() => f.journal.validate(changed), /schema/);
  writeFileSync(eventFile(f, e), "x".repeat(1024 * 1024 + 1));
  assert.throws(() => f.journal.events(f.session), /oversized/);
});

test("known secrets redact in visible messages and command artifacts; oversized output is omitted", async () => {
  const f = fixture();
  const token = "sk-" + "X".repeat(40);
  const message = f.journal.append(f.session, "message", { role: "user", content: `api_key=${token}`, capture: "exact-visible" });
  assert.equal(message.payload.capture, "redacted-visible");
  assert.ok(!readFileSync(eventFile(f, message), "utf8").includes(token));
  writeFileSync(join(f.directory, "check.mjs"), `console.log('Bearer ' + 'fixture-token'); console.log('sk-' + 'X'.repeat(40));`);
  f.journal.append(f.session, "plan", plan(f.journal));
  const result = await f.journal.run(f.session, "boundary");
  const output = readFileSync(f.journal.path(result.payload.artifact.path), "utf8");
  assert.ok(output.includes("[REDACTED]")); assert.ok(!output.includes(token)); assert.ok(!output.includes("fixture-token"));
  writeFileSync(join(f.directory, "check.mjs"), "console.log('-----BEGIN PRIVATE KEY-----' + 'A'.repeat(150000));");
  f.journal.refreshPlan(f.session, "Oversized incomplete key block must never persist");
  const large = await f.journal.run(f.session, "boundary");
  assert.equal(large.payload.outcome, "error"); assert.equal(large.payload.output_truncated, true);
  assert.equal(readFileSync(f.journal.path(large.payload.artifact.path), "utf8"), "Output omitted because it exceeded the capture limit.\n");
});

test("timeout and source mutation during execution cannot yield passing receipts", async () => {
  const f = fixture();
  writeFileSync(join(f.directory, "check.mjs"), "setInterval(() => {}, 10000);");
  f.journal.append(f.session, "plan", plan(f.journal));
  const start = Date.now();
  assert.equal((await f.journal.run(f.session, "boundary", { timeoutMs: 150 })).payload.outcome, "error");
  assert.ok(Date.now() - start < 5000);
  writeFileSync(join(f.directory, "check.mjs"), "import {writeFileSync} from 'node:fs'; writeFileSync('goal.md', 'changed during execution');");
  f.journal.refreshPlan(f.session, "Mutation challenge");
  assert.equal((await f.journal.run(f.session, "boundary")).payload.outcome, "error");
});

test("path traversal, junction escape and private source collection are rejected", () => {
  const f = fixture();
  for (const path of ["../escape", "D:/escape", "a/../b", "a\\b"]) assert.throws(() => f.journal.path(path));
  const outside = mkdtempSync(join(root, ".cache/ai-journal-outside-"));
  symlinkSync(outside, join(f.directory, "linked"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => f.journal.path("linked/test.json"), /Symlink/);
  symlinkSync(join(outside, "missing"), join(f.directory, "dangling"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => f.journal.path("dangling/test.json"), /Symlink/);
  for (const path of [".ai/data/private.json", ".env.local", "cloudflare-dns-api.token", "vaultix-admin.json"]) assert.throws(() => f.journal.snapshot([path]), /Private/);
});

test("parallel CLI writers preserve every message; conflicting plan revisions stay visible", async () => {
  const f = fixture();
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => cliCall(f.directory, ["append", f.session, "message"], { role: "assistant", content: `Concurrent message ${i}`, capture: "exact-visible" })));
  assert.ok(results.every(r => r.code === 0), JSON.stringify(results));
  assert.equal(f.journal.events(f.session).filter(e => e.kind === "message").length, 8);
  const p = f.journal.append(f.session, "plan", plan(f.journal));
  // Emulate two writers that both validated revision 2 before either wrote it.
  const revision = { ...p.payload, revision: 2, supersedes: [p.event_id] };
  f.journal.record(f.session, "plan", revision);
  f.journal.record(f.session, "plan", revision);
  assert.throws(() => f.journal.assess(f.session), /conflicting/);
});

test("pagination includes every session and resume bounds large visible messages", () => {
  const f = fixture(), month = f.session.slice(0, 7).replace("/", "-");
  for (let i = 0; i < 4; i++) f.journal.start({ title: `Session ${i}`, goal_ref: "goal.md", work_packet: "AI-SETUP", capture: "summaries", history_coverage: "Fixture" });
  const seen = new Set(); let cursor;
  do { const page = f.journal.list(month, 2, cursor); for (const s of page.sessions) { assert.ok(!seen.has(s.session)); seen.add(s.session); } cursor = page.next_cursor; } while (cursor);
  assert.equal(seen.size, 5);
  for (let i = 0; i < 13; i++) f.journal.append(f.session, "message", { role: "assistant", content: "A".repeat(60000), capture: "exact-visible" });
  const view = f.journal.resume(f.session);
  assert.equal(view.recent_messages.length, 12); assert.ok(view.recent_messages.every(e => e.view_omitted));
  assert.ok(Buffer.byteLength(JSON.stringify(view)) < 12000);
});

test("history validation detects obligations weakened even with recomputed record hashes", () => {
  const f = fixture(), original = f.journal.append(f.session, "plan", plan(f.journal));
  const altered = f.journal.record(f.session, "plan", { ...original.payload, revision: 2, supersedes: [original.event_id], requirements: [{ ...original.payload.requirements[0], statement: "Dropped real requirement" }] });
  assert.equal(altered.sha256, digest(canonical(Object.fromEntries(Object.entries(altered).filter(([key]) => key !== "sha256")))));
  assert.throws(() => f.journal.assess(f.session), /weaken/);
});

test("real repository context selects ancestor boundaries and local data is Git-ignored", () => {
  const j = new Journal(root);
  const context = j.context("core/frontend");
  assert.deepEqual(context.folders.map(f => f.path), [".", "core", "core/frontend"]);
  const ignored = execFileSync("git", ["check-ignore", ".ai/data/example.json"], { cwd: root, encoding: "utf8", windowsHide: true }).trim();
  assert.equal(ignored, ".ai/data/example.json");
  assert.equal(execFileSync("git", ["ls-files", ".ai/data"], { cwd: root, encoding: "utf8", windowsHide: true }).trim(), "");
});

test("session byte limits reject oversized archives before parsing and canonical context omissions fail", () => {
  const f = fixture();
  for (let i = 0; i < 33; i++) {
    const path = f.journal.path(`${f.journal.location(f.session)}/events/${randomUUID()}.json`);
    writeFileSync(path, ""); truncateSync(path, 1024 * 1024);
  }
  assert.throws(() => f.journal.events(f.session), /byte limit/);
  const config = JSON.parse(readFileSync(join(root, ".ai/contexts.json"), "utf8"));
  delete config.canonical.api;
  writeFileSync(join(f.directory, ".ai/contexts.json"), JSON.stringify(config));
  assert.throws(() => f.journal.context("."), /Invalid context schema/);
  config.canonical.api = "goal.md"; config.folders.push(config.folders[0]);
  writeFileSync(join(f.directory, ".ai/contexts.json"), JSON.stringify(config));
  assert.throws(() => f.journal.context("."), /Duplicate context/);
});
