import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(packageRoot, ".ai/package.json"));
const Ajv = require("ajv/dist/2020").default;
const addFormats = require("ajv-formats");
const ajv = new Ajv({ strict: true, allErrors: true });
addFormats(ajv);
const schema = JSON.parse(readFileSync(join(packageRoot, ".ai/schemas/journal-event.schema.json")));
const validate = ajv.compile(schema);
const validateContexts = ajv.compile(JSON.parse(readFileSync(join(packageRoot, ".ai/schemas/contexts.schema.json"))));
const kinds = new Set(schema.properties.kind.enum);
const handlePattern = /^\d{4}\/(?:0[1-9]|1[0-2])\/[a-f0-9-]{36}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const maxRecord = 1024 * 1024;
const maxEvents = 10000;
const maxSessionBytes = 32 * 1024 * 1024;
const outputLimit = 128 * 1024;

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export const digest = value => createHash("sha256").update(value).digest("hex");
const check = (condition, message) => { if (!condition) throw new Error(message); };

// This is a conservative convenience filter, not a complete secret detector.
// Callers must submit already-safe material; arbitrary opaque secrets cannot be
// identified reliably by pattern matching. No raw environment is ever captured.
export function redact(value) {
  let count = 0;
  const replace = () => { count++; return "[REDACTED]"; };
  const walk = (item, key = "") => {
    if (/^(password|client_secret|access_token|refresh_token|api_key|authorization|secret_value)$/i.test(key)) return replace();
    if (typeof item === "string") return item
      .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, replace)
      .replace(/\bBearer\s+[^\s"'<>]+/gi, replace)
      .replace(/\b(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{20,}|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)\b/g, replace)
      .replace(/\b(?:password|client_secret|access_token|refresh_token|api_key|secret_value)\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi, replace)
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, (_, scheme) => `${scheme}${replace()}@`);
    if (Array.isArray(item)) return item.map(value => walk(value));
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, value]) => [key, walk(value, key)]));
    return item;
  };
  return { value: walk(value), count };
}

export class Journal {
  constructor(root) {
    this.root = realpathSync(root);
    check(existsSync(join(this.root, "AGENTS.md")), "Not a context-bound project root");
  }

  path(name) {
    check(typeof name === "string" && name && !isAbsolute(name) && !/[\\:\x00-\x1f]/.test(name), "Use a portable repository-relative path");
    const parts = name.split("/");
    check(parts.every(part => part && part !== ".." && (part !== "." || name === ".")), "Path traversal is not allowed");
    let current = this.root;
    for (const part of parts) {
      current = resolve(current, part);
      try { check(!lstatSync(current).isSymbolicLink(), "Symlink or junction paths are not accepted"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    const rel = relative(this.root, current);
    check(rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), "Path leaves project");
    return current;
  }

  dataDirectory(name) {
    const path = this.path(name);
    mkdirSync(path, { recursive: true, mode: 0o700 });
    for (const parent of [".ai/data", name]) {
      const info = lstatSync(this.path(parent));
      check(process.platform === "win32" || (info.mode & 0o077) === 0, "Journal directories must be private on POSIX");
    }
    return path;
  }

  writeNew(name, data) {
    this.dataDirectory(dirname(name).replaceAll("\\", "/"));
    const fd = openSync(this.path(name), "wx", 0o600);
    try { writeFileSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
  }

  location(handle) {
    check(handlePattern.test(handle) && uuidPattern.test(handle.split("/")[2]), "Invalid session handle");
    return `.ai/data/sessions/${handle}`;
  }

  events(handle) {
    const base = this.location(handle);
    const directory = this.path(`${base}/events`);
    check(existsSync(directory), "Session does not exist");
    const files = readdirSync(directory);
    check(files.length <= maxEvents, "Session exceeds resume limit; start a linked continuation");
    const sizes = files.map(name => {
      check(/^[a-f0-9-]{36}\.json$/.test(name), "Unexpected journal file; do not silently skip it");
      const info = lstatSync(this.path(`${base}/events/${name}`));
      check(info.isFile() && info.size <= maxRecord, "Invalid or oversized journal record");
      return info.size;
    });
    check(sizes.reduce((sum, size) => sum + size, 0) <= maxSessionBytes, "Session exceeds byte limit; preserve it and start a continuation");
    const events = files.map(name => {
      check(/^[a-f0-9-]{36}\.json$/.test(name), "Unexpected journal file; do not silently skip it");
      const path = this.path(`${base}/events/${name}`);
      check(lstatSync(path).isFile() && lstatSync(path).size <= maxRecord, "Invalid or oversized journal record");
      let event;
      try { event = JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error("Malformed or interrupted journal record; preserve it and recover explicitly"); }
      this.validate(event);
      check(event.session_id === handle.split("/")[2] && name === `${event.event_id}.json`, "Journal identity mismatch");
      const { sha256, ...body } = event;
      check(digest(canonical(body)) === sha256, "Journal record digest mismatch");
      return event;
    }).sort((a, b) => a.recorded_at.localeCompare(b.recorded_at) || a.event_id.localeCompare(b.event_id));
    check(events.filter(e => e.kind === "session").length === 1, "Session must have exactly one start record");
    return events;
  }

  validate(event) {
    check(validate(event), `Journal schema rejected record: ${validate.errors?.map(e => `${e.instancePath || "/"} ${e.keyword}`).join(", ")}`);
  }

  record(handle, kind, payload, { origin = "agent", actor = "project-agent", existing = null } = {}) {
    check(kinds.has(kind), "Unknown journal kind");
    const events = existing ?? this.events(handle);
    check(events.length < maxEvents, "Session full; start a linked continuation");
    const filtered = redact(payload);
    if (kind === "message" && filtered.count && filtered.value.capture === "exact-visible") filtered.value.capture = "redacted-visible";
    const latest = events.reduce((time, e) => Math.max(time, Date.parse(e.recorded_at)), 0);
    const body = { schema_version: "1.0.0", event_id: randomUUID(), session_id: handle.split("/")[2], recorded_at: new Date(Math.max(Date.now(), latest + 1)).toISOString(), project: "vaultix", kind, actor, origin, payload: filtered.value, redaction_count: filtered.count };
    const event = { ...body, sha256: digest(canonical(body)) };
    this.validate(event);
    const data = JSON.stringify(event, null, 2) + "\n";
    check(Buffer.byteLength(data) <= maxRecord, "Journal event too large");
    const existingBytes = events.reduce((sum, e) => sum + Buffer.byteLength(JSON.stringify(e, null, 2) + "\n"), 0);
    check(existingBytes + Buffer.byteLength(data) <= maxSessionBytes, "Session full; start a linked continuation");
    this.writeNew(`${this.location(handle)}/events/${event.event_id}.json`, data);
    return event;
  }

  start(payload) {
    check(existsSync(this.path(payload.goal_ref)), "Canonical goal reference does not exist");
    if (payload.parent_session) this.events(payload.parent_session);
    const date = new Date().toISOString();
    const handle = `${date.slice(0, 4)}/${date.slice(5, 7)}/${randomUUID()}`;
    const event = this.record(handle, "session", payload, { existing: [] });
    return { session: handle, event_id: event.event_id };
  }

  snapshot(paths) {
    check(Array.isArray(paths) && paths.length > 0 && new Set(paths).size === paths.length, "Source paths must be nonempty and unique");
    return paths.map(path => {
      check(!/^(?:\.git|\.cache|\.ai\/data)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:token|pem|key)$|(?:^|\/)(?:vaultix-admin|zitadel-vaultix-app)\.json$/i.test(path), "Private/local state cannot be a plan source");
      const file = this.path(path);
      check(lstatSync(file).isFile(), "Snapshot source must be a file");
      return { path, sha256: digest(readFileSync(file)) };
    });
  }

  currentPlan(events) {
    const plans = events.filter(e => e.kind === "plan").sort((a, b) => a.payload.revision - b.payload.revision);
    if (!plans.length) return null;
    check(new Set(plans.map(e => e.payload.revision)).size === plans.length, "Concurrent/conflicting plan revisions; preserve them and start a linked recovery session");
    for (let i = 0; i < plans.length; i++) {
      check(plans[i].payload.revision === i + 1, "Plan revision gap");
      check(canonical(plans[i].payload.supersedes) === canonical(i ? [plans[i - 1].event_id] : []), "Plan parent mismatch");
      this.validatePlan(plans[i].payload, i ? plans[i - 1] : null, { requireFresh: false });
    }
    return plans.at(-1);
  }

  validatePlan(payload, previous, { requireFresh = true } = {}) {
    const reqs = new Map(payload.requirements.map(r => [r.id, r]));
    const checks = new Map(payload.checks.map(c => [c.id, c]));
    check(reqs.size === payload.requirements.length && checks.size === payload.checks.length, "Duplicate requirement or check ID");
    for (const c of checks.values()) {
      check(c.requirement_ids.every(id => reqs.has(id)), "Check refers to unknown requirement");
      check(redact(c.argv).count === 0, "Credentials cannot be command arguments");
      check(c.layer !== "live-provider" || c.environment === "live-provider", "Live checks require live environments");
    }
    for (const r of reqs.values()) for (const layer of r.required_layers) check([...checks.values()].some(c => c.requirement_ids.includes(r.id) && c.layer === layer), "Requirement lacks a required evidence layer");
    if (payload.change_type === "code") {
      check([...checks.values()].some(c => ["integration", "system"].includes(c.layer)), "Code plans require a boundary-level check, not only unit tests");
      check([...checks.values()].some(c => c.scenarios.includes("negative") || c.scenarios.includes("failure")), "Code plans require a falsifying check");
    }
    if (previous) {
      check(payload.change_type === previous.payload.change_type, "Do not relabel scope to weaken evidence");
      for (const old of previous.payload.requirements) {
        const next = reqs.get(old.id);
        check(next && next.statement === old.statement && old.required_layers.every(l => next.required_layers.includes(l)), "Cannot remove or weaken an existing requirement in this session");
      }
      for (const old of previous.payload.checks) check(canonical(checks.get(old.id)) === canonical(old), "Cannot remove or rewrite declared checks in this session; use an explicit linked scope-change session");
    }
    if (requireFresh) check(canonical(this.snapshot(payload.sources.map(s => s.path))) === canonical(payload.sources), "Plan source fingerprints do not match current files");
    for (const path of payload.context_paths) check(existsSync(this.path(path)), "Context path does not exist");
  }

  append(handle, kind, payload) {
    check(!["session", "verification", "completion"].includes(kind), "Use start, run or finish for controlled events");
    const events = this.events(handle);
    const plan = this.currentPlan(events);
    if (kind === "plan") {
      // Validate the shape before inspecting nested fields; errors never echo data.
      const candidate = { schema_version: "1.0.0", event_id: randomUUID(), session_id: handle.split("/")[2], recorded_at: new Date().toISOString(), project: "vaultix", kind, actor: "project-agent", origin: "agent", payload, redaction_count: 0, sha256: "0".repeat(64) };
      this.validate(candidate);
      check(payload.revision === (plan?.payload.revision ?? 0) + 1 && canonical(payload.supersedes) === canonical(plan ? [plan.event_id] : []), "Wrong plan revision or parent");
      this.validatePlan(payload, plan);
    }
    return this.record(handle, kind, payload, { existing: events, origin: kind === "message" && payload.role === "user" ? "user-visible" : "agent" });
  }

  refreshPlan(handle, reason) {
    const plan = this.currentPlan(this.events(handle));
    check(plan, "No plan to refresh");
    return this.append(handle, "plan", { ...plan.payload, revision: plan.payload.revision + 1, supersedes: [plan.event_id], change_reason: reason, sources: this.snapshot(plan.payload.sources.map(s => s.path)) });
  }

  async run(handle, checkID, { timeoutMs = 300000 } = {}) {
    const events = this.events(handle);
    const plan = this.currentPlan(events);
    check(plan, "No current plan");
    this.validatePlan(plan.payload, null);
    const item = plan.payload.checks.find(c => c.id === checkID);
    check(item && item.layer !== "manual", "Unknown or manual-only check");
    const started = new Date().toISOString();
    const sourceBefore = this.snapshot(plan.payload.sources.map(s => s.path));
    const result = await new Promise(resolveResult => {
      let bytes = 0, output = "", truncated = false, timedOut = false, spawnFailed = false;
      const child = spawn(item.argv[0], item.argv.slice(1), { cwd: this.root, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const collect = chunk => { const remaining = outputLimit - bytes; if (remaining > 0) { const selected = chunk.subarray(0, remaining); output += selected.toString("utf8"); bytes += selected.length; } if (chunk.length > remaining) truncated = true; };
      child.stdout.on("data", collect); child.stderr.on("data", collect);
      child.on("error", () => { spawnFailed = true; });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
        // A descendant can keep inherited pipes open. Bound the runner itself;
        // checks must own and clean up any child services they start.
        child.stdout.destroy(); child.stderr.destroy(); child.unref();
        resolveResult({ code: null, output: "Output omitted after timeout.\n", truncated, error: true });
      }, timeoutMs);
      child.on("close", code => { clearTimeout(timer); resolveResult({ code, output, truncated, error: timedOut || spawnFailed }); });
    });
    // Never persist a partial token or private-key block cut by the output cap.
    const filtered = redact(result.truncated ? "Output omitted because it exceeded the capture limit.\n" : result.output);
    const artifact = `${this.location(handle)}/artifacts/${randomUUID()}.log`;
    this.writeNew(artifact, filtered.value);
    let fresh = false;
    try { fresh = canonical(this.snapshot(plan.payload.sources.map(s => s.path))) === canonical(sourceBefore); } catch { /* missing source is not success */ }
    const payload = { plan_event_id: plan.event_id, check_id: item.id, argv: item.argv, exit_code: result.code, outcome: !result.error && fresh && !result.truncated && result.code === 0 ? "pass" : result.error || !fresh || result.truncated ? "error" : "fail", environment: item.environment, started_at: started, ended_at: new Date().toISOString(), sources: sourceBefore, artifact: { path: artifact, sha256: digest(filtered.value) }, output_truncated: result.truncated };
    return this.record(handle, "verification", payload, { origin: "runner", actor: "vaultix-journal-runner" });
  }

  assess(handle) {
    const events = this.events(handle);
    const plan = this.currentPlan(events);
    const missing = [];
    const evidence = [];
    if (!plan) return { checks_satisfied: false, missing: ["No plan"], evidence, plan_event_id: null };
    try { this.validatePlan(plan.payload, null); } catch { missing.push("Plan sources or obligations are stale/invalid"); }
    for (const item of plan.payload.checks) {
      const record = events.filter(e => e.kind === "verification" && e.payload.plan_event_id === plan.event_id && e.payload.check_id === item.id).at(-1);
      let valid = record?.origin === "runner" && record.payload.outcome === "pass" && record.payload.exit_code === 0 && !record.payload.output_truncated && record.payload.environment === item.environment && canonical(record.payload.argv) === canonical(item.argv) && canonical(record.payload.sources) === canonical(plan.payload.sources);
      if (valid) {
        try {
          const path = record.payload.artifact.path;
          check(path.startsWith(`${this.location(handle)}/artifacts/`), "Wrong artifact scope");
          check(lstatSync(this.path(path)).size <= outputLimit, "Oversized evidence artifact");
          valid = digest(readFileSync(this.path(path))) === record.payload.artifact.sha256;
        } catch { valid = false; }
      }
      if (!valid) missing.push(`${item.id}: missing, failed, stale or mismatched evidence`);
      else evidence.push(record.event_id);
    }
    return { checks_satisfied: missing.length === 0, missing, evidence, plan_event_id: plan.event_id, meaning: "Consistency of declared checks only; review their adequacy independently" };
  }

  finish(handle, remainingLimits) {
    const result = this.assess(handle);
    check(result.checks_satisfied, "Cannot finish: declared evidence is incomplete or stale");
    return this.record(handle, "completion", { plan_event_id: result.plan_event_id, verification_events: result.evidence, meaning: "declared-checks-satisfied-not-independent-acceptance", remaining_limits: remainingLimits });
  }

  resume(handle) {
    const events = this.events(handle);
    const last = kind => events.filter(e => e.kind === kind).at(-1) ?? null;
    const view = { session: handle, untrusted_history: true, start: events.find(e => e.kind === "session"), alignment: last("alignment"), plan: this.currentPlan(events), handoff: last("handoff"), recent_messages: events.filter(e => e.kind === "message").slice(-12), recent_decisions: events.filter(e => e.kind === "decision").slice(-8), assessment: this.assess(handle), event_count: events.length };
    // Preserve full records on disk, returning explicit references when large.
    const compact = event => event && Buffer.byteLength(JSON.stringify(event)) > 4000
      ? { event_id: event.event_id, kind: event.kind, recorded_at: event.recorded_at, view_omitted: "Large record: read and validate the referenced event for details", path: `${this.location(handle)}/events/${event.event_id}.json` }
      : event;
    for (const key of ["start", "alignment", "plan", "handoff"]) view[key] = compact(view[key]);
    view.recent_messages = view.recent_messages.map(compact);
    view.recent_decisions = view.recent_decisions.map(compact);
    return view;
  }

  list(month = new Date().toISOString().slice(0, 7), limit = 20, after = "") {
    check(/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month) && Number.isInteger(limit) && limit > 0 && limit <= 100, "Use YYYY-MM and a limit from 1 to 100");
    const prefix = month.replace("-", "/");
    const directory = this.path(`.ai/data/sessions/${prefix}`);
    check(!after || uuidPattern.test(after), "Invalid session cursor");
    if (!existsSync(directory)) return { sessions: [], next_cursor: null };
    const names = readdirSync(directory).sort();
    check(names.every(id => uuidPattern.test(id)), "Unexpected session directory");
    const remaining = names.filter(id => id > after);
    const selected = remaining.slice(0, limit);
    const sessions = selected.map(id => {
      check(uuidPattern.test(id), "Unexpected session directory");
      const handle = `${prefix}/${id}`;
      const events = this.events(handle);
      return { session: handle, title: events.find(e => e.kind === "session").payload.title, last_recorded_at: events.at(-1).recorded_at, events: events.length };
    });
    return { sessions, next_cursor: remaining.length > limit ? selected.at(-1) : null, order: "session-id; restart pagination to include concurrent inserts" };
  }

  context(folder = ".") {
    this.path(folder);
    const config = JSON.parse(readFileSync(this.path(".ai/contexts.json"), "utf8"));
    check(validateContexts(config), "Invalid context schema");
    check(new Set(config.folders.map(entry => entry.path)).size === config.folders.length, "Duplicate context boundary");
    for (const path of Object.values(config.canonical)) check(existsSync(this.path(path)), "Missing canonical context file");
    for (const entry of config.folders) { check(existsSync(this.path(entry.path)), "Missing context folder"); for (const path of entry.read) check(existsSync(this.path(path)), "Missing routed context file"); }
    return { canonical: config.canonical, folders: config.folders.filter(e => e.path === "." || folder === e.path || folder.startsWith(e.path + "/")) };
  }
}

export function repositoryRoot() {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
