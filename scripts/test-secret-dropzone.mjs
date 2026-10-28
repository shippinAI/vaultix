// Explicit component fixtures, separate from packaged real-API acceptance.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../core/frontend/node_modules/vite/dist/node/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "core/e2e/package.json"));
const { chromium, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache/dropzone-proof-"));
const cases = [];
process.chdir(resolve(root, "core/frontend"));
const server = await createServer({
  server: { host: "127.0.0.1", port: 0, hmr: false, open: false }, logLevel: "error",
  plugins: [{
    name: "vaultix-dropzone-fixtures", enforce: "pre",
    resolveId(source, importer = "") {
      const file = importer.replaceAll("\\", "/");
      if (file.endsWith("/permissions/ProjectPermissionCan.tsx") && source.includes("context/ProjectPermissionContext")) return "\0dropzone-permissions";
      if (!file.endsWith("/SecretDropzone/SecretDropzone.tsx")) return;
      if (source === "./PasteSecretsDialog") return "\0dropzone-paste";
      if (source === "./CsvColumnMapDialog") return "\0dropzone-csv";
    },
    load(id) {
      if (id === "\0dropzone-permissions") return `export * from '/src/context/ProjectPermissionContext/types.ts'; import {createMongoAbility} from '@casl/ability'; export const useProjectPermission=()=>({permission:createMongoAbility(new URLSearchParams(location.search).get('allowed')==='1'?[{action:'create',subject:'secrets'}]:[])});`;
      if (id === "\0dropzone-paste") return `import React from 'react'; export const PasteSecretsDialog=({isOpen})=>isOpen?React.createElement('div',{role:'dialog','aria-label':'Paste secrets fixture'},'Fixture dialog only'):null;`;
      if (id === "\0dropzone-csv") return "export const CsvColumnMapDialog=()=>null;";
    }
  }]
});
let browser;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.VAULTIX_BROWSER_CHANNEL ? { channel: process.env.VAULTIX_BROWSER_CHANNEL } : {}) });
  for (const width of [1440, 390, 320]) {
    for (const allowed of [true, false]) {
      const name = `${allowed ? "allowed" : "denied"}-${width}`;
      const context = await browser.newContext({ viewport: { width, height: 700 }, reducedMotion: "reduce" });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => {
        errors.push(error.message);
        writeFileSync(resolve(evidence, `${name}-errors.json`), JSON.stringify(errors, null, 2));
      });
      await page.route("**/*", route => {
        const url = new URL(route.request().url());
        return url.origin !== origin || url.pathname.startsWith("/api/") ? route.abort() : route.continue();
      });
      await page.route(`${origin}/__dropzone-fixture?**`, route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en"><head><title>Vaultix secret import fixture</title></head><body class="dark bg-bunker-800"><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>(type)=>type; window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/secret-dropzone-fixture.tsx"></script></body></html>` }));
      await page.goto(`${origin}/__dropzone-fixture?allowed=${allowed ? 1 : 0}`);
      await expect(page.getByRole("heading", { name: "Secret import component fixture", exact: true })).toBeVisible({ timeout: 30000 });
      const paste = page.getByRole("button", { name: "Paste Secrets", exact: true });
      const add = page.getByRole("button", { name: "Add a New Secret", exact: true });
      await expect(add).toHaveCount(1);
      await expect(paste).toHaveCount(1);
      await expect(add).toBeVisible();
      const upload = page.getByLabel("Upload your secrets", { exact: true });
      const surface = page.locator('[data-slot="empty"]').first();
      if (allowed) {
        const before = await surface.evaluate(element => getComputedStyle(element).boxShadow);
        await upload.focus();
        await expect(upload).toBeFocused();
        assert.notEqual(await surface.evaluate(element => getComputedStyle(element).boxShadow), before, "File input focus needs a visible surface indicator");
        await page.keyboard.press("Tab");
        await expect(paste).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(add).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(page.getByLabel("Fixture action count")).toHaveText("1");
      } else {
        await expect(upload).toHaveCount(0);
        await expect(add).toBeDisabled();
        await expect(paste).toBeDisabled();
        await paste.focus();
        await expect(page.getByRole("tooltip", { name: "Access Denied", exact: true })).toBeVisible();
        await page.keyboard.press("Enter");
        await page.keyboard.press("Tab");
        await expect(add).toBeFocused();
        await page.keyboard.press("Space");
        await add.evaluate(button => button.click());
        await paste.evaluate(button => button.click());
        await expect(page.getByLabel("Fixture action count")).toHaveText("0");
        await expect(page.getByRole("dialog")).toHaveCount(0);
      }
      await page.keyboard.press("Escape");
      const bounds = await page.locator('section[aria-label="Secret upload"]').evaluate(element => ({ right: element.getBoundingClientRect().right, scrollWidth: document.documentElement.scrollWidth, viewport: innerWidth }));
      const card = await surface.boundingBox();
      for (const control of [paste, add]) {
        const box = await control.boundingBox();
        assert.ok(box.x >= card.x && box.x + box.width <= card.x + card.width && box.y >= card.y && box.y + box.height <= card.y + card.height, "Every action must fit inside the upload card");
      }
      assert.ok(bounds.right <= width && bounds.scrollWidth <= width, "Secret upload controls must fit without horizontal scrolling");
      const report = await new AxeBuilder({ page }).include('section[aria-label="Secret upload"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      writeFileSync(resolve(evidence, `${name}.json`), JSON.stringify({ fixtures: true, engine: report.testEngine, violations: report.violations, manualReview: report.incomplete, bounds, errors }, null, 2));
      await page.screenshot({ path: resolve(evidence, `${name}.png`) });
      assert.deepEqual(errors, []);
      assert.equal(report.violations.length, 0, `Accessibility violations in ${name}`);
      if (allowed) {
        await paste.click();
        await expect(page.getByRole("dialog", { name: "Paste secrets fixture" })).toBeVisible();
      }
      cases.push({ name, passed: true });
      await context.close();
    }
  }
  console.log(`Secret dropzone fixtures passed: ${cases.length}. Evidence: ${evidence}`);
} finally {
  writeFileSync(resolve(evidence, "result.json"), JSON.stringify({ fixtures: true, passed: cases.length === 6, cases }, null, 2));
  await browser?.close();
  await server.close();
}
