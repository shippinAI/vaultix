// Real environment lifecycle on the disposable image; faults are reported separately.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

export async function testEnvironmentWorkflow({ page, expect, AxeBuilder, origin, orgId, projectId, evidence, expectedFailures }) {
  const base = `/api/v1/projects/${projectId}/environments`;
  const settings = `${origin}/organizations/${orgId}/projects/secret-management/${projectId}/settings?selectedTab=tab-secret-environments`;
  const section = page.getByRole("region", { name: "Environments", exact: true });
  const create = section.getByRole("button", { name: "Create Environment", exact: true });
  const viewport = page.viewportSize();
  const real = [];
  const fixtures = [];
  const accessibility = [];
  const audit = async (state, selector) => {
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations()
        .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {})));
    });
    const report = await new AxeBuilder({ page }).include(selector)
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const summarize = rules => rules.map(rule => ({ id: rule.id, impact: rule.impact,
      nodes: rule.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }));
    accessibility.push({ state, scope: selector, engine: report.testEngine,
      violations: summarize(report.violations), manualReview: summarize(report.incomplete) });
    writeFileSync(resolve(evidence, "environment-accessibility.json"), JSON.stringify(accessibility, null, 2));
    assert.equal(report.violations.length, 0, `Environment accessibility: ${state}`);
  };
  const request = async (method, path, action, status = 200) => {
    const [result] = await Promise.all([
      page.waitForResponse(item => new URL(item.url()).pathname === path && item.request().method() === method, { timeout: 30000 }),
      action()
    ]);
    assert.equal(result.status(), status, `${method} environment operation failed`);
    return result.json();
  };
  const openCreate = async () => {
    await create.click();
    const dialog = page.getByRole("dialog", { name: "Create a new environment", exact: true });
    await expect(dialog).toBeVisible();
    return dialog;
  };
  const menu = async (name, action) => {
    await section.getByRole("button", { name: `Options for ${name}`, exact: true }).click();
    await page.getByRole("menuitem", { name: action, exact: true }).click();
  };
  const withFault = async (method, path, run) => {
    const match = url => url.origin === origin && url.pathname === path;
    const handler = route => route.request().method() === method
      ? route.fulfill({ status: 503, json: { error: "Unavailable", message: "Environment fixture outage." } })
      : route.continue();
    expectedFailures.add(path);
    await page.route(match, handler);
    try { await run(); } finally { await page.unroute(match, handler); expectedFailures.delete(path); }
  };
  try {
    await page.goto(settings);
    await expect(create).toBeVisible();
    await page.evaluate(() => {
      const trace = [];
      const describe = element => element instanceof Element ? {
        tag: element.tagName, id: element.id, role: element.getAttribute("role"), slot: element.getAttribute("data-slot")
      } : null;
      const record = event => {
        trace.push({ ...event, time: performance.now(), overlays: [...document.querySelectorAll('[role="menu"], [role="dialog"], [role="alertdialog"]')].map(element => ({ ...describe(element), state: element.getAttribute("data-state") })) });
        if (trace.length > 120) trace.shift();
      };
      const originalFocus = HTMLElement.prototype.focus;
      HTMLElement.prototype.focus = function focus(...args) {
        record({ type: "focus-call", target: describe(this), stack: new Error().stack?.split("\n").slice(1, 7) });
        return originalFocus.apply(this, args);
      };
      const listener = event => record({ type: event.type, target: describe(event.target) });
      for (const type of ["focusin", "focusout", "pointerdown", "click"]) document.addEventListener(type, listener, true);
      window.vaultixEnvironmentTrace = { trace, cleanup: () => {
        HTMLElement.prototype.focus = originalFocus;
        for (const type of ["focusin", "focusout", "pointerdown", "click"]) document.removeEventListener(type, listener, true);
      } };
    });
    await audit("environment list", "#environments");
    let dialog = await openCreate();
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog.getByLabel("Environment Name", { exact: true })).toBeFocused();
    await expect(dialog.getByText("Enter an environment name between 1 and 255 characters.")).toBeVisible();
    await audit("invalid create", '[role="dialog"]');
    await dialog.screenshot({ path: resolve(evidence, "environment-validation.png") });
    await dialog.getByLabel("Environment Name", { exact: true }).fill("Preview Deployments");
    await expect(dialog.getByLabel("Environment Slug", { exact: true })).toHaveValue("preview-deployments");
    await dialog.getByLabel("Environment Slug", { exact: true }).fill("preview-proof");
    await dialog.getByLabel("Environment Name", { exact: true }).fill("Preview Candidate");
    await expect(dialog.getByLabel("Environment Slug", { exact: true })).toHaveValue("preview-proof");
    const created = await request("POST", base, () => dialog.getByRole("button", { name: "Create", exact: true }).click());
    const id = created.environment.id;
    const path = `${base}/${id}`;
    const row = () => section.getByRole("row").filter({ hasText: "Preview Candidate" });
    await expect(row()).toBeVisible();
    await expect(create).toBeFocused();
    real.push("create with generated and manually overridden slug; form validation and focus return");

    dialog = await openCreate();
    await dialog.getByLabel("Environment Name", { exact: true }).fill("Duplicate");
    await dialog.getByLabel("Environment Slug", { exact: true }).fill("preview-proof");
    expectedFailures.add(base);
    try {
      await request("POST", base, () => dialog.getByRole("button", { name: "Create", exact: true }).click(), 400);
      await expect(dialog.getByText(/Your edits are kept/)).toBeVisible();
      await expect(dialog.getByLabel("Environment Slug", { exact: true })).toHaveValue("preview-proof");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    } finally { expectedFailures.delete(base); }
    real.push("duplicate slug rejected by real server with retained input");

    await menu("Preview Candidate", "Edit environment");
    dialog = page.getByRole("dialog", { name: "Update Environment", exact: true });
    await dialog.getByLabel("Environment Name", { exact: true }).fill("Preview Reviewed");
    await dialog.getByLabel("Environment Slug", { exact: true }).fill("preview-reviewed");
    await withFault("PATCH", path, async () => {
      await request("PATCH", path, () => dialog.getByRole("button", { name: "Update", exact: true }).click(), 503);
      await expect(dialog.getByText(/Your edits are kept/)).toBeVisible();
      await expect(dialog.getByLabel("Environment Name", { exact: true })).toHaveValue("Preview Reviewed");
    });
    await request("PATCH", path, () => dialog.getByRole("button", { name: "Update", exact: true }).click());
    await expect(dialog).toHaveCount(0);
    await expect(section.getByText("Preview Reviewed", { exact: true })).toBeVisible();
    await expect(section.getByRole("button", { name: "Options for Preview Reviewed", exact: true })).toBeFocused();
    real.push("rename updates name and slug");
    fixtures.push("edit outage retains values and retries against restored real endpoint");
    const before = await section.getByRole("row").allTextContents();
    await request("PATCH", path, () => section.getByRole("button", { name: "Move Preview Reviewed up", exact: true }).press("Enter"));
    await expect.poll(async () => (await section.getByRole("row").allTextContents()).findIndex(text => text.includes("Preview Reviewed")))
      .toBe(before.findIndex(text => text.includes("Preview Reviewed")) - 1);
    await expect(section.getByRole("button", { name: "Move Preview Reviewed up", exact: true })).toBeFocused();
    while ((await section.getByRole("row").allTextContents()).findIndex(text => text.includes("Preview Reviewed")) > 1) {
      const previous = (await section.getByRole("row").allTextContents()).findIndex(text => text.includes("Preview Reviewed"));
      await request("PATCH", path, () => section.getByRole("button", { name: "Move Preview Reviewed up", exact: true }).press("Enter"));
      await expect.poll(async () => (await section.getByRole("row").allTextContents()).findIndex(text => text.includes("Preview Reviewed"))).toBe(previous - 1);
    }
    await expect(section.getByRole("button", { name: "Options for Preview Reviewed", exact: true })).toBeFocused();
    real.push("keyboard reorder changes persisted order");

    for (const [method, suffix] of [["PATCH", ""], ["DELETE", ""], ["POST", "/restore"]]) {
      const denied = await fetch(`${origin}${path}${suffix}`, { method, headers: { "Content-Type": "application/json" }, ...(method === "PATCH" ? { body: JSON.stringify({ name: "Unauthorized" }) } : {}) });
      assert.equal(denied.status, 401, "Anonymous environment mutation must be denied");
    }
    real.push("anonymous edit, delete and restore denied by server");
    await menu("Preview Reviewed", "Delete environment");
    let confirmation = page.getByRole("alertdialog", { name: "Schedule deletion of Preview Reviewed?", exact: true });
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(section.getByRole("button", { name: "Options for Preview Reviewed", exact: true })).toBeFocused();
    // Rapid reopen must survive the previous dialog's delayed focus cleanup.
    await menu("Preview Reviewed", "Delete environment");
    real.push("cancel returns focus and immediate reopening retains the selected action");
    await withFault("DELETE", path, async () => {
      await request("DELETE", path, () => confirmation.getByRole("button", { name: "Schedule Deletion", exact: true }).click(), 503);
      await expect(confirmation.getByText("Deletion failed. Check the error notice and retry.")).toBeVisible();
    });
    await request("DELETE", path, () => confirmation.getByRole("button", { name: "Schedule Deletion", exact: true }).click());
    await expect(confirmation).toHaveCount(0);
    await expect(section.getByText("Pending deletion", { exact: true })).toBeVisible();
    await expect(section.locator("time")).toBeVisible();
    await audit("scheduled deletion", "#environments");
    await request("POST", `${path}/restore`, () => menu("Preview Reviewed", "Restore environment"));
    await expect(section.getByText("Pending deletion", { exact: true })).toHaveCount(0);
    await expect(section.getByRole("button", { name: "Options for Preview Reviewed", exact: true })).toBeFocused();
    real.push("schedule deletion and restore with visible actor/deadline metadata");
    fixtures.push("deletion outage preserves confirmation dialog and retry succeeds");

    await menu("Preview Reviewed", "Delete environment");
    await confirmation.getByRole("button", { name: "Delete Permanently", exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    confirmation = page.getByRole("alertdialog", { name: "Permanently delete Preview Reviewed?", exact: true });
    const typed = confirmation.getByLabel("Type preview-reviewed to confirm.", { exact: true });
    await typed.fill("wrong");
    await expect(confirmation.getByRole("button", { name: "Delete Permanently", exact: true })).toBeDisabled();
    await typed.fill("preview-reviewed");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => confirmation.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await audit("permanent confirmation narrow", '[role="alertdialog"]');
    await page.screenshot({ path: resolve(evidence, "environment-confirmation-narrow.png") });
    await withFault("DELETE", path, async () => {
      await request("DELETE", path, () => confirmation.getByRole("button", { name: "Delete Permanently", exact: true }).click(), 503);
      await expect(confirmation.getByText(/Your confirmation is kept/)).toBeVisible();
      await expect(typed).toHaveValue("preview-reviewed");
    });
    await request("DELETE", path, () => confirmation.getByRole("button", { name: "Delete Permanently", exact: true }).click());
    await expect(section.getByText("Preview Reviewed", { exact: true })).toHaveCount(0);
    await expect(create).toBeFocused();
    real.push("permanent delete requires exact slug; success removes environment");
    fixtures.push("permanent deletion outage retains typed confirmation");
    await page.setViewportSize(viewport);

    const longestName = "X".repeat(255);
    const longestSlug = "x".repeat(64);
    dialog = await openCreate();
    await dialog.getByLabel("Environment Name", { exact: true }).fill(longestName);
    await dialog.getByLabel("Environment Slug", { exact: true }).fill(longestSlug);
    await request("POST", base, () => dialog.getByRole("button", { name: "Create", exact: true }).click());
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await menu(longestName, "Delete environment");
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete Permanently", exact: true }).click();
    confirmation = page.getByRole("alertdialog", { name: `Permanently delete ${longestName}?`, exact: true });
    await page.setViewportSize({ width: 320, height: 844 });
    await expect.poll(() => confirmation.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(confirmation.getByLabel(`Type ${longestSlug} to confirm.`, { exact: true })).toBeVisible();
    await audit("maximum name and slug at 320 pixels", '[role="alertdialog"]');
    await confirmation.screenshot({ path: resolve(evidence, "environment-long-confirmation.png") });
    const longConfirmation = confirmation.getByLabel(`Type ${longestSlug} to confirm.`, { exact: true });
    await longConfirmation.focus();
    await expect(longConfirmation).toBeInViewport();
    await page.keyboard.press("Tab");
    await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport();
    await confirmation.screenshot({ path: resolve(evidence, "environment-long-confirmation-controls.png") });
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await page.setViewportSize(viewport);
    real.push("maximum-length environment name and slug fit a 320-pixel confirmation; cancellation preserves the environment");

    dialog = await openCreate();
    await dialog.getByLabel("Environment Name", { exact: true }).fill("Pending Proof");
    const match = url => url.origin === origin && url.pathname === base;
    let release;
    let count = 0;
    const pendingRoutes = [];
    const gate = new Promise(resolveGate => { release = resolveGate; });
    const handler = async route => {
      if (route.request().method() !== "POST") return route.continue();
      count += 1;
      const pending = gate.then(() => route.fulfill({ status: 503, json: { error: "Unavailable", message: "Environment fixture outage." } }));
      pendingRoutes.push(pending);
      return pending;
    };
    expectedFailures.add(base);
    await page.route(match, handler);
    try {
      await dialog.getByRole("button", { name: "Create", exact: true }).click();
      await expect(dialog.getByRole("button", { name: /^Create(?: Loading)?$/ })).toBeDisabled();
      await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
      await dialog.getByLabel("Environment Name", { exact: true }).press("Enter");
      await expect(dialog.getByRole("button", { name: /^Create(?: Loading)?$/ })).toBeDisabled();
      await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel("Environment Name", { exact: true })).toHaveAttribute("readonly", "");
      await expect.poll(() => count).toBe(1);
      release();
      await expect(dialog.getByText(/Your edits are kept/)).toBeVisible();
      await expect(dialog.getByLabel("Environment Name", { exact: true })).toHaveValue("Pending Proof");
      await audit("failed create retained", '[role="dialog"]');
    } finally {
      release();
      await Promise.allSettled(pendingRoutes);
      await page.unroute(match, handler);
      expectedFailures.delete(base);
    }
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    fixtures.push("pending create blocks dismissal and duplicate actions; failure preserves input");

    const permissionsPath = `/api/v1/projects/${projectId}/permissions`;
    const permissionMatch = url => url.origin === origin && url.pathname === permissionsPath;
    await page.route(permissionMatch, async route => {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      const body = await response.json();
      await route.fulfill({ response, json: { ...body, data: { ...body.data, permissions: [["read", "environments"]] } } });
    });
    try {
      await page.goto(settings);
      await expect(create).toBeDisabled();
      await expect(section.getByRole("button", { name: /^Move / }).first()).toBeDisabled();
      fixtures.push("read-only permission fixture disables create and reorder");
    } finally { await page.unroute(permissionMatch); }
    writeFileSync(resolve(evidence, "environment-lifecycle.json"), JSON.stringify({ passed: true, fixtures: false, checks: real }, null, 2));
    writeFileSync(resolve(evidence, "environment-recovery.json"), JSON.stringify({ passed: true, fixtures: true, checks: fixtures }, null, 2));
  } catch (error) {
    writeFileSync(resolve(evidence, "environment-focus.json"), JSON.stringify(await page.evaluate(() => window.vaultixEnvironmentTrace?.trace ?? []), null, 2));
    writeFileSync(resolve(evidence, "environment-failure.json"), JSON.stringify({
      passed: false, completedRealChecks: real, completedFixtureChecks: fixtures,
      state: await page.evaluate(() => ({
        pathname: location.pathname, bodyPointerEvents: getComputedStyle(document.body).pointerEvents,
        activeRole: document.activeElement?.getAttribute("role"),
        dialogs: document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length,
        menus: document.querySelectorAll('[role="menu"]').length
      }))
    }, null, 2));
    await page.screenshot({ path: resolve(evidence, "environment-failure.png") });
    throw error;
  } finally {
    await page.evaluate(() => window.vaultixEnvironmentTrace?.cleanup());
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "no-preference" });
  }
}
