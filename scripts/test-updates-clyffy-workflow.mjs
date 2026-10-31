// Real packaged app and MCP reference workflow. Release availability/error states
// are explicitly browser fixtures; they do not prove a published stable release.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

export async function testUpdatesClyffyWorkflow({ page, expect, AxeBuilder, origin, orgId, projectId, token, evidence, expectedFailures }) {
  const checks = [], accessibility = [];
  const updatesPath = "/api/v1/vaultix/updates";
  const releases = "https://github.com/shippinAI/vaultix/releases";
  const record = (name, fixtures = false) => {
    checks.push({ name, fixtures });
    writeFileSync(resolve(evidence, "updates-clyffy-workflow.json"), JSON.stringify({ passed: false, checks, accessibility }, null, 2));
  };
  const audit = async state => {
    await page.evaluate(async () => Promise.all(document.getAnimations()
      .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {}))));
    const report = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    accessibility.push({ state, engine: report.testEngine, violations: report.violations.map(rule => ({ id: rule.id, nodes: rule.nodes.map(node => node.target) })), manualReview: report.incomplete.map(rule => rule.id) });
    record(`Accessibility scan: ${state}`);
    assert.equal(report.violations.length, 0, `Inspect updates-clyffy-workflow.json for ${state}`);
  };
  const fits = async locator => {
    const box = await locator.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 320.5, "Dialog must fit a 320px viewport");
    assert.equal(await locator.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, "Dialog content must reflow without horizontal overflow");
  };
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const actual = await fetch(`${origin}${updatesPath}`, { headers });
  assert.equal(actual.status, 200);
  const actualStatus = await actual.json();
  assert.equal(actualStatus.schemaVersion, "vaultix.updates.v1");
  if (actualStatus.currentVersion.startsWith("dev-")) {
    assert.equal(actualStatus.state, "development", "Untagged image must be identified as development");
    assert.match(actualStatus.currentVersion, /^dev-[a-f0-9]{12}$/);
  } else assert.match(actualStatus.currentVersion, /^v?\d+\.\d+\.\d+/);
  const anonymous = await fetch(`${origin}${updatesPath}`);
  assert.equal(anonymous.status, 401);
  const refreshed = await fetch(`${origin}${updatesPath}/check`, { method: "POST", headers, body: "{}" });
  assert.equal(refreshed.status, 200);
  assert.equal((await refreshed.json()).currentVersion, actualStatus.currentVersion);
  record("Actual image: authenticated build status and non-installing check; anonymous request denied");

  const overview = `${origin}/organizations/${orgId}/projects/secret-management/${projectId}/overview`;
  await page.goto(overview);
  const trigger = page.getByRole("button", { name: "Vaultix Version and Updates", exact: true });
  await trigger.focus();
  await expect(page.getByRole("tooltip")).toContainText("View this build");
  await trigger.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Vaultix Updates", exact: true });
  if (actualStatus.state === "development") await expect(dialog.getByRole("status")).toContainText("development build");
  await expect(dialog.getByText(actualStatus.currentVersion, { exact: true })).toBeVisible();
  await audit("actual-update-dialog");
  await page.screenshot({ path: resolve(evidence, "vaultix-updates-desktop.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  record("Actual update tooltip, Enter activation, named dialog and Escape focus restoration");

  let fixture = { schemaVersion: "vaultix.updates.v1", channel: "stable", state: "available", currentVersion: "1.0.0", latestVersion: "1.1.0", checkedAt: "2026-10-31T12:00:00.000Z", releaseUrl: `${releases}/tag/v1.1.0` };
  let failCheck = false, checksPosted = 0;
  const statusRoute = async route => route.fulfill({ json: fixture });
  const checkRoute = async route => {
    assert.equal(route.request().method(), "POST");
    assert.deepEqual(route.request().postDataJSON(), {});
    checksPosted++;
    await route.fulfill(failCheck ? { status: 503, json: { error: "Release service unavailable in browser fixture." } } : { json: fixture });
  };
  await page.route(`${origin}${updatesPath}`, statusRoute);
  await page.route(`${origin}${updatesPath}/check`, checkRoute);
  expectedFailures.add(`${updatesPath}/check`);
  try {
    await page.reload();
    await page.getByRole("button", { name: "Vaultix Update Available", exact: true }).click();
    await expect(dialog.getByRole("link", { name: "Release Notes" })).toHaveAttribute("href", `${releases}/tag/v1.1.0`);
    failCheck = true;
    await dialog.getByRole("button", { name: "Check for Updates", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("could not be refreshed");
    failCheck = false;
    fixture = { ...fixture, state: "current", currentVersion: "1.1.0" };
    await dialog.getByRole("button", { name: "Check for Updates", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("at or ahead");
    assert.equal(checksPosted, 2);
    record("Available release link; failed explicit check retains dialog; retry recovers to current", true);
    await page.setViewportSize({ width: 320, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await fits(dialog);
    await audit("update-dialog-320px-reduced-motion");
    await page.screenshot({ path: resolve(evidence, "vaultix-updates-mobile.png"), fullPage: true });
    await page.keyboard.press("Escape");
    fixture = { ...fixture, state: "available", releaseUrl: "https://untrusted.invalid/update" };
    await page.reload();
    await trigger.click();
    await expect(dialog.getByRole("status")).toContainText("could not be refreshed");
    await expect(dialog.getByRole("link", { name: "Release Notes" })).toHaveAttribute("href", releases);
    fixture = { ...fixture, state: "unavailable", latestVersion: null, releaseUrl: releases };
    await dialog.getByRole("button", { name: "Check for Updates", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("could not be reached");
    record("Untrusted release destination rejected; metadata retry recovers without claiming up-to-date", true);
    await page.keyboard.press("Escape");
  } finally {
    await page.unroute(`${origin}${updatesPath}`, statusRoute);
    await page.unroute(`${origin}${updatesPath}/check`, checkRoute);
    expectedFailures.delete(`${updatesPath}/check`);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
  }

  const canary = randomBytes(32).toString("hex");
  const created = await fetch(`${origin}/api/v4/secrets/MCP_UI_REFERENCE`, {
    method: "POST", headers,
    body: JSON.stringify({ projectId, environment: "dev", secretPath: "/", secretValue: canary, type: "shared" })
  });
  assert.equal(created.status, 200, "Create a disposable secret for reference-only proof");
  await created.body?.cancel();
  await page.reload();
  const clyffy = page.getByRole("button", { name: "Open Clyffy", exact: true });
  await clyffy.focus();
  await expect(page.getByRole("tooltip")).toContainText("guided MCP actions");
  await clyffy.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Clyffy Workspace", exact: true });
  await expect(sheet.getByRole("heading", { name: "Secret References", exact: true })).toBeVisible();
  const guideTrigger = sheet.getByRole("button", { name: "Guide Me", exact: true });
  await guideTrigger.click();
  const lesson = page.getByRole("dialog", { name: "Find the Right Secret Reference", exact: true });
  await expect(lesson).toBeVisible();
  await audit("clyffy-nested-guidance");
  await page.screenshot({ path: resolve(evidence, "clyffy-guided-dialog.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(lesson).toHaveCount(0);
  await expect(guideTrigger).toBeFocused();
  await expect(sheet).toBeVisible();
  record("Actual Clyffy tooltip, nested lesson dialog and keyboard focus restoration");
  await sheet.getByRole("combobox", { name: "App", exact: true }).click();
  await page.getByRole("option", { name: "Vaultix Lifecycle Proof", exact: true }).click();
  await sheet.getByRole("combobox", { name: "Environment", exact: true }).click();
  await page.getByRole("option", { name: "Development", exact: true }).click();
  const isReferences = response => new URL(response.url()).pathname === "/api/v1/vaultix/mcp" && response.request().postDataJSON()?.params?.name === "vaultix.secrets.references";
  const responsePromise = page.waitForResponse(isReferences);
  await sheet.getByRole("button", { name: "Show References", exact: true }).click();
  const referenceResponse = await responsePromise;
  assert.equal(referenceResponse.status(), 200);
  assert.equal((await referenceResponse.text()).includes(canary), false, "MCP response must not contain the secret value");
  await expect(sheet.getByText("MCP_UI_REFERENCE", { exact: true })).toBeVisible();
  assert.equal((await sheet.innerText()).includes(canary), false, "Clyffy must show references only");
  await audit("actual-clyffy-reference-results");
  await page.screenshot({ path: resolve(evidence, "clyffy-references-desktop.png"), fullPage: true });
  record("Actual project/environment MCP selection and persisted secret reference; response and DOM exclude canary value");
  await sheet.getByRole("textbox", { name: "Folder", exact: true }).fill("/missing-ui-proof");
  await sheet.getByRole("button", { name: "Show References", exact: true }).click();
  await expect(sheet.getByRole("alert")).toContainText("folder is unavailable");
  await expect(sheet.getByText("MCP_UI_REFERENCE", { exact: true })).toHaveCount(0);
  await sheet.getByRole("textbox", { name: "Folder", exact: true }).fill("/");
  await sheet.getByRole("button", { name: "Show References", exact: true }).click();
  await expect(sheet.getByText("MCP_UI_REFERENCE", { exact: true })).toBeVisible();
  record("Actual missing-folder denial hides stale references; corrected scope recovers");
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fits(sheet);
  await audit("clyffy-320px-reduced-motion");
  await page.screenshot({ path: resolve(evidence, "clyffy-references-mobile.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(clyffy).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  record("Actual Clyffy narrow layout, reduced motion and launcher focus restored");
  writeFileSync(resolve(evidence, "updates-clyffy-workflow.json"), JSON.stringify({ passed: true, checks, accessibility,
    exclusions: ["published stable assets", "embedded MCP Apps host", "screen-reader acceptance", "whole-product accessibility"] }, null, 2));
}
