import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

export async function testOrgMfaWorkflow({ page, expect, AxeBuilder, origin, orgId, evidence, expectedFailures }) {
  const path = `/api/v1/organization/${orgId}`;
  const settings = `${origin}/organizations/${orgId}/settings?selectedTab=tab-org-security`;
  const report = { passed: false, real: [], fixtures: [], accessibility: [], writes: [] };
  const save = () => writeFileSync(resolve(evidence, "org-mfa-workflow.json"), JSON.stringify(report, null, 2));
  const match = url => url.origin === origin && url.pathname === path;
  const observe = request => {
    if (new URL(request.url()).pathname === path && request.method() === "PATCH") {
      const body = request.postDataJSON();
      assert.ok(Object.keys(body).every(key => ["enforceMfa", "selectedMfaMethod"].includes(key)));
      report.writes.push(body); save();
    }
  };
  const toggle = page.getByRole("switch", { name: "Require MFA for Members", exact: true });
  const method = page.getByRole("combobox", { name: "MFA Method", exact: true });
  const review = page.getByRole("button", { name: "Review MFA Change", exact: true });
  const dialog = page.getByRole("dialog", { name: "Review MFA Change", exact: true });
  const choose = async label => { await method.click(); await page.getByRole("option", { name: label, exact: true }).click(); };
  const clearNotifications = async () => {
    for (const button of await page.locator('[data-sonner-toast] [data-close-button]').all()) {
      if (await button.isVisible()) await button.click();
    }
  };
  const scan = async state => {
    await page.evaluate(async () => Promise.all(document.getAnimations()
      .filter(item => item.effect?.getTiming().iterations !== Infinity).map(item => item.finished.catch(() => {}))));
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    report.accessibility.push({ state, engine: result.testEngine, violations: result.violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) })), manualReview: result.incomplete.map(item => item.id) }); save();
    assert.equal(result.violations.length, 0, `MFA accessibility failure: ${state}`);
  };
  page.on("request", observe);
  expectedFailures.add(path);
  let release;
  try {
    await page.goto(settings);
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(method).toHaveText("Email");
    await expect(review).toBeDisabled();
    await expect(page.getByText(/paid|upgrade.*plan/i)).toHaveCount(0);
    await scan("saved-security-settings");
    const help = page.getByRole("button", { name: "About MFA enforcement" });
    await help.focus();
    await expect(page.locator('[data-slot="tooltip-content"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0);
    await help.hover();
    await page.locator('[data-slot="tooltip-content"]').hover();
    await expect(page.locator('[data-slot="tooltip-content"]')).toBeVisible();
    await help.click();
    await expect(page.locator("#org-mfa-explanation")).toBeFocused();
    await choose("Mobile Authenticator");
    assert.equal(report.writes.length, 0);
    await review.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("MFA optional · Email", { exact: true })).toBeVisible();
    await expect(dialog.getByText("MFA optional · Mobile Authenticator", { exact: true })).toBeVisible();
    await scan("review-dialog");
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
    }
    await page.keyboard.press("Escape");
    await expect(review).toBeFocused();
    await expect(method).toHaveText("Mobile Authenticator");
    assert.equal(report.writes.length, 0);
    report.real.push("Draft edits and cancelled review issue no writes; keyboard and hover help, dialog focus containment and return work"); save();

    await review.click();
    const response = page.waitForResponse(item => new URL(item.url()).pathname === path && item.request().method() === "PATCH");
    await dialog.getByRole("button", { name: "Apply MFA Change" }).click();
    assert.equal((await response).status(), 200);
    assert.deepEqual(report.writes, [{ selectedMfaMethod: "totp" }]);
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(/^MFA settings updated for /)).toBeVisible();
    await page.reload();
    await expect(method).toHaveText("Mobile Authenticator");
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    report.real.push("Method-only update persists on real service/reload without altering MFA enforcement"); save();

    await clearNotifications();
    await toggle.click();
    await review.click();
    const smtp = page.waitForResponse(item => new URL(item.url()).pathname === path && item.request().method() === "PATCH");
    await dialog.getByRole("button", { name: "Apply MFA Change" }).click();
    assert.equal((await smtp).status(), 400);
    await expect(dialog.getByRole("alert")).toContainText("Your draft is preserved");
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(1);
    await expect(dialog.getByText("MFA required · Mobile Authenticator", { exact: true })).toBeVisible();
    await scan("real-smtp-denial");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Reset Draft" }).click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    report.real.push("Real missing-SMTP enforcement rejection retains draft and emits one error; explicit reset restores saved policy"); save();

    await clearNotifications();
    await choose("Email");
    await page.route(match, route => route.request().method() === "PATCH"
      ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "ServiceUnavailable", message: "MFA fixture unavailable" }) })
      : route.continue());
    await review.click();
    await dialog.getByRole("button", { name: "Apply MFA Change" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Your draft is preserved");
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(1);
    await page.unroute(match);
    await clearNotifications();
    const gate = new Promise(resolveGate => { release = resolveGate; });
    await page.route(match, async route => {
      if (route.request().method() === "PATCH") await gate;
      await route.continue();
    });
    const before = report.writes.length;
    await dialog.getByRole("button", { name: "Apply MFA Change" }).click();
    await expect(dialog.getByRole("button", { name: "Apply MFA Change" })).toBeDisabled();
    await expect(dialog.getByRole("status")).toContainText("does not cancel");
    await page.keyboard.press("Escape");
    await expect(method).toBeDisabled();
    await expect(toggle).toBeDisabled();
    assert.equal(report.writes.length, before + 1);
    release();
    await expect(page.getByText(/^MFA settings updated for /)).toBeVisible();
    await page.unroute(match);
    await page.reload();
    await expect(method).toHaveText("Email");
    report.fixtures.push("Injected 503 retains draft with one error; retry uses real service, pending controls prevent duplicates, closing does not cancel, persisted result restored"); save();

    await page.setViewportSize({ width: 320, height: 700 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await choose("Mobile Authenticator");
    await review.click();
    await scan("narrow-reduced-motion-review");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await expect(dialog.getByRole("button", { name: "Apply MFA Change" })).toBeInViewport();
    await page.screenshot({ path: resolve(evidence, "org-mfa-review-mobile.png"), fullPage: true });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Reset Draft" }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.screenshot({ path: resolve(evidence, "org-mfa-security.png"), fullPage: true });

    const permissions = url => url.origin === origin && url.pathname === "/api/v1/organization/permissions";
    await page.route(permissions, async route => {
      const result = await route.fetch(); const body = await result.json();
      await route.fulfill({ response: result, json: { ...body, permissions: [["read", "sso"], ["read", "settings"]] } });
    });
    try {
      await page.reload();
      await expect(toggle).toBeDisabled();
      await expect(method).toBeDisabled();
      await expect(review).toBeDisabled();
      await expect(page.getByText("You need permission to edit organization settings to change MFA.")).toBeVisible();
      await scan("read-only-permission-fixture");
      report.fixtures.push("Read-only permission fixture disables enforcement, method and review consistently"); save();
    } finally { await page.unroute(permissions); }
    const denied = await fetch(origin + path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selectedMfaMethod: "totp" }) });
    assert.equal(denied.status, 401);
    assert.equal(typeof (await denied.json()).error, "string");
    report.real.push("Anonymous organization update denied by real API with a plain error");
    assert.deepEqual(report.writes, [
      { selectedMfaMethod: "totp" }, { enforceMfa: true },
      { selectedMfaMethod: "email" }, { selectedMfaMethod: "email" }
    ]);
    report.passed = true; save();
  } finally {
    release?.(); await page.unroute(match); page.off("request", observe); expectedFailures.delete(path);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    save();
  }
}
