import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPlanServer } from "./serve-capability-plan.mjs";
import { capabilities } from "../docs/capabilities/catalog.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "core/e2e/package.json"));
const { chromium, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache/capability-plan-"));
const server = createPlanServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const audits = [],
  requests = [],
  errors = [];
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.VAULTIX_BROWSER_CHANNEL
      ? { channel: process.env.VAULTIX_BROWSER_CHANNEL }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    requests.push({
      method: route.request().method(),
      origin: new URL(route.request().url()).origin,
    });
    return new URL(route.request().url()).origin === origin ? route.continue() : route.abort();
  });
  async function audit(state) {
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    audits.push({ state, violations: result.violations, manualReview: result.incomplete });
    writeFileSync(resolve(evidence, "accessibility.json"), JSON.stringify(audits, null, 2));
    assert.deepEqual(
      result.violations.map((item) => ({
        id: item.id,
        nodes: item.nodes.map((node) => node.target),
      })),
      [],
    );
  }
  await page.goto(origin);
  await expect(page.locator("#result-count")).toHaveText(
    `${capabilities.length} of ${capabilities.length} requirements`,
  );
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to capabilities" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#results")).toBeFocused();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(evidence, "overview-desktop.png") });
  await audit("overview-desktop");
  await page.getByLabel("Find a capability", { exact: true }).fill("Nomen sign-in");
  await expect(page.locator("#cards article")).toHaveCount(1);
  const detail = page.getByRole("button", {
    name: "Review acceptance: Nomen sign-in & session ownership",
    exact: true,
  });
  await detail.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Not accepted end to end");
  await audit("capability-dialog");
  await page.keyboard.press("Escape");
  await expect(detail).toBeFocused();
  await page.getByLabel("Delivery phase").selectOption("P4");
  await expect(page.locator("#empty")).toBeVisible();
  await page.getByRole("button", { name: "Reset filters" }).click();
  await page.getByLabel("Implementation state").selectOption("Known semantic gap");
  await expect(page.locator("#cards article")).toHaveCount(
    capabilities.filter((item) => item.implementation === "Known semantic gap").length,
  );
  await page.getByRole("button", { name: "Reset filters" }).click();
  await page.getByRole("button", { name: "Clyffy & AI workspace 10", exact: true }).click();
  await expect(page.locator("#cards article")).toHaveCount(10);
  await page.screenshot({ path: resolve(evidence, "ai-scope.png"), fullPage: true });
  await page.getByRole("button", { name: "Delivery path", exact: true }).click();
  await expect(page.locator(".stage")).toHaveCount(5);
  await audit("delivery-path");
  await page.getByRole("button", { name: "Provider inventory", exact: true }).click();
  await page.getByLabel("Find an adapter").fill("aws-elasticache");
  await expect(page.locator("#providers article")).toHaveCount(1);
  await audit("provider-filter");
  await page.getByRole("button", { name: "Capabilities", exact: true }).click();
  await page.getByRole("button", { name: "Reset filters" }).click();
  await page.setViewportSize({ width: 320, height: 800 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await audit("overview-320px");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(evidence, "overview-mobile.png") });
  await page.getByLabel("Find a capability", { exact: true }).fill("Nomen sign-in");
  await detail.click();
  assert.equal(
    await page.getByRole("dialog").evaluate((node) => node.scrollWidth <= node.clientWidth),
    true,
  );
  await audit("dialog-320px");
  assert.deepEqual(errors, []);
  assert.ok(requests.every((request) => request.method === "GET" && request.origin === origin));
  writeFileSync(
    resolve(evidence, "result.json"),
    JSON.stringify(
      {
        status: "passed",
        scope:
          "Read-only planning explorer, not product capability acceptance or manual assistive-technology certification",
        checks: [
          "search",
          "group and state filters",
          "combined empty state",
          "reset",
          "keyboard dialog and focus return",
          "dependency phases",
          "dynamic provider discovery",
          "320px reflow",
          "automated accessibility",
          "same-origin read-only requests",
        ],
        audits: audits.length,
      },
      null,
      2,
    ),
  );
  console.log(`Capability explorer evidence: ${evidence}`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
