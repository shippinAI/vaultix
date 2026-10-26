// Built UI + real authored catalog; authentication and action responses are fixtures.
// This verifies browser behavior, not Nomen or database integration.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import fastify from "../core/backend/node_modules/fastify/fastify.js";
import staticPlugin from "../core/backend/node_modules/@fastify/static/index.js";
import { registerVaultixRouter } from "../core/backend/dist/server/routes/vaultix-router.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "core/e2e/package.json"));
const { chromium } = require("playwright");
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache/ui-proof-"));
const server = fastify();
let browser;
try {
  await server.register(registerVaultixRouter, { prefix: "/api/v1/vaultix" });
  server.post("/api/v1/auth/token", async (_, reply) => reply.code(401).send({ error: "No preview session." }));
  server.get("/api/v1/admin/config", async () => ({ config: {
    initialized: true, allowSignUp: true, disableAuditLogStorage: false,
    defaultAuthOrgSlug: null, defaultAuthOrgId: null, enabledLoginMethods: ["email"],
    passwordPolicy: { requirements: [] }, invalidatingCache: false
  } }));
  server.get("/runtime-ui-env.js", async (_, reply) => reply.type("application/javascript").send(
    'window.__VAULTIX_RUNTIME_ENV__ = { TELEMETRY_CAPTURING_ENABLED: false }; window.__toCdnUrl = f => "/" + f;'
  ));
  await server.register(staticPlugin, { root: resolve(root, "core/frontend/dist") });
  server.setNotFoundHandler((_, reply) => reply.sendFile("index.html"));
  const origin = await server.listen({ host: "127.0.0.1", port: 0 });
  browser = await chromium.launch({ headless: true, ...(process.env.VAULTIX_BROWSER_CHANNEL ? { channel: process.env.VAULTIX_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin);
  await page.getByRole("heading", { name: /Build your app/ }).waitFor();
  await page.getByText("One Project for Each App", { exact: true }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Open Your Vault" }).getAttribute("href"), "/login");
  await page.getByRole("button", { name: "Connect Clyffy" }).click();
  await page.getByRole("button", { name: "Copy Connection" }).click();
  await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
  assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n"), `[mcp_servers.vaultix]\nurl = "${origin}/api/v1/vaultix/mcp"`);

  let mode = "denied";
  const calls = [];
  await page.route("**/api/v1/vaultix/mcp", async (route) => {
    const request = route.request().postDataJSON();
    calls.push(request.params);
    if (mode === "denied") return route.fulfill({ status: 404, json: { error: "This resource is unavailable." } });
    const value = request.params.name === "vaultix.projects.list"
      ? { projects: mode === "no-apps" ? [] : [{ id: "11111111-1111-4111-8111-111111111111", name: "Demo App", environments: [{ id: "dev", name: "Development", slug: "dev" }] }] }
      : { narration: "Values stay in your vault.", references: mode === "empty" ? [] : [{ id: "reference-one", name: "DATABASE_URL", version: 2, value: "MUST-NOT-RENDER" }], nextOffset: null };
    return route.fulfill({ json: { jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: JSON.stringify(value) }] } } });
  });
  await page.getByRole("button", { name: "Browse Secret References" }).click();
  await page.getByRole("button", { name: "Retry Apps" }).waitFor();
  mode = "no-apps";
  await page.getByRole("button", { name: "Retry Apps" }).click();
  await page.getByText("You don't have an app in this organization yet.", { exact: false }).waitFor();
  mode = "available";
  await page.getByRole("button", { name: "Browse Secret References" }).click();
  await page.getByRole("button", { name: "Browse Secret References" }).click();
  await page.getByRole("combobox", { name: "App", exact: true }).click();
  await page.getByRole("option", { name: "Demo App" }).click();
  await page.getByRole("combobox", { name: "Environment", exact: true }).click();
  await page.getByRole("option", { name: "Development" }).click();
  await page.getByRole("button", { name: "Show References" }).click();
  await page.getByText("DATABASE_URL", { exact: true }).waitFor();
  assert.equal(await page.getByText("MUST-NOT-RENDER", { exact: true }).count(), 0);
  assert.deepEqual(calls.at(-1), { name: "vaultix.secrets.references", arguments: { projectId: "11111111-1111-4111-8111-111111111111", environment: "dev", secretPath: "/", offset: 0, limit: 50 } });
  assert.equal(await page.getByRole("button", { name: "Next", exact: true }).isDisabled(), true);
  await page.screenshot({ path: resolve(evidence, "references-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: resolve(evidence, "references-mobile.png"), fullPage: true });
  mode = "empty";
  await page.getByRole("textbox", { name: "Folder", exact: true }).fill("/empty");
  assert.equal(await page.getByText("DATABASE_URL", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Show References" }).click();
  await page.getByText("No accessible references on this page.", { exact: true }).waitFor();
  mode = "denied";
  await page.getByRole("textbox", { name: "Folder", exact: true }).fill("/restricted");
  await page.getByRole("button", { name: "Show References" }).click();
  await page.getByText("This folder is unavailable or your access has changed.", { exact: false }).waitFor();
  await page.route("**/api/v1/vaultix/configure", (route) => route.fulfill({ json: { schemaVersion: "vaultix.configure.v1", source: "catalog", components: [{ id: "unsafe", component: "execute-script", title: "UNSAFE-CANARY", description: "must not render" }] } }));
  await page.reload();
  await page.getByRole("button", { name: "Try Again" }).waitFor();
  assert.equal(await page.getByText("UNSAFE-CANARY").count(), 0);
  assert.deepEqual(failures, []);
  console.log(`Native browser checks passed. Authentication/action responses were fixtures. Screenshots: ${evidence}`);
} finally {
  await browser?.close();
  await server.close();
}
