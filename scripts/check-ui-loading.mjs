// Cold built-UI measurements with fixture instance configuration, never credentials.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastify from "../core/backend/node_modules/fastify/fastify.js";
import staticPlugin from "../core/backend/node_modules/@fastify/static/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "core/e2e/package.json"));
const { chromium } = require("playwright");
const baseline = process.argv.includes("--baseline");
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache/loading-proof-"));
const server = fastify();
let browser;
const runs = [];
try {
  server.get("/api/v1/admin/config", async () => ({ config: {
    initialized: true, allowSignUp: true, disableAuditLogStorage: false,
    defaultAuthOrgSlug: null, defaultAuthOrgId: null, enabledLoginMethods: ["email"],
    passwordPolicy: { requirements: [] }, invalidatingCache: false
  } }));
  server.post("/api/v1/auth/token", async (_, reply) => reply.code(401).send({ error: "No measurement session." }));
  server.get("/runtime-ui-env.js", async (_, reply) => reply.type("application/javascript").send(
    'window.__VAULTIX_RUNTIME_ENV__ = { TELEMETRY_CAPTURING_ENABLED: false }; window.__toCdnUrl = f => "/" + f;'
  ));
  await server.register(staticPlugin, { root: resolve(root, "core/frontend/dist") });
  server.setNotFoundHandler((_, reply) => reply.sendFile("index.html"));
  const origin = await server.listen({ host: "127.0.0.1", port: 0 });
  browser = await chromium.launch({ headless: true, ...(process.env.VAULTIX_BROWSER_CHANNEL ? { channel: process.env.VAULTIX_BROWSER_CHANNEL } : {}) });
  for (let run = 0; run < 3; run += 1) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    // Routing disables the browser HTTP cache; each context also has fresh storage.
    await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(origin);
    try {
      await page.getByRole("heading", { name: "Welcome back", exact: true }).waitFor();
    } catch (error) {
      writeFileSync(resolve(evidence, "startup-failure.json"), JSON.stringify({ errors, message: error.message }, null, 2));
      throw error;
    }
    await page.getByLabel("Email", { exact: true }).fill("typing-check@example.invalid");
    const readyMs = await page.evaluate(() => performance.now());
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle");
    const resources = await page.evaluate(() => performance.getEntriesByType("resource").map(entry => ({
      path: new URL(entry.name).pathname, type: entry.initiatorType,
      decodedBytes: entry.decodedBodySize, encodedBytes: entry.encodedBodySize,
      transferBytes: entry.transferSize
    })));
    const assets = resources.filter(entry => /\.(js|css|wasm|woff2?|svg|png|webp|avif)$/.test(entry.path));
    const result = { readyMs: Math.round(readyMs), requests: assets.length,
      decodedAssetBytes: assets.reduce((total, entry) => total + entry.decodedBytes, 0),
      decodedJavaScriptBytes: assets.filter(entry => entry.path.endsWith(".js")).reduce((total, entry) => total + entry.decodedBytes, 0),
      resources: assets, errors };
    runs.push(result);
    writeFileSync(resolve(evidence, "result.json"), JSON.stringify({
      scope: "Built login UI; fixture config; cold cache; local uncompressed static server; no network/CPU throttling. Timing is diagnostic, not a hosted SLA.",
      baseline, browser: browser.version(), runs
    }, null, 2));
    assert.deepEqual(errors, [], "Login must not throw browser errors");
    assert.equal(new URL(page.url()).pathname, "/login");
    if (!baseline) {
      assert.equal(assets.some(entry => /dotlottie|LottiePlayer/i.test(entry.path)), false, "Optional animation runtime must not load at sign-in");
      assert.equal(assets.some(entry => /recharts/i.test(entry.path)), false, "Chart renderer must not load at sign-in");
      assert.equal(assets.some(entry => entry.path.endsWith(".wasm")), false, "Sign-in must not load WebAssembly");
      assert.ok(result.decodedJavaScriptBytes <= 3_100_000, "Cold login JavaScript exceeds the 3.1 MB decoded budget");
      assert.ok(result.decodedAssetBytes <= 3_650_000, "Cold login assets exceed the 3.65 MB decoded budget");
    }
    if (run === 0) {
      await page.screenshot({ path: resolve(evidence, "login-desktop.png"), fullPage: true });
      if (!baseline) {
        const art = page.locator('[data-vaultix-art="vault-cutaway"]');
        assert.equal(await art.isVisible(), true);
        assert.equal(await art.getAttribute("aria-hidden"), "true");
        assert.equal(await art.locator("image, foreignObject, filter, animate, script").count(), 0);
        assert.ok(Buffer.byteLength(await art.evaluate(element => element.outerHTML)) < 6000, "Auth illustration exceeds the 6 KB markup budget");
        await page.setViewportSize({ width: 1280, height: 600 });
        await page.getByLabel("Password", { exact: true }).scrollIntoViewIfNeeded();
        assert.equal(await page.getByLabel("Password", { exact: true }).isVisible(), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: resolve(evidence, "login-short-desktop.png"), fullPage: true });
        await page.setViewportSize({ width: 320, height: 800 });
        assert.equal(await art.isVisible(), false);
        assert.equal(await page.getByLabel("Email", { exact: true }).isVisible(), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: resolve(evidence, "login-mobile.png"), fullPage: true });
      }
    }
    await context.close();
  }
  console.log(JSON.stringify({ evidence, runs: runs.map(({ resources, ...run }) => run) }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
