import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

export async function testDashboardCreateWorkflow({ page, expect, AxeBuilder, origin, projectId, autoCapitalization, evidence, expectedFailures, readMetadata }) {
  const checks = [];
  const accessibility = [];
  assert.equal(typeof autoCapitalization, "boolean", "Use the actual project's configured key policy");
  const secretKey = autoCapitalization ? "PUBLIC_DASHBOARD_CREATION" : "public_dashboard_creation";
  const path = "/api/v1/pit/batch/commit";
  const record = name => {
    checks.push(name);
    writeFileSync(resolve(evidence, "dashboard-create-workflow.json"), JSON.stringify({
      scope: "Disposable packaged dashboard create/stage/review/commit; actual tag/secret writes with an explicit first-commit outage fixture",
      completedChecks: checks
    }, null, 2));
  };
  const audit = async state => {
    await page.evaluate(async () => Promise.all(document.getAnimations()
      .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {}))));
    const report = await new AxeBuilder({ page }).include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const summarize = rules => rules.map(rule => ({ id: rule.id, impact: rule.impact,
      nodes: rule.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }));
    accessibility.push({ state, engine: report.testEngine, violations: summarize(report.violations), manualReview: summarize(report.incomplete) });
    writeFileSync(resolve(evidence, "dashboard-create-accessibility.json"), JSON.stringify(accessibility, null, 2));
    assert.equal(report.violations.length, 0, `Dashboard create accessibility: ${state}`);
  };
  await page.getByRole("button", { name: "Add Secret", exact: true }).and(page.locator("button")).click();
  const dialog = page.getByRole("dialog", { name: /^Create Secret/ });
  const key = dialog.getByLabel("Key", { exact: true });
  const value = dialog.getByLabel("Value", { exact: true });
  const tags = dialog.getByLabel("Tags", { exact: true });
  const semantics = { keyLabel: await key.count(), valueLabel: await value.count(), tagsLabel: await tags.count() };
  writeFileSync(resolve(evidence, "dashboard-create-semantics.json"), JSON.stringify(semantics, null, 2));
  assert.deepEqual(semantics, { keyLabel: 1, valueLabel: 1, tagsLabel: 1 });
  await dialog.getByRole("button", { name: "Create Secret", exact: true }).click();
  await expect(key).toBeFocused();
  await expect(key).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByText("Secret key is required", { exact: true })).toBeVisible();
  await key.fill("   ");
  await dialog.getByRole("button", { name: "Create Secret", exact: true }).click();
  await expect(key).toBeFocused();
  await expect(key).toHaveAttribute("aria-invalid", "true");
  record("Visible associated labels and required/whitespace key validation restore focus");
  await key.fill(`  ${secretKey.toLowerCase()}  `);
  await expect(key).toHaveValue(`  ${secretKey}  `);
  await dialog.getByRole("button", { name: "Secret reference help", exact: true }).focus();
  await expect(page.getByRole("tooltip")).toContainText("Reference another secret");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Generate secret value", exact: true }).click();
  const generator = page.locator('[data-slot="popover-content"]').filter({ hasText: "Generate Random Value" });
  await expect.poll(() => generator.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(generator).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await value.focus();
  await expect(value).toHaveValue("");
  await tags.fill("PUBLIC-DASHBOARD-TAG");
  await expect(page.getByRole("option", { name: 'Create "PUBLIC-DASHBOARD-TAG"', exact: true })).toBeVisible();
  await tags.press("Escape");
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(dialog).toBeVisible();
  record("Generator and tag-menu Escape preserve the sheet and empty value");
  await tags.fill("PUBLIC-DASHBOARD-TAG");
  const tagResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/projects/${projectId}/tags` && response.request().method() === "POST");
  await page.getByRole("option", { name: 'Create "PUBLIC-DASHBOARD-TAG"', exact: true }).click();
  const createdTag = await tagResponse;
  assert.equal(createdTag.status(), 200);
  const tag = (await createdTag.json()).tag;
  assert.equal(tag.slug, "public-dashboard-tag");
  await tags.fill("public-dashboard-tag");
  await page.getByRole("option", { name: "public-dashboard-tag", exact: true }).click();
  await key.focus();
  await audit("desktop-tag-selected");
  record("Configured key casing, keyboard reference help and actual normalized tag creation/selection");
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await audit("mobile-tag-selected");
  const box = await dialog.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 320);
  await page.screenshot({ path: resolve(evidence, "dashboard-create-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "no-preference" });

  let fail = true;
  const attempts = [];
  const match = url => url.origin === origin && url.pathname === path;
  const handler = async route => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON();
    const created = body.changes?.secrets?.create?.find(secret => secret.secretKey === secretKey);
    attempts.push({ emptyValue: created?.secretValue === "", tagRetained: created?.tagIds?.includes(tag.id) === true, environment: body.environment });
    if (fail) return route.fulfill({ status: 503, json: { error: "Unavailable", message: "Disposable dashboard creation outage." } });
    return route.continue();
  };
  expectedFailures.add(path);
  await page.route(match, handler);
  try {
    await dialog.getByRole("button", { name: "Create Secret", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    assert.equal(attempts.length, 0, "Creating in batch mode only stages the pending change");
    await page.getByRole("button", { name: "Review", exact: true }).click();
    const review = page.getByRole("dialog", { name: /^Review Changes/ });
    await expect(review).toBeVisible();
    await review.getByLabel("Commit Message", { exact: true }).fill("Public dashboard creation proof");
    const failedResponse = page.waitForResponse(item => new URL(item.url()).pathname === path && item.request().method() === "POST" && item.status() === 503);
    await review.getByRole("button", { name: "Save Changes", exact: true }).click();
    await failedResponse;
    await expect(review.getByRole("button", { name: "Save Changes", exact: true })).toBeEnabled();
    await expect(review.getByLabel("Commit Message", { exact: true })).toHaveValue("Public dashboard creation proof");
    await expect(review.getByText(secretKey, { exact: true }).first()).toBeVisible();
    fail = false;
    const response = page.waitForResponse(item => new URL(item.url()).pathname === path && item.request().method() === "POST" && item.status() === 200);
    await review.getByRole("button", { name: "Save Changes", exact: true }).click();
    await response;
    await expect(review).toHaveCount(0);
    assert.equal(attempts.length, 2);
    assert.equal(attempts.every(attempt => attempt.emptyValue && attempt.tagRetained && attempt.environment === "dev"), true);
    const persisted = await readMetadata(secretKey, "dev", tag.id);
    assert.deepEqual(persisted, { status: 200, valueHidden: true, tagPresent: true });
    record("Batch staging trims the key without a request; failed commit retains changes/message; retry persists empty value plus tag with metadata-only verification");
  } finally {
    await page.unroute(match, handler);
    expectedFailures.delete(path);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    writeFileSync(resolve(evidence, "dashboard-create-attempts.json"), JSON.stringify(attempts, null, 2));
  }
}
