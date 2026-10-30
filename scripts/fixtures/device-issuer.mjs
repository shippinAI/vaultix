// Disposable CLI protocol fixture only. This is not a Nomen service or an
// identity validator: access tokens are provisioned by the real test application.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const issuer = "http://127.0.0.1:18181";
let refreshes = 0;
let rejected = false;
createServer(async (req, res) => {
  const send = (status, data) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
  if (req.url === "/.well-known/openid-configuration") return send(200, { issuer, device_authorization_endpoint: `${issuer}/device`, token_endpoint: `${issuer}/token` });
  if (req.url === "/counts") return send(200, { refreshes });
  if (req.url === "/reject" && req.method === "POST") { rejected = true; return send(200, {}); }
  let body = "";
  for await (const chunk of req) { body += chunk; if (body.length > 16384) return send(413, { error: "oversized" }); }
  const form = new URLSearchParams(body);
  if (req.method !== "POST" || form.get("client_id") !== "vaultix-cli-fixture" || form.has("client_secret")) return send(400, { error: "invalid_client" });
  if (req.url === "/device") {
    if (form.get("scope") !== "openid profile email offline_access") return send(400, { error: "invalid_scope" });
    return send(200, { device_code: config.deviceCode, user_code: "TEST-ONLY", verification_uri: `${issuer}/approve`, expires_in: 60, interval: 1 });
  }
  if (req.url !== "/token") return send(404, { error: "not_found" });
  if (form.get("grant_type") === "urn:ietf:params:oauth:grant-type:device_code" && form.get("device_code") === config.deviceCode) {
    return send(200, { access_token: config.initialAccess, refresh_token: config.initialRefresh, token_type: "Bearer", expires_in: 2 });
  }
  if (form.get("grant_type") === "refresh_token") {
    refreshes++;
    if (rejected || refreshes !== 1 || form.get("refresh_token") !== config.initialRefresh) return send(400, { error: "invalid_grant", error_description: config.initialRefresh });
    return send(200, { access_token: config.nextAccess, refresh_token: config.nextRefresh, token_type: "Bearer", expires_in: 3600 });
  }
  return send(400, { error: "invalid_grant" });
}).listen(18181, "127.0.0.1");
