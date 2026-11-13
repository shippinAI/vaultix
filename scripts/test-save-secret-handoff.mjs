// Save to Vaultix v1 (docs/0125): request validation, message filtering, the save call, result
// messages, value hygiene and the sign-in return path. Run with --experimental-strip-types.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Ajv2020 from "../.ai/node_modules/ajv/dist/2020.js";
import {
  HANDOFF_KINDS,
  MAX_VALUE_BYTES,
  createHandoffSession,
  createSecretRequest,
  parseHandoffRequest,
  readRememberedChoice,
  readValueMessage,
  readyMessage,
  resultMessage,
  serializeRememberedChoice,
  suggestSecretName
} from "../platform/engine/frontend/src/pages/integrations/SaveSecretPage/save-secret-handoff.ts";
import { toSafeReturnPath } from "../platform/engine/frontend/src/helpers/return-path.ts";

let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const same = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };

const partner = "https://nomen.example.com";
const allowed = [partner, "http://127.0.0.1:18080"];
const nonce = "AbCdEfGhIjKlMnOpQrStUv"; // 22 chars, 132 bits
const query = (overrides = {}, drop = []) => {
  const params = { v: "1", source: "nomen", origin: partner, name: "GITHUB_PAT", kind: "pat", nonce, ...overrides };
  for (const key of drop) delete params[key];
  return `?${new URLSearchParams(params).toString()}`;
};

// Request validation.
const accepted = parseHandoffRequest(query(), allowed);
same(accepted, { ok: true, request: { source: "nomen", origin: partner, name: "GITHUB_PAT", kind: "pat", nonce } }, "valid request");
for (const kind of HANDOFF_KINDS) check(parseHandoffRequest(query({ kind }), allowed).ok, `kind ${kind} accepted`);
check(parseHandoffRequest(query({ nonce: "A".repeat(43) }), allowed).ok, "43-char nonce accepted");
check(parseHandoffRequest(query({ nonce: "a-b_".repeat(6) }), allowed).ok, "base64url alphabet accepted");
check(parseHandoffRequest(query({}, ["name"]), allowed).ok, "name is only a suggestion and may be absent");
const refused = [
  ["feature-off", query(), []],
  ["version", query({ v: "2" }), allowed],
  ["version", query({ v: "01" }), allowed],
  ["version", query({}, ["v"]), allowed],
  ["origin", query({ origin: "https://evil.example.com" }), allowed],
  ["origin", query({ origin: `${partner}/` }), allowed],
  ["origin", query({ origin: "https://NOMEN.example.com" }), allowed],
  ["origin", query({ origin: "https://nomen.example.com:443" }), allowed],
  ["origin", query({ origin: "null" }), allowed],
  ["origin", query({}, ["origin"]), allowed],
  ["nonce", query({ nonce: "short" }), allowed],
  ["nonce", query({ nonce: "A".repeat(21) }), allowed],
  ["nonce", query({ nonce: "A".repeat(44) }), allowed],
  ["nonce", query({ nonce: "AbCdEfGhIjKlMnOpQrStU+" }), allowed],
  ["nonce", query({ nonce: "AbCdEfGhIjKlMnOpQrStU=" }), allowed],
  ["nonce", query({}, ["nonce"]), allowed],
  ["kind", query({ kind: "api_key" }), allowed],
  ["kind", query({ kind: "PAT" }), allowed],
  ["kind", query({}, ["kind"]), allowed],
  ["source", query({ source: "" }), allowed],
  ["source", query({ source: "Nomen<script>" }), allowed],
  ["parameters", `${query()}&value=leaked`, allowed],
  ["parameters", `${query()}&secret=leaked`, allowed],
  ["parameters", `${query()}&nonce=${nonce}`, allowed],
  ["parameters", `${query()}&origin=${encodeURIComponent(partner)}`, allowed]
];
for (const [problem, search, origins] of refused) {
  same(parseHandoffRequest(search, origins), { ok: false, problem }, `refuses ${problem}: ${search.slice(0, 80)}`);
}
check(!JSON.stringify(parseHandoffRequest(`${query()}&value=leaked-canary`, allowed)).includes("leaked-canary"), "a refused request never echoes parameters");

// Name suggestion follows SecretNameSchema: trimmed, non-empty, no colon or slash.
same(suggestSecretName("  GITHUB_PAT  "), "GITHUB_PAT", "trimmed");
same(suggestSecretName("nomen:client/secret"), "nomen_client_secret", "colon and slash replaced");
same(suggestSecretName("my client secret"), "my_client_secret", "whitespace replaced");
same(suggestSecretName("   "), "", "blank stays blank");
same(suggestSecretName(undefined), "", "missing stays blank");
check(suggestSecretName("x".repeat(1000)).length === 255, "long names are capped");
same(parseHandoffRequest(query({ name: " a:b/c " }), allowed).request.name, "a_b_c", "request name is sanitized");
same(parseHandoffRequest(query({ name: "nomen client secret" }), allowed).request.name, "nomen_client_secret", "form-encoded spaces (+) decode as spaces");
check(query({ name: "a b" }).includes("name=a+b"), "the fixture really sends + for a space");
same(parseHandoffRequest(query().replace("name=GITHUB_PAT", "name=a%20b"), allowed).request.name, "a_b", "percent-encoded spaces decode as spaces");

// Messages and the filter.
const opener = { posted: [], postMessage(message, targetOrigin) { this.posted.push({ message: structuredClone(message), targetOrigin }); } };
const otherWindow = { postMessage() {} };
const valueEvent = (overrides = {}, data = {}) => ({
  origin: partner, source: opener,
  data: { type: "vaultix.save-secret.value", v: 1, nonce, value: "canary-value", ...data }, ...overrides
});
const expected = { origin: partner, source: opener, nonce };
same(readValueMessage(valueEvent(), expected), "canary-value", "valid value message");
const ignored = [
  ["wrong origin", valueEvent({ origin: "https://evil.example.com" })],
  ["origin with trailing slash", valueEvent({ origin: `${partner}/` })],
  ["wrong source", valueEvent({ source: otherWindow })],
  ["no source", valueEvent({ source: null })],
  ["wrong nonce", valueEvent({}, { nonce: "ZbCdEfGhIjKlMnOpQrStUv" })],
  ["wrong type", valueEvent({}, { type: "vaultix.save-secret.ready" })],
  ["wrong version", valueEvent({}, { v: 2 })],
  ["string version", valueEvent({}, { v: "1" })],
  ["empty value", valueEvent({}, { value: "" })],
  ["non-string value", valueEvent({}, { value: 42 })],
  ["oversized value", valueEvent({}, { value: "x".repeat(MAX_VALUE_BYTES + 1) })],
  ["oversized multibyte value", valueEvent({}, { value: "é".repeat(MAX_VALUE_BYTES / 2 + 1) })],
  ["extra field", valueEvent({}, { extra: true })],
  ["array data", { origin: partner, source: opener, data: [] }],
  ["string data", { origin: partner, source: opener, data: "vaultix.save-secret.value" }],
  ["null data", { origin: partner, source: opener, data: null }]
];
for (const [name, event] of ignored) same(readValueMessage(event, expected), null, `ignores ${name}`);
same(readValueMessage(valueEvent({}, { value: "x".repeat(MAX_VALUE_BYTES) }), expected)?.length, MAX_VALUE_BYTES, "64 KiB exactly is accepted");

same(readyMessage(nonce), { type: "vaultix.save-secret.ready", v: 1, nonce }, "ready message");
same(resultMessage(nonce, "fulfilled", { secretName: "A", version: 1 }), { type: "vaultix.save-secret.result", v: 1, nonce, status: "fulfilled", secretName: "A", version: 1 }, "fulfilled result");
same(resultMessage(nonce, "approval", { secretName: "A" }), { type: "vaultix.save-secret.result", v: 1, nonce, status: "approval", secretName: "A" }, "approval result");
same(resultMessage(nonce, "declined"), { type: "vaultix.save-secret.result", v: 1, nonce, status: "declined" }, "declined result");
same(resultMessage(nonce, "error", { secretName: "A", version: 3 }), { type: "vaultix.save-secret.result", v: 1, nonce, status: "error" }, "error result carries no details");

// The published contract agrees with the implementation.
const contract = JSON.parse(readFileSync(new URL("../contracts/vaultix.save-secret-handoff.v1.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ strict: false });
ajv.addSchema(contract);
const messageSchema = ajv.getSchema(contract.$id);
const requestSchema = ajv.compile({ $ref: `${contract.$id}#/$defs/request` });
const valueSchema = ajv.compile({ $ref: `${contract.$id}#/$defs/valueMessage` });
for (const message of [readyMessage(nonce), resultMessage(nonce, "fulfilled", { secretName: "A", version: 2 }),
  resultMessage(nonce, "approval", { secretName: "A" }), resultMessage(nonce, "declined"), resultMessage(nonce, "error"), valueEvent().data]) {
  check(messageSchema(message), `contract accepts ${message.type}/${message.status ?? ""}`);
}
for (const bad of [{ ...readyMessage(nonce), value: "x" }, { ...resultMessage(nonce, "declined"), secretName: "A" },
  { type: "vaultix.save-secret.result", v: 1, nonce, status: "fulfilled" }, { ...readyMessage(nonce), v: 2 }]) {
  check(!messageSchema(bad), `contract refuses ${JSON.stringify(bad).slice(0, 60)}`);
}
for (const [name, event] of ignored) {
  // A wrong nonce is well-formed; only the session can tell it is not this handoff's nonce.
  if (event.origin === partner && event.source === opener && event.data && typeof event.data === "object" && !name.includes("multibyte") && name !== "wrong nonce") {
    same(valueSchema(event.data), false, `contract and filter agree on ${name}`);
  }
}
for (const [problem, search, origins] of refused) {
  if (problem === "feature-off" || problem === "origin") continue;
  const params = Object.fromEntries(new URLSearchParams(search));
  if (new URLSearchParams(search).getAll("nonce").length > 1 || new URLSearchParams(search).getAll("origin").length > 1) continue;
  same(requestSchema(params), false, `contract and parser agree on ${problem}`);
}
check(requestSchema(Object.fromEntries(new URLSearchParams(query()))), "contract accepts the request query");
check(contract.$defs.kind.enum.join() === HANDOFF_KINDS.join(), "kinds match the contract");

// A full session: ready once, one value, the save call, one result, the value cleared.
const canary = `vx-canary-${"q".repeat(24)}`;
const sinks = { storage: [], console: [], telemetry: [], urls: [] };
const fakeStorage = { setItem: (k, v) => sinks.storage.push(`${k}=${v}`), getItem: () => null, removeItem() {} };
globalThis.localStorage = fakeStorage;
globalThis.sessionStorage = fakeStorage;
globalThis.posthog = { capture: (...args) => sinks.telemetry.push(JSON.stringify(args)) };
globalThis.history = { pushState: (...args) => sinks.urls.push(JSON.stringify(args)), replaceState: (...args) => sinks.urls.push(JSON.stringify(args)) };
const originalConsole = { ...console };
for (const level of ["log", "info", "warn", "error", "debug"]) console[level] = (...args) => sinks.console.push(args.map(String).join(" "));

const request = parseHandoffRequest(query({ name: "nomen client secret", kind: "client_secret" }), allowed).request;
const calls = [];
const runSession = async ({ respond, sessionOpener = opener } = {}) => {
  opener.posted = [];
  const session = createHandoffSession({
    opener: sessionOpener, request,
    createSecret: async (input) => { calls.push(structuredClone(input)); return respond(input); }
  });
  return session;
};

try {
  let session = await runSession({ respond: () => ({ secret: { secretKey: "nomen_client_secret", version: 1 } }) });
  same(session.snapshot().phase, "idle", "session starts idle");
  check(session.start(), "start posts ready");
  check(!session.start(), "ready is posted only once");
  same(opener.posted, [{ message: readyMessage(nonce), targetOrigin: partner }], "ready goes to the validated origin");
  check(!session.receive(valueEvent({ origin: "https://evil.example.com" }, { value: canary })), "foreign message ignored");
  same(session.snapshot().phase, "waiting", "still waiting after an ignored message");
  check(session.receive(valueEvent({}, { value: canary })), "value accepted");
  check(!session.receive(valueEvent({}, { value: "second-value" })), "a second value is ignored");
  same(session.snapshot().valueLength, canary.length, "snapshot exposes only the length");
  check(!JSON.stringify(session.snapshot()).includes(canary), "snapshot never contains the value");
  const target = { projectId: "proj-1", environment: "dev", secretPath: "/nomen", secretName: "nomen_client_secret" };
  const done = await session.save(target);
  same(calls.at(-1), createSecretRequest(target, canary, request), "save uses the create-secret request");
  same(createSecretRequest(target, canary, request), {
    path: "/api/v4/secrets/nomen_client_secret",
    body: { projectId: "proj-1", environment: "dev", secretPath: "/nomen", secretValue: canary, type: "shared", secretComment: "Saved from Nomen (client secret)" }
  }, "create-secret path and body");
  same(createSecretRequest({ ...target, secretName: "a b%" }, canary, request).path, "/api/v4/secrets/a%20b%25", "name is URL-encoded");
  same(done.phase, "done", "session done after save");
  same(done.result, { status: "fulfilled", secretName: "nomen_client_secret", version: 1 }, "fulfilled snapshot");
  same(opener.posted.slice(1), [{ message: resultMessage(nonce, "fulfilled", { secretName: "nomen_client_secret", version: 1 }), targetOrigin: partner }], "exactly one fulfilled result");
  session.cancel(); session.pageHidden();
  same(opener.posted.length, 2, "nothing is posted after the result");
  same(session.snapshot().valueLength, 0, "value cleared after the result");
  const callsBefore = calls.length;
  await session.save(target);
  same(calls.length, callsBefore, "a finished session cannot save again");

  session = await runSession({ respond: () => ({ approval: { id: "approval-1" } }) });
  session.start(); session.receive(valueEvent({}, { value: canary }));
  same((await session.save(target)).result, { status: "approval", secretName: "nomen_client_secret" }, "approval policy result");
  same(opener.posted.at(-1).message, resultMessage(nonce, "approval", { secretName: "nomen_client_secret" }), "approval posted");

  let attempts = 0;
  session = await runSession({ respond: () => { attempts++; const error = new Error("request failed"); error.response = { status: 400, data: { message: `Secret already exists ${attempts === 2 ? canary : ""}`.trim() } }; throw error; } });
  session.start(); session.receive(valueEvent({}, { value: canary }));
  let failed = await session.save(target);
  same(failed.phase, "received", "a failed save keeps the form for retry");
  same(failed.failedMessage, "Secret already exists", "server message is shown");
  same(opener.posted.length, 1, "no result posted after a failed attempt");
  failed = await session.save(target);
  same(failed.failedMessage, "Vaultix could not save this secret.", "a message containing the value is never shown");
  session.cancel();
  same(opener.posted.at(-1).message, resultMessage(nonce, "error"), "stopping after a failed save posts error");
  same(opener.posted.length, 2, "exactly one result");

  session = await runSession({ respond: () => ({ secret: { secretKey: "x", version: 1 } }) });
  session.start(); session.receive(valueEvent({}, { value: canary }));
  const before = calls.length;
  session.cancel();
  same(calls.length, before, "cancel stores nothing");
  same(opener.posted.at(-1).message, resultMessage(nonce, "declined"), "cancel posts declined");
  same(session.snapshot().valueLength, 0, "cancel clears the value");

  session = await runSession({ respond: () => ({}) });
  session.start();
  session.pageHidden();
  same(opener.posted.at(-1).message, resultMessage(nonce, "declined"), "closing the window after ready posts declined");

  session = await runSession({ respond: () => ({}) });
  session.pageHidden();
  same(opener.posted.length, 0, "closing before ready posts nothing");

  session = await runSession({ respond: () => ({}), sessionOpener: null });
  check(!session.start(), "no opener cannot start");
  same(session.snapshot().phase, "no-opener", "no opener is an error state");

  session = await runSession({ respond: () => ({ unexpected: true }) });
  session.start(); session.receive(valueEvent({}, { value: canary }));
  failed = await session.save(target);
  same(failed.failedMessage, "Vaultix could not save this secret.", "an unrecognised response is a failure");

  for (const message of opener.posted) check(!JSON.stringify(message).includes(canary), "no posted message carries the value");
} finally {
  Object.assign(console, originalConsole);
}
for (const [sink, entries] of Object.entries(sinks)) check(!entries.join("\n").includes(canary), `value absent from ${sink}`);

// Remembered choice never carries a value.
const remembered = serializeRememberedChoice({ organizationId: "org-1", projectId: "proj-1", environment: "dev", secretPath: "/nomen", secretValue: canary, value: canary });
check(!remembered.includes(canary), "remembered choice drops the value");
same(readRememberedChoice(remembered), { organizationId: "org-1", projectId: "proj-1", environment: "dev", secretPath: "/nomen" }, "remembered choice round trip");
for (const raw of [null, "", "{", "[]", JSON.stringify({ projectId: 1 }), JSON.stringify({ organizationId: "o", projectId: "p", environment: "e", secretPath: "relative" })]) {
  same(readRememberedChoice(raw), null, `ignores remembered choice ${String(raw).slice(0, 40)}`);
}

// Sign-in return path: same-origin relative paths only.
const site = "https://vaultix.example.com";
const returnCases = [
  ["/integrations/save-secret?v=1&nonce=x", "/integrations/save-secret?v=1&nonce=x"],
  [`${site}/integrations/save-secret?v=1#top`, "/integrations/save-secret?v=1#top"],
  [`${site}/organizations/abc/projects`, "/organizations/abc/projects"],
  ["https://evil.example.com/integrations/save-secret", undefined],
  ["//evil.example.com/path", undefined],
  ["/\\evil.example.com/path", undefined],
  ["\\\\evil.example.com", undefined],
  [`${site}//evil.example.com/path`, undefined],
  ["javascript:alert(1)", undefined],
  ["data:text/html,hi", undefined],
  ["relative/path", undefined],
  ["", undefined],
  [42, undefined],
  [undefined, undefined],
  [`/${"a".repeat(4096)}`, undefined],
  ["/ok\nSet-Cookie: x", undefined],
  [`http://vaultix.example.com/downgrade`, undefined]
];
for (const [raw, expectedPath] of returnCases) same(toSafeReturnPath(raw, site), expectedPath, `return path ${String(raw).slice(0, 50)}`);

console.log(`Save to Vaultix handoff: ${checks} checks passed.`);
