// Explicit component fixtures, separate from real-image application evidence.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(resolve("core/e2e/package.json"));
const { chromium, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const origin = process.env.VAULTIX_UI_ORIGIN || "http://127.0.0.1:3000";
assert.ok(
  ["127.0.0.1", "localhost"].includes(new URL(origin).hostname),
  "Use a local Vite fixture server",
);
const evidence = resolve(process.argv[2] || ".cache/notification-ui");
mkdirSync(evidence, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.VAULTIX_BROWSER_CHANNEL
    ? { channel: process.env.VAULTIX_BROWSER_CHANNEL }
    : {}),
});
const context = await browser.newContext({
  viewport: {
    width: Number(process.env.VAULTIX_FIXTURE_WIDTH || 390),
    height: Number(process.env.VAULTIX_FIXTURE_HEIGHT || 500),
  },
  reducedMotion: "reduce",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route(`${origin}/api/**`, (route) => route.abort());
await page.addInitScript(() =>
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: async (value) => {
        window.fixtureCopied = value;
      },
    },
  }),
);
await page.route(
  (url) => url.origin === origin && url.pathname === "/__notification-fixture",
  (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><head><title>Vaultix notification fixture</title></head><body class="dark bg-bunker-800"><div id="root"></div>
  <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>(type)=>type; window.__vite_plugin_react_preamble_installed__=true;</script>
  <script type="module" src="/tests/notification-fixture.tsx"></script></body></html>`,
    }),
);
try {
  await page.goto(
    `${origin}/__notification-fixture?variant=${process.env.VAULTIX_MODAL_VARIANT || "dialog"}`,
  );
  await page.getByRole("button", { name: "Open Form", exact: true }).click();
  const dialog = page.getByRole(
    process.env.VAULTIX_MODAL_VARIANT === "alert" ? "alertdialog" : "dialog",
    { name: /^Edit Environment/ },
  );
  const save = dialog.getByRole("button", { name: "Save", exact: true });
  await save.click();
  const modalBounds = await dialog.evaluate((element) => {
    // Legacy Modal's focus scope wraps its positioned Card.
    const surface =
      element.getAttribute("data-state") &&
      !element.getAttribute("data-slot") &&
      getComputedStyle(element).position === "static"
        ? element.firstElementChild
        : element;
    const rect = surface.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewport: innerWidth };
  });
  writeFileSync(
    resolve(evidence, "bounds.json"),
    JSON.stringify(modalBounds, null, 2),
  );
  assert.ok(
    modalBounds.left >= -1 && modalBounds.right <= modalBounds.viewport + 1,
    "Modal must fit viewport width",
  );
  const toast = page.locator("[data-sonner-toast]");
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("data-mounted", "true");
  const result = await save.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
    const notification = document.querySelector("[data-sonner-toast]");
    return {
      saveUncovered: button.contains(hit),
      notificationInsideDialog: Boolean(
        notification?.closest('[role="dialog"], [role="alertdialog"]'),
      ),
    };
  });
  const focus = [];
  for (let index = 0; index < 30; index++) {
    await page.keyboard.press("Tab");
    focus.push(
      await page.evaluate(
        () =>
          document.activeElement?.getAttribute("aria-label") ||
          document.activeElement?.textContent,
      ),
    );
  }
  result.copyReachable = focus.includes("Copy Request ID");
  result.errors = errors;
  await page.screenshot({ path: resolve(evidence, "modal-notification.png") });
  writeFileSync(
    resolve(evidence, "result.json"),
    JSON.stringify(result, null, 2),
  );
  assert.deepEqual(result, {
    saveUncovered: true,
    notificationInsideDialog: true,
    copyReachable: true,
    errors: [],
  });
  await toast
    .getByRole("button", { name: "Copy Request ID", exact: true })
    .click();
  await expect(
    toast.getByRole("button", { name: "Copied", exact: true }),
  ).toBeVisible();
  assert.equal(
    await page.evaluate(() => window.fixtureCopied),
    "fixture-request",
  );
  const copySize = await toast
    .getByRole("button", { name: "Copied", exact: true })
    .boundingBox();
  assert.ok(
    copySize.width >= 24 && copySize.height >= 24,
    "Copy target must be at least 24 CSS pixels",
  );
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new Error("Fixture denial");
    };
  });
  await toast.getByRole("button", { name: "Copied", exact: true }).click();
  await expect(
    toast.getByRole("button", { name: "Copy failed. Try again.", exact: true }),
  ).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .include('[role="dialog"], [role="alertdialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  writeFileSync(
    resolve(evidence, "accessibility.json"),
    JSON.stringify(
      {
        engine: accessibility.testEngine,
        violations: accessibility.violations,
        manualReview: accessibility.incomplete,
      },
      null,
      2,
    ),
  );
  assert.equal(
    accessibility.violations.length,
    0,
    "Notification modal accessibility violations",
  );
  await dialog
    .getByRole("button", { name: "Dismiss All", exact: true })
    .click();
  await expect(toast).toHaveCount(0);
  const validation = dialog.getByRole("button", {
    name: "Validation Failure",
    exact: true,
  });
  await validation.click();
  const details = page.getByRole("dialog", {
    name: "Validation Error Details",
    exact: true,
  });
  await expect(details).toBeVisible();
  await expect(
    details.getByText("name is required", { exact: true }),
  ).toBeVisible();
  await expect(details.locator("[data-sonner-toast]")).toHaveCount(1);
  // Closing a toast must not close its independently owned error details.
  await details.locator("[data-close-button]").click();
  await expect(toast).toHaveCount(0);
  await expect(details).toBeVisible();
  await details.getByRole("button", { name: "Close", exact: true }).click();
  await expect(validation).toBeFocused();
  const permission = dialog.getByRole("button", {
    name: "Permission Failure",
    exact: true,
  });
  await permission.click();
  await dialog.getByRole("button", { name: "Show More", exact: true }).click();
  const rules = page.getByRole("dialog", {
    name: "Validation Rules",
    exact: true,
  });
  await expect(rules.getByText("development", { exact: true })).toBeVisible();
  // Escape belongs to the focused detail dialog. A hovered copy tooltip may
  // otherwise consume the first Escape, which is its normal dismissal behavior.
  await page.mouse.move(0, 0);
  await rules.getByRole("button", { name: "Close", exact: true }).focus();
  await expect(
    rules.getByRole("button", { name: "Close", exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(permission).toBeFocused();
  await expect(toast).toHaveCount(0);
  const queuedValidation = dialog.getByRole("button", {
    name: "Queued Validation",
    exact: true,
  });
  await queuedValidation.click();
  await expect(details).toBeVisible();
  await details.getByRole("button", { name: "Close", exact: true }).click();
  await expect(details).toBeVisible();
  await details.getByRole("button", { name: "Close", exact: true }).click();
  await expect(details).toHaveCount(0);
  await expect(queuedValidation).toBeFocused();
  await expect(toast).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Add Messages", exact: true })
    .click();
  await expect(toast).toHaveCount(6);
  assert.deepEqual(
    await toast
      .filter({ hasText: "Pending Operation" })
      .locator("svg")
      .evaluateAll((icons) =>
        icons.map((icon) => getComputedStyle(icon).animationName),
      ),
    ["none"],
  );
  await toast.first().evaluate((element) => {
    window.fixtureToastNode = element;
  });
  const queued = await toast.evaluateAll((items) =>
    items.map((item) => ({
      visible: getComputedStyle(item).opacity === "1",
      height: item.getBoundingClientRect().height,
      contentVisible:
        getComputedStyle(item.querySelector("[data-content]")).opacity === "1",
    })),
  );
  assert.ok(
    queued.every(
      (item) => item.visible && item.height > 0 && item.contentVisible,
    ),
  );
  await dialog
    .getByRole("button", { name: "Resolve Pending", exact: true })
    .click();
  await expect(toast.filter({ hasText: "Operation Complete" })).toHaveCount(1);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open Form", exact: true }),
  ).toBeFocused();
  await expect(
    page.locator("[data-notification-root] [data-sonner-toast]"),
  ).toHaveCount(6);
  await page.keyboard.press("Enter");
  await expect(dialog.locator("[data-sonner-toast]")).toHaveCount(6);
  assert.equal(
    await page.evaluate(
      () =>
        window.fixtureToastNode.isConnected &&
        Boolean(
          window.fixtureToastNode.closest(
            '[role="dialog"], [role="alertdialog"]',
          ),
        ),
    ),
    true,
  );
  await dialog
    .getByRole("button", { name: "Dismiss All", exact: true })
    .click();
  await expect(toast).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Handled Validation", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Handled Permission", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Malformed Message", exact: true })
    .click();
  await expect(toast).toHaveCount(1);
  await expect(toast).toContainText(
    "The request could not be completed. Please try again.",
  );
  await dialog
    .getByRole("button", { name: "Dismiss All", exact: true })
    .click();
  await expect(toast).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Timed Notice", exact: true })
    .click();
  await expect(toast).toHaveCount(1);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.keyboard.press("Enter");
  await page.mouse.move(0, 0);
  await expect(toast).toHaveCount(0, { timeout: 5000 });
  assert.deepEqual(errors, []);
  writeFileSync(
    resolve(evidence, "lifecycle.json"),
    JSON.stringify(
      {
        validationIndependent: true,
        permissionDetails: true,
        returnFocus: true,
        preservedMessages: 6,
        promiseUpdate: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log("Notification fixture passed");
} catch (error) {
  writeFileSync(
    resolve(evidence, "failure.json"),
    JSON.stringify(
      {
        message: error.message,
        state: await page.evaluate(() => ({
          active: document.activeElement?.outerHTML.slice(0, 300),
          modals: [
            ...document.querySelectorAll(
              '[role="dialog"], [role="alertdialog"]',
            ),
          ].map((element) => ({
            role: element.getAttribute("role"),
            hidden: element.getAttribute("aria-hidden"),
            state: element.getAttribute("data-state"),
            title: element.querySelector("h2")?.textContent,
          })),
          tooltips: document.querySelectorAll('[role="tooltip"]').length,
        })),
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: resolve(evidence, "failure.png") });
  throw error;
} finally {
  await browser.close();
}
