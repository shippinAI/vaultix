import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(resolve(root, "core/e2e/package.json"));
const { chromium, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const directory = resolve(root, ".cache/storybook-workbench");
assert.ok(existsSync(resolve(directory, "iframe.html")), "Build the planned static workbench first");
const evidence = mkdtempSync(resolve(root, ".cache/domain-workbench-proof-"));
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = createServer((request, response) => {
  const path = resolve(directory, `.${decodeURIComponent(new URL(request.url, "http://localhost").pathname)}`);
  if (!path.startsWith(`${directory}${sep}`) || !existsSync(path) || !statSync(path).isFile()) {
    response.writeHead(404).end(); return;
  }
  response.writeHead(200, { "Content-Type": mime[extname(path)] ?? "application/octet-stream" });
  createReadStream(path).pipe(response);
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
let browser;
const checks = [];
try {
  browser = await chromium.launch({ headless: true, ...(process.env.VAULTIX_BROWSER_CHANNEL ? { channel: process.env.VAULTIX_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const open = async story => {
    await page.goto(`${origin}/iframe.html?id=pages-organization-projectproductcard--${story}&viewMode=story`);
    await expect(page.getByRole("article")).toBeVisible();
  };
  const audit = async label => {
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    writeFileSync(resolve(evidence, `${label}-axe.json`), JSON.stringify(result, null, 2));
    assert.deepEqual(result.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })), [], label);
    checks.push(label);
  };
  await open("no-stats");
  await audit("card");
  const help = page.getByRole("button", { name: "Show Me How: Secrets Management" });
  await help.focus();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toBeHidden();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Secrets Management: Getting Started" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("listitem")).toHaveCount(3);
  await audit("help-dialog");
  await page.screenshot({ path: resolve(evidence, "contextual-help.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(help).toBeFocused();
  checks.push("keyboard-tooltip-dialog-focus-return");
  await open("disabled");
  await expect(page.getByRole("button", { name: "Open Secrets Management" })).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("button", { name: "Show Me How: Secrets Management" }).click();
  await expect(page.getByRole("dialog")).toContainText("You do not have access");
  checks.push("denied-action-retains-help");
  await page.setViewportSize({ width: 320, height: 720 });
  await open("narrow-layout");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Card must reflow at 320 CSS px");
  await page.getByRole("button", { name: "Show Me How: Privileged Access Manager" }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Dialog must reflow at 320 CSS px");
  await audit("narrow-help");
  await page.screenshot({ path: resolve(evidence, "narrow-help.png") });
  assert.equal(await page.getByRole("dialog").evaluate(element => getComputedStyle(element).animationName), "none");
  assert.deepEqual(errors, [], "No browser runtime errors");
  checks.push("reflow-reduced-motion");
  writeFileSync(resolve(evidence, "result.json"), JSON.stringify({ passed: true, checks, scope: "isolated real product components; no live tenant or whole-UI claim" }, null, 2));
  console.log(JSON.stringify({ passed: true, evidence, checks }));
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
