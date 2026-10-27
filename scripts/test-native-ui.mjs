// Built UI + real authored catalog; authentication and action responses are fixtures.
// This verifies browser behavior, not Nomen or database integration.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import fastify from "../core/backend/node_modules/fastify/fastify.js";
import staticPlugin from "../core/backend/node_modules/@fastify/static/index.js";
import { registerVaultixRouter } from "../core/backend/dist/server/routes/vaultix-router.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "core/e2e/package.json"));
const { chromium } = require("playwright");
const AxeBuilder = require("@axe-core/playwright").default;
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
  const accessibility = [];
  const audit = async (state) => {
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const summarize = rules => rules.map(rule => ({ id: rule.id, impact: rule.impact,
      nodes: rule.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }));
    accessibility.push({ state, engine: result.testEngine, violations: summarize(result.violations), manualReview: summarize(result.incomplete) });
    writeFileSync(resolve(evidence, "accessibility.json"), JSON.stringify(accessibility, null, 2));
  };
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin);
  await page.getByRole("heading", { name: "Your secrets. Your workspace." }).waitFor();
  await page.keyboard.press("Tab");
  assert.equal(await page.getByRole("link", { name: "Skip to Content" }).evaluate(element => element === document.activeElement), true);
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("main").evaluate(element => element === document.activeElement), true);
  await page.getByText("One Project for Each App", { exact: true }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Open Your Vault" }).getAttribute("href"), "/login");
  assert.equal(await page.getByRole("link", { name: "API Reference" }).getAttribute("href"), "/api/docs");
  assert.equal(await page.getByRole("navigation", { name: "Vaultix workspace" }).evaluate(element => element.scrollWidth <= element.clientWidth), true);
  await page.screenshot({ path: resolve(evidence, "workspace-desktop.png"), fullPage: true });
  await audit("workspace-desktop");
  await page.getByRole("button", { name: "Connect Clyffy" }).click();
  assert.equal(await page.getByRole("heading", { name: "Your AI, connected to Vaultix." }).evaluate(element => element === document.activeElement), true);
  await page.getByRole("button", { name: "Copy Connection" }).click();
  await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
  assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n"), `[mcp_servers.vaultix]\nurl = "${origin}/api/v1/vaultix/mcp"`);
  await page.getByRole("radio", { name: "Codex subscription", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByRole("radio", { name: "My Codex setup", exact: true }).isChecked(), true);
  await page.getByText("Keep your existing Codex provider and authentication configuration.", { exact: true }).waitFor();
  await page.getByRole("radio", { name: "Another AI client", exact: true }).check();
  await page.getByRole("button", { name: "Copy Connection" }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${origin}/api/v1/vaultix/mcp`);
  await page.screenshot({ path: resolve(evidence, "connections-desktop.png"), fullPage: true });
  await audit("connections-desktop");
  await page.setViewportSize({ width: 320, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.getByRole("region", { name: "MCP connection configuration" }).focus();
  assert.equal(await page.getByRole("region", { name: "MCP connection configuration" }).evaluate(element => element === document.activeElement), true);
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => document.querySelector('[aria-label="MCP connection configuration"]').scrollLeft > 0);
  await audit("connections-reflow-320");
  await page.setViewportSize({ width: 1440, height: 1000 });

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
  await audit("references-denied");
  mode = "no-apps";
  await page.getByRole("button", { name: "Retry Apps" }).click();
  await page.getByText("You don't have an app in this organization yet.", { exact: false }).waitFor();
  mode = "available";
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Browse Secret References" }).click();
  await page.getByRole("combobox", { name: "App", exact: true }).click();
  await page.getByRole("option", { name: "Demo App" }).click();
  await page.getByRole("combobox", { name: "Environment", exact: true }).click();
  await page.getByRole("option", { name: "Development" }).click();
  await page.getByRole("button", { name: "Show References" }).click();
  await page.getByText("DATABASE_URL", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Copy Name: DATABASE_URL", exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "DATABASE_URL");
  await page.getByRole("searchbox", { name: "Find on this page" }).fill("missing");
  await page.getByText("No names match on this page.", { exact: false }).waitFor();
  await page.getByRole("searchbox", { name: "Find on this page" }).fill("");
  assert.equal(await page.getByText("MUST-NOT-RENDER", { exact: true }).count(), 0);
  assert.deepEqual(calls.at(-1), { name: "vaultix.secrets.references", arguments: { projectId: "11111111-1111-4111-8111-111111111111", environment: "dev", secretPath: "/", offset: 0, limit: 50 } });
  assert.equal(await page.getByRole("button", { name: "Next", exact: true }).isDisabled(), true);
  await page.screenshot({ path: resolve(evidence, "references-desktop.png"), fullPage: true });
  await audit("references-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: resolve(evidence, "references-mobile.png"), fullPage: true });
  await audit("references-mobile");
  await page.setViewportSize({ width: 320, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await audit("references-reflow-320");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "Vaultix home", exact: true }).scrollIntoViewIfNeeded();
  const mobileMainTop = await page.locator("main").evaluate(element => element.getBoundingClientRect().top);
  await page.mouse.move(360, 420);
  await page.mouse.wheel(0, 650);
  await page.waitForFunction(previousTop => document.querySelector("main").getBoundingClientRect().top < previousTop - 100, mobileMainTop, { timeout: 5000 });
  mode = "empty";
  await page.getByRole("textbox", { name: "Folder", exact: true }).fill("/empty");
  assert.equal(await page.getByText("DATABASE_URL", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Show References" }).click();
  await page.getByText("No accessible references on this page.", { exact: true }).waitFor();
  mode = "denied";
  await page.getByRole("textbox", { name: "Folder", exact: true }).fill("/restricted");
  await page.getByRole("button", { name: "Show References" }).click();
  await page.getByText("This folder is unavailable or your access has changed.", { exact: false }).waitFor();
  await page.route("**/api/v1/vaultix/connections", (route) => route.fulfill({ json: {
    schemaVersion: "vaultix.connections.v1", source: "catalog", mcpPath: "https://untrusted.example/mcp",
    access: "UNSAFE-CONNECTION-CANARY", options: []
  } }));
  await page.reload();
  await page.getByRole("button", { name: "Connect Clyffy" }).click();
  await page.getByRole("button", { name: "Retry Connection Guide" }).waitFor();
  assert.equal(await page.getByText("UNSAFE-CONNECTION-CANARY").count(), 0);
  await page.route("**/api/v1/vaultix/configure", (route) => route.fulfill({ json: { schemaVersion: "vaultix.configure.v1", source: "catalog", components: [{ id: "unsafe", component: "execute-script", title: "UNSAFE-CANARY", description: "must not render" }] } }));
  await page.reload();
  await page.getByRole("button", { name: "Try Again" }).waitFor();
  assert.equal(await page.getByText("UNSAFE-CANARY").count(), 0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/login`);
  await page.getByPlaceholder("you@company.com").waitFor();
  await page.getByRole("heading", { name: "Welcome back", level: 1, exact: true }).waitFor();
  const email = page.getByRole("textbox", { name: "Email", exact: true });
  const password = page.getByLabel("Password", { exact: true });
  assert.equal(await email.getAttribute("autocomplete"), "username");
  assert.equal(await password.getAttribute("autocomplete"), "current-password");
  await password.fill("FIXTURE-PASSWORD-NOT-SUBMITTED");
  await page.getByRole("button", { name: "Show password", exact: true }).focus();
  await page.keyboard.press("Space");
  assert.equal(await password.getAttribute("type"), "text");
  await page.keyboard.press("Space");
  assert.equal(await password.getAttribute("type"), "password");
  await password.fill("");
  await page.getByRole("heading", { name: "Shippin secrets you own. Build with confidence." }).waitFor();
  assert.equal(await page.getByText("Trusted by 400,000+ developers").count(), 0);
  assert.equal(await page.getByRole("link", { name: "API Reference" }).getAttribute("href"), "/api/docs");
  await page.screenshot({ path: resolve(evidence, "login-desktop.png"), fullPage: true });
  await audit("login-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: resolve(evidence, "login-mobile.png"), fullPage: true });
  await audit("login-mobile");
  await page.setViewportSize({ width: 320, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await audit("login-reflow-320");
  assert.deepEqual(accessibility.flatMap(scan => scan.violations.map(rule => ({ state: scan.state, ...rule }))), []);
  assert.deepEqual(failures, []);
  console.log(`Native browser checks passed. Authentication/action responses were fixtures. Screenshots: ${evidence}`);
} finally {
  await browser?.close();
  await server.close();
}
