import assert from "node:assert/strict";
import { classifyLoginFailure, loginRetrySeconds } from "../core/frontend/src/pages/auth/LoginPage/components/InitialStep/login-failure.ts";

const now = Date.UTC(2026, 9, 28, 12);
const headerCases = [
  ["0", 0], ["12", 12], [" 60 ", 60], ["86400", 86400],
  [new Date(now + 17000).toUTCString(), 17],
  [undefined, 60], [null, 60], [[], 60], [123, 60], ["-2", 60], ["1.5", 60],
  ["Infinity", 60], ["999999999999999999999", 60], ["86401", 60],
  ["x".repeat(129), 60], [new Date(now - 1000).toUTCString(), 0], ["", 60]
];
for (const [value, expected] of headerCases) assert.equal(loginRetrySeconds(value, now), expected);
const response = (status, data = {}, headers = {}) => ({ response: { status, data, headers } });
const failures = [
  [response(429, { error: "Captcha Required" }, { "retry-after": "7" }), "limited"],
  [response(503, { error: "User Locked" }), "unavailable"],
  [response(500), "unavailable"], [response(400, { error: "User Locked" }), "locked"],
  [response(400, { error: "Captcha Required" }), "captcha"],
  [response(400, { message: "Invalid credentials" }), "credentials"],
  [response(401), "credentials"], [{ isAxiosError: true }, "network"],
  [new Error("private diagnostic"), "unknown"], [undefined, "unknown"], [null, "unknown"],
  [response(400, { message: "private diagnostic" }), "unknown"], [response(403), "unknown"],
  [{ response: [] }, "unknown"]
];
for (const [error, kind] of failures) assert.equal(classifyLoginFailure(error, now).kind, kind);
const sensitive = "never-copy-request-or-provider-content";
for (const status of [400, 401, 429, 500, 503]) {
  const result = classifyLoginFailure({ config: { data: sensitive }, response: { status, data: { message: sensitive, error: sensitive } } }, now);
  assert.ok(!JSON.stringify(result).includes(sensitive));
}
console.log(`Login failure policy: ${headerCases.length + failures.length + 5} checks passed.`);
