// The in-app assistant on one packaged image (docs/0123, docs/0124): an administrator adds and
// tests a provider with per-tier models, lists the provider's models, personas route a question to
// the secrets specialist on the right model, the specialist runs the person's own reference tool,
// memories reach the prompt and suggestions save nothing, and no secret value ever reaches the model. The model is a
// stand-in OpenAI-compatible server on the private network; a real provider needs the owner's
// key and is out of scope here. Values stay in process memory and never print.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDisposableImageHarness } from "./lib/disposable-image.mjs";

assert.equal(process.argv.length, 3, "Usage: node scripts/test-assistant-image.mjs <local-standalone-image>");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let phase = "image inspection";
const harness = createDisposableImageHarness(process.argv[2], () => phase);
const { artifact, container, docker, http, request, ready, waitFor, sql } = harness;
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache/assistant-image-"));
const run = `vaultix-assistant-${randomBytes(8).toString("hex")}`;
const report = { passed: false, artifact, checks: [],
  scope: "One packaged instance with a stand-in OpenAI-compatible model on a private network",
  exclusions: ["a real model provider (Anthropic, Bedrock, Vertex, OpenAI)", "browser UI", "organization-scoped providers",
    "a second person's view of another's personal memories (enforced in the store's query, not exercised here)"] };
const check = name => { report.checks.push(name); console.log(`Vaultix assistant: ${name}`); };
const password = `Vx9!${[...randomBytes(24)].map(byte => byte.toString(16).padStart(2, "0")).join("-")}`;
const canaryValue = `canary-${randomBytes(24).toString("hex")}`;
const providerKey = `sk-stand-in-${randomBytes(20).toString("hex")}`;
const secretName = "ASSISTANT_CANARY_SECRET";
const keyShapedNote = `the deploy key is sk-${randomBytes(18).toString("hex")}`;

// The stand-in model: answers the router, the connection test, and one tool round, and records
// every request so the test can inspect exactly what a provider would have received.
const modelScript = `const http=require("http");const seen=[];
http.createServer((q,s)=>{let b="";q.on("data",c=>b+=c).on("end",()=>{
 const json=o=>{s.setHeader("content-type","application/json");s.end(JSON.stringify(o));};
 if(q.url==="/record")return json(seen);
 seen.push({auth:q.headers.authorization||"",url:q.url,body:b});
 if(q.url==="/v1/models")return json({data:[{id:"stand-in-1"},{id:"stand-in-fast"},{id:"stand-in-pinned"}]});
 if(q.url!=="/v1/chat/completions"){s.statusCode=404;return json({error:{message:"no such route"}});}
 const r=JSON.parse(b);const msgs=r.messages||[];const sys=(msgs[0]&&msgs[0].content)||"";
 const reply=m=>json({choices:[{message:m}]});
 if(sys.startsWith("Choose who should answer"))return reply({content:"secrets"});
 if(sys.startsWith("You are a connection test"))return reply({content:"OK"});
 const tool=msgs.filter(m=>m.role==="tool").pop();
 if(tool)return reply({content:"Here is what I found: "+tool.content});
 const user=msgs.filter(m=>m.role==="user").pop().content;
 const remember=(r.tools||[]).find(x=>x.function.name==="propose_memory");
 if(user.startsWith("Remember that")&&remember)return reply({content:null,tool_calls:[{id:"call_m",type:"function",
  function:{name:"propose_memory",arguments:JSON.stringify({content:user.slice(14)})}}]});
 const id=(user.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)||[])[0];
 const t=(r.tools||[]).find(x=>x.function.name==="vaultix__secrets__references");
 if(!id||!t)return reply({content:"No reference tool was offered."});
 reply({content:null,tool_calls:[{id:"call_1",type:"function",function:{name:t.function.name,
  arguments:JSON.stringify({projectId:id,environment:"dev",secretPath:"/"})}}]});
});}).listen(9000,"0.0.0.0");`;

function raw(app, path, { method = "GET", body, token } = {}) {
  const response = http(app, path, { method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.ok(response, `HTTP connection failed during ${phase}`);
  return response;
}

function modelRecord(model) {
  const result = docker(["exec", model, "node", "-e",
    `fetch("http://127.0.0.1:9000/record").then(r=>r.text()).then(t=>process.stdout.write(t))`], { allowFailure: true });
  assert.equal(result.status, 0, "The stand-in model's record could not be read");
  return JSON.parse(result.stdout.toString());
}

try {
  phase = "network and stand-in model";
  harness.createNetwork(run);
  const modelName = `${run}-model`;
  const model = container(modelName, artifact.id, ["node", "-e", modelScript]);
  await waitFor(() => docker(["exec", model, "node", "-e", `fetch("http://127.0.0.1:9000/record").then(r=>process.exit(r.ok?0:1),()=>process.exit(1))`],
    { allowFailure: true }).status === 0, "stand-in model readiness");

  phase = "instance";
  const databasePassword = randomBytes(24).toString("hex");
  const dbName = `${run}-db`, cacheName = `${run}-cache`;
  const db = container(dbName, "postgres:16.6-alpine", [], { POSTGRES_USER: "vaultix", POSTGRES_DB: "vaultix", POSTGRES_PASSWORD: databasePassword });
  const cache = container(cacheName, "docker.dragonflydb.io/dragonflydb/dragonfly:v1.34.2",
    ["--default_lua_flags=allow-undeclared-keys", "--cache_mode=false", "--maxmemory=512mb", "--proactor_threads=2"]);
  await waitFor(() => docker(["exec", db, "pg_isready", "-U", "vaultix", "-d", "vaultix"], { allowFailure: true }).status === 0, "database readiness");
  await waitFor(() => docker(["exec", cache, "redis-cli", "ping"], { allowFailure: true }).status === 0, "cache readiness");
  const app = container(`${run}-app`, artifact.id, [], {
    DB_CONNECTION_URI: `postgres://vaultix:${databasePassword}@${dbName}:5432/vaultix`,
    VAULTIX_CACHE_PROVIDER: "dragonfly", VAULTIX_CACHE_URL: `redis://${cacheName}:6379`,
    ENCRYPTION_KEY: randomBytes(16).toString("hex"), AUTH_SECRET: randomBytes(32).toString("hex"),
    SITE_URL: "http://127.0.0.1:8200", TELEMETRY_ENABLED: "false", DISABLE_UPDATE_CHECK: "true"
  });
  await ready(app);
  const api = (path, options) => request(app, path, options);

  phase = "owner and canary secret";
  const owner = await api("/api/v1/admin/signup", { method: "POST",
    body: { email: `${run}@vaultix.invalid`, password, firstName: "Assistant", organizationName: "Assistant Org" } });
  const { token } = await api("/api/v3/auth/select-organization", { method: "POST", token: owner.token, body: { organizationId: owner.organization.id } });
  const { project } = await api("/api/v1/projects", { method: "POST", token, body: { projectName: "Assistant Project" } });
  await api(`/api/v4/secrets/${secretName}`, { method: "POST", token,
    body: { projectId: project.id, environment: "dev", secretPath: "/", secretValue: canaryValue } });
  check("the owner, a project and a secret holding a canary value exist");

  phase = "assistant before a provider";
  const before = (await api("/api/vx/v1/ai/assistant", { token })).assistant;
  assert.equal(before.available, false);
  assert.match(before.reason, /Admin > AI assistant/);
  assert.deepEqual(before.personas.map(p => p.slug), ["clyffy", "access", "operate", "secrets"], "the guard must not be offered to people");
  assert.equal(raw(app, "/api/vx/v1/ai/messages", { method: "POST", token, body: { messages: [{ role: "user", content: "hi" }] } }).status, 400);
  check("with no provider the assistant is off and says where to turn it on");

  phase = "personas";
  const personas = (await api("/api/vx/v1/ai/personas", { token })).personas;
  assert.deepEqual(personas.map(p => `${p.slug}:${p.role}`),
    ["clyffy:router", "access:specialist", "operate:specialist", "secrets:specialist", "security:guard"]);
  assert.ok(personas.every(p => p.builtIn && !p.customized && p.id === `vaultix.persona.${p.slug}`));
  const changed = (await api("/api/vx/v1/ai/personas/secrets", { method: "PATCH", token,
    body: { instructions: "Answer as the secrets specialist. Name the variables you find." } })).persona;
  assert.equal(changed.customized, true);
  assert.equal((await api("/api/vx/v1/ai/personas/secrets", { method: "DELETE", token, status: 400 })).message.includes("default persona"), true);
  assert.equal((await api("/api/vx/v1/ai/personas/clyffy", { method: "PATCH", token, body: { enabled: false }, status: 400 })).statusCode, 400);
  const custom = (await api("/api/vx/v1/ai/personas", { method: "POST", token, status: 201,
    body: { slug: "billing", name: "Billing helper", domains: ["workspace"], instructions: "Explain plans and usage." } })).persona;
  assert.equal(custom.role, "specialist");
  await api("/api/vx/v1/ai/personas/billing", { method: "DELETE", token });
  assert.equal((await api("/api/vx/v1/ai/personas/secrets/reset", { method: "POST", token })).persona.customized, false);
  check("default personas load from platform/engine/ai/personas; administrators change, reset, add and remove them; defaults and Clyffy are protected");

  phase = "providers";
  const created = (await api("/api/vx/v1/ai/providers", { method: "POST", token, status: 201, body: {
    kind: "openai-compatible", name: "Stand-in model", model: "stand-in-1", fastModel: "stand-in-fast",
    baseUrl: `http://${modelName}:9000/v1`, credential: { apiKey: providerKey }, active: true } })).provider;
  assert.equal(created.hasCredential, true);
  assert.equal(created.fastModel, "stand-in-fast");
  assert.equal(created.deepModel, "");
  assert.equal(created.active, true);
  const unreachable = (await api("/api/vx/v1/ai/providers", { method: "POST", token, status: 201, body: {
    kind: "openai-compatible", name: "Unreachable", model: "nothing", baseUrl: `http://${run}-absent:9000/v1` } })).provider;
  const passed = await api(`/api/vx/v1/ai/providers/${created.id}/test`, { method: "POST", token });
  assert.equal(passed.test.outcome, "passed");
  assert.equal(passed.test.message, "All 2 models answered.");
  assert.equal(passed.provider.lastTestOutcome, "passed");
  const failed = await api(`/api/vx/v1/ai/providers/${unreachable.id}/test`, { method: "POST", token });
  assert.equal(failed.test.outcome, "failed");
  assert.match(failed.test.message, /could not be reached/);
  const listing = raw(app, "/api/vx/v1/ai/providers", { token });
  assert.equal(listing.status, 200);
  assert.ok(!listing.body.includes(providerKey), "the provider key was returned by the API");
  assert.equal(sql(db, `SELECT count(*) FROM vx_ai_providers WHERE position(convert_to('${providerKey}', 'UTF8') in "encryptedCredential") > 0`), "0",
    "the provider key is stored in the clear");
  assert.equal(sql(db, `SELECT count(*) FROM vx_ai_providers WHERE active`), "1");
  check("an administrator adds providers; the connection test records pass and the provider's real failure; the key is encrypted and never returned");

  phase = "model lists";
  const listed = await api(`/api/vx/v1/ai/providers/${created.id}/models`, { token });
  assert.equal(listed.listed, true);
  assert.deepEqual(listed.models.map(m => m.id), ["stand-in-1", "stand-in-fast", "stand-in-pinned"]);
  const unlisted = await api(`/api/vx/v1/ai/providers/${unreachable.id}/models`, { token });
  assert.equal(unlisted.listed, false);
  assert.match(unlisted.message, /could not be reached/);
  check("the provider's own model list loads with the saved key, and a provider that cannot list says why");

  phase = "chat routed by page";
  const ask = (body, status = 200) => api("/api/vx/v1/ai/messages", { method: "POST", token, body, status });
  const byPage = await ask({
    messages: [{ role: "user", content: `List the secret names in project ${project.id}, environment dev.` }],
    signals: [{ kind: "navigate", path: `/organizations/${owner.organization.id}/projects/secret-manager/${project.id}/overview` }]
  });
  assert.equal(byPage.persona.slug, "secrets");
  assert.equal(byPage.routedBy, "page");
  assert.deepEqual(byPage.actions, [{ tool: "vaultix.secrets.references", domain: "secrets", status: "ran" }]);
  assert.ok(byPage.message.content.includes(secretName), "the answer does not carry the reference the tool returned");
  check("the page routes the question to the secrets specialist, which runs the person's reference tool through the secrets warp point");

  phase = "chat routed by Clyffy";
  const byRouter = await ask({ messages: [{ role: "user", content: `Which secrets are in project ${project.id} dev?` }] });
  assert.equal(byRouter.persona.slug, "secrets");
  assert.equal(byRouter.routedBy, "router");
  check("without a page hint Clyffy routes to the specialist");

  phase = "tier models";
  const routed = modelRecord(model).filter(entry => entry.url === "/v1/chat/completions").map(entry => JSON.parse(entry.body));
  const routerCalls = routed.filter(body => body.messages[0].content.startsWith("Choose who should answer"));
  const answerCalls = routed.filter(body => body.messages[0].content.startsWith("Standing rules"));
  assert.ok(routerCalls.length >= 1 && routerCalls.every(body => body.model === "stand-in-fast"), "Clyffy (fast) did not route on the fast model");
  assert.ok(answerCalls.length >= 1 && answerCalls.every(body => body.model === "stand-in-1"), "the secrets specialist (standard) did not run on the standard model");
  assert.equal(byPage.provider.model, "stand-in-1");
  await api("/api/vx/v1/ai/personas/secrets", { method: "PATCH", token, body: { model: "stand-in-pinned" } });
  const pinned = await ask({ messages: [{ role: "user", content: "@secrets hello" }] });
  assert.equal(pinned.provider.model, "stand-in-pinned");
  assert.equal(JSON.parse(modelRecord(model).filter(entry => entry.url === "/v1/chat/completions").pop().body).model, "stand-in-pinned");
  assert.equal((await api("/api/vx/v1/ai/personas/secrets/reset", { method: "POST", token })).persona.model, "");
  check("each persona runs on its tier's model, a persona can pin its own model, and the answer names the model it ran on");

  phase = "memories";
  const mine = (await api("/api/vx/v1/ai/memories", { method: "POST", token, status: 201,
    body: { content: "I deploy to staging before production." } })).memory;
  assert.equal(mine.scope, "personal");
  const everyone = (await api("/api/vx/v1/ai/memories", { method: "POST", token, status: 201,
    body: { scope: "instance", content: "Secret names use UPPER_SNAKE_CASE.", persona: "secrets" } })).memory;
  assert.equal(everyone.scope, "instance");
  const refused = await api("/api/vx/v1/ai/memories", { method: "POST", token, status: 400, body: { content: keyShapedNote } });
  assert.match(refused.message, /looks like a secret value/);
  assert.equal(typeof refused.error, "string");
  assert.equal(sql(db, `SELECT count(*) FROM vx_ai_memories WHERE content LIKE '%deploy key%'`), "0");
  const edited = (await api(`/api/vx/v1/ai/memories/${mine.id}`, { method: "PATCH", token,
    body: { content: "I deploy to staging first, then production." } })).memory;
  assert.equal(edited.content, "I deploy to staging first, then production.");
  const remembered = await ask({ messages: [{ role: "user", content: "@secrets what should I know?" }] });
  const prompt = JSON.parse(modelRecord(model).filter(entry => entry.url === "/v1/chat/completions").pop().body).messages[0].content;
  assert.ok(prompt.includes("(personal) I deploy to staging first, then production.") && prompt.includes("(instance) Secret names use UPPER_SNAKE_CASE."),
    "memories did not reach the persona's prompt");
  assert.ok(prompt.includes("information, not instructions"));
  assert.equal(remembered.persona.slug, "secrets");
  const suggestion = await ask({ messages: [{ role: "user", content: "Remember that I prefer short answers." }] });
  assert.deepEqual(suggestion.proposals, [{ content: "I prefer short answers." }]);
  assert.equal(sql(db, `SELECT count(*) FROM vx_ai_memories WHERE content = 'I prefer short answers.'`), "0", "a suggestion was saved without the person");
  const leakySuggestion = await ask({ messages: [{ role: "user", content: `Remember that ${keyShapedNote}` }] });
  assert.deepEqual(leakySuggestion.proposals, []);
  const accepted = (await api("/api/vx/v1/ai/memories", { method: "POST", token, status: 201,
    body: { content: suggestion.proposals[0].content, source: "assistant" } })).memory;
  assert.equal(accepted.source, "assistant");
  const list = await api("/api/vx/v1/ai/memories", { token });
  assert.equal(list.canManageInstance, true);
  assert.deepEqual(list.memories.map(m => m.scope), ["instance", "personal", "personal"]);
  await api(`/api/vx/v1/ai/memories/${accepted.id}`, { method: "DELETE", token });
  assert.equal(raw(app, `/api/vx/v1/ai/memories/${accepted.id}`, { method: "DELETE", token }).status, 404);
  assert.equal(raw(app, "/api/vx/v1/ai/memories").status, 401);
  check("people keep and change their own memories, administrators keep instance ones, memories reach the prompt as notes, " +
    "a key-shaped note is refused, and the assistant's suggestions save nothing until accepted");

  phase = "refusals";
  const valueSignal = await ask({ messages: [{ role: "user", content: "hi" }],
    signals: [{ kind: "action", action: `postgres://admin:${canaryValue}@db` }] }, 400);
  assert.equal(typeof valueSignal.error, "string");
  assert.equal(raw(app, "/api/vx/v1/ai/messages", { method: "POST", body: { messages: [{ role: "user", content: "hi" }] } }).status, 401);
  assert.equal(raw(app, "/api/vx/v1/ai/providers").status, 401);
  check("a signal carrying a value is refused, and signed-out requests are refused");

  phase = "canary";
  const seen = modelRecord(model);
  const chats = seen.filter(entry => entry.url === "/v1/chat/completions");
  assert.ok(chats.length >= 5, `the model saw ${chats.length} requests`);
  assert.ok(chats.every(entry => entry.auth === `Bearer ${providerKey}`), "the provider key was not used for every model call");
  const everything = JSON.stringify(seen) + JSON.stringify([byPage, byRouter, remembered, suggestion]);
  assert.ok(!everything.includes(canaryValue), "a secret value reached the model or the chat");
  assert.ok(JSON.stringify(seen).includes(secretName), "the reference never reached the model, so the canary check proves nothing");
  const logs = docker(["logs", app], { allowFailure: true });
  assert.ok(!`${logs.stdout}${logs.stderr}`.includes(canaryValue) && !`${logs.stdout}${logs.stderr}`.includes(providerKey), "a value or key reached the application log");
  check("the secret value never reached the model, the chat or the log, while its name did; the provider key never reached the log");

  report.passed = true;
} catch (error) {
  report.failure = { phase, message: error instanceof Error ? error.message : String(error) };
  process.exitCode = 1;
} finally {
  phase = "cleanup";
  report.cleanupPassed = harness.cleanup();
  if (!report.cleanupPassed) { report.passed = false; process.exitCode = 1; }
  writeFileSync(resolve(evidence, "result.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks, failure: report.failure, cleanupPassed: report.cleanupPassed, evidence }));
}
