import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const origin = process.argv[2];
assert.equal(process.env.VAULTIX_IMAGE_API_PROOF, "1", "Run only against a disposable smoke instance.");
assert.match(origin ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const config = await (await fetch(`${origin}/api/v1/admin/config`)).json();
assert.equal(config.config.initialized, false, "Refusing to probe an initialized instance.");
const canary = "request-value-must-stay-private";
// Keep each parser-failure exchange on its own connection. Fastify closes these
// connections because unread request bytes must not become a subsequent request.
function post(item) {
  return new Promise((resolveResponse, reject) => {
    const req = request(`${origin}/api/v3/auth/login`, {
      method: "POST", agent: false,
      headers: { "Content-Type": item.type, "Content-Length": Buffer.byteLength(item.body) },
      signal: AbortSignal.timeout(15_000)
    }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; });
      response.on("error", reject);
      response.on("end", () => resolveResponse({ status: response.statusCode, text: body }));
    });
    req.on("error", reject);
    if (item.status === 413) {
      // Specifically verify rejection from the declared length before uploading
      // any body bytes. Eager-upload closure/reset behavior is a separate open
      // transport acceptance case, not evidence supplied by this probe.
      req.flushHeaders();
    } else {
      req.end(item.body);
    }
  });
}
const cases = [
  { name: "unsupported-media", type: "application/x-vaultix-invalid", body: canary, status: 415, error: "UnsupportedMediaType" },
  { name: "malformed-json", type: "application/json", body: `{"name":"${canary}",`, status: 400, error: "InvalidJsonBody" },
  { name: "empty-json", type: "application/json", body: "", status: 400, error: "EmptyJsonBody" },
  { name: "oversized-declared-length", type: "application/json", body: JSON.stringify({ name: canary.repeat(40_000) }), status: 413, error: "RequestBodyTooLarge" },
  { name: "prototype-poisoning", type: "application/json", body: `{"__proto__":{"name":"${canary}"}}`, status: 400, error: "InvalidJsonBody" }
];
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache", "api-error-proof-"));
const checks = [];
let passed = false;
try {
  for (const item of cases) {
    const response = await post(item);
    assert.equal(response.status, item.status, `${item.name}: wrong HTTP status`);
    const text = response.text;
    assert.equal(text.includes(canary), false, `${item.name}: submitted value appeared in response`);
    const body = JSON.parse(text);
    assert.equal(body.error, item.error);
    assert.equal(body.statusCode, item.status);
    assert.equal(typeof body.message, "string");
    checks.push({ name: item.name, status: response.status, error: body.error });
  }
  passed = true;
} finally {
  writeFileSync(resolve(evidence, "result.json"), `${JSON.stringify({
    passed, checks, scope: "Real HTTP requests against a disposable canonical image. Oversize checks early declared-length rejection only; eager-upload reset behavior remains open. Content-length mismatch and unknown/auth/CSR behavior are separately covered by Fastify injection tests."
  }, null, 2)}\n`);
  console.log(`API request-error evidence: ${evidence}`);
}
