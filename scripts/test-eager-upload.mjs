// Opt-in transport characterization against a disposable standalone image.
// Unlike the declared-length probe, this eagerly sends the oversized body.
import assert from "node:assert/strict";
import { request } from "node:http";

const origin = process.argv[2];
assert.equal(process.env.VAULTIX_IMAGE_API_PROOF, "1", "Only run against a disposable smoke instance.");
assert.match(origin ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const config = await (await fetch(`${origin}/api/v1/admin/config`, { signal: AbortSignal.timeout(15000) })).json();
assert.equal(config.config.initialized, false, "Refusing to probe an initialized instance.");

const body = JSON.stringify({ value: "x".repeat(1200000) });
const outcomes = {};
for (let n = 0; n < 12; n += 1) {
  const outcome = await new Promise(resolve => {
    const req = request(`${origin}/api/v3/auth/login`, {
      method: "POST", agent: false,
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      signal: AbortSignal.timeout(15000)
    }, res => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve(res.statusCode === 413 && parsed.error === "RequestBodyTooLarge" ? "413" : "unexpected-response");
        } catch { resolve("invalid-response"); }
      });
      res.on("error", error => resolve(error.code || "response-error"));
    });
    req.on("error", error => resolve(error.code || "request-error"));
    req.end(body);
  });
  outcomes[outcome] = (outcomes[outcome] || 0) + 1;
}
const passed = outcomes["413"] === 12;
console.log(JSON.stringify({ passed, scope: "eager oversized uploads against disposable HTTP image", requests: 12, outcomes }));
if (!passed) process.exitCode = 1;
