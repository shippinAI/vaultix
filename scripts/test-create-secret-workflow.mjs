// Runs only inside test-image-app's disposable, freshly bootstrapped application.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

export async function testCreateSecretWorkflow({ page, expect, AxeBuilder, evidence }) {
  const checks = [];
  const accessibility = [];
  const dialog = page.getByRole("dialog", { name: "Create Secret", exact: true });
  const key = dialog.getByLabel("Key", { exact: true });
  const value = dialog.getByLabel("Value", { exact: true });
  const record = name => {
    checks.push(name);
    writeFileSync(resolve(evidence, "create-secret-workflow.json"), JSON.stringify({
      scope: "Actual packaged Overview form with public dummy input; no operator data or API mocks",
      completedChecks: checks
    }, null, 2));
  };
  const audit = async state => {
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity)
        .map(a => a.finished.catch(() => {})));
    });
    const report = await new AxeBuilder({ page }).include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const summarize = rules => rules.map(rule => ({ id: rule.id, impact: rule.impact,
      nodes: rule.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }));
    accessibility.push({ state, engine: report.testEngine, violations: summarize(report.violations), manualReview: summarize(report.incomplete) });
    writeFileSync(resolve(evidence, "create-secret-accessibility.json"), JSON.stringify(accessibility, null, 2));
    assert.equal(report.violations.length, 0, `Create-secret accessibility: ${state}`);
  };
  const focusValue = async () => {
    await value.focus();
    // The editor masks the DOM value while blurred. Always settle its focused state first.
    await expect(value).toBeFocused();
    await expect.poll(() => value.evaluate(el => el.value === "*************************")).toBe(false);
  };
  const clearValue = async () => {
    await focusValue();
    await value.press("ControlOrMeta+a");
    await value.press("Backspace");
    await expect(value).toHaveValue("");
  };
  const pasteKey = async text => {
    await key.evaluate((element, content) => {
      element.focus(); element.select();
      const data = new DataTransfer(); data.setData("text/plain", content);
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, text);
  };
  await page.getByRole("button", { name: "Add a New Secret", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(key).toBeVisible();
  await expect(dialog.getByLabel("Environments", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Create Secret", exact: true }).press("Enter");
  await expect(dialog.getByText("Key is required", { exact: true })).toBeVisible();
  await expect(key).toBeFocused();
  await expect(key).toHaveAttribute("aria-invalid", "true");
  const errorId = await key.getAttribute("aria-describedby");
  assert.equal(await page.locator(`[id="${errorId}"]`).innerText(), "Key is required");
  await key.fill("   ");
  await dialog.getByRole("button", { name: "Create Secret", exact: true }).focus();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(key).toBeFocused();
  await expect(dialog.getByText("Key is required", { exact: true })).toBeVisible();
  record("Visible labels, required/whitespace validation and keyboard error focus");

  const environments = dialog.getByLabel("Environments", { exact: true });
  await key.fill("PUBLIC_VALIDATION_KEY");
  await environments.focus();
  await environments.press("Backspace");
  await dialog.getByRole("button", { name: "Create Secret", exact: true }).press("Enter");
  await expect(dialog.getByText("Select at least one environment", { exact: true })).toBeVisible();
  await expect(environments).toBeFocused();
  await environments.fill("Development");
  await page.getByRole("option", { name: "Development", exact: true }).click();
  await key.focus();
  record("Missing environment validation focuses its selector; a permitted environment can be restored");

  await focusValue();
  await value.fill("public-fixture-value");
  await pasteKey("PLAIN_KEY");
  await focusValue();
  assert.equal(await value.inputValue() === "public-fixture-value", true, "A key-only paste preserves the value");
  for (const assignment of ["VAULTIX_EMPTY=", "VAULTIX_EMPTY:"]) {
    await value.fill("public-fixture-value");
    await pasteKey(assignment);
    await expect(key).toHaveValue("VAULTIX_EMPTY");
    await focusValue();
    await expect(value).toHaveValue("");
  }
  record("Key-only paste preserves the value; equals and colon assignments explicitly clear it");

  await dialog.getByRole("button", { name: "Secret reference help", exact: true }).focus();
  await expect(page.getByRole("tooltip")).toContainText("references to other secrets");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await focusValue();
  await value.fill("${");
  const references = page.getByRole("dialog", { name: "Secret references", exact: true });
  await expect(references).toBeVisible();
  await value.press("ArrowDown");
  await value.press("Enter");
  await expect(references.getByText("No secrets found", { exact: true })).toBeVisible();
  await value.press("Escape");
  await expect(references).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await clearValue();
  record("Keyboard reference help, environment browsing and Escape preserve the create sheet");

  await dialog.getByRole("button", { name: "Generate secret value", exact: true }).click();
  await expect(page.getByText("Generate Random Value", { exact: true })).toBeVisible();
  const generator = page.locator('[data-slot="popover-content"]').filter({ hasText: "Generate Random Value" });
  await expect.poll(() => generator.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity)
      .map(a => a.finished.catch(() => {})));
  });
  await page.keyboard.press("Escape");
  writeFileSync(resolve(evidence, "create-secret-generator-dismissal.json"), JSON.stringify({
    stateAfterEscape: await generator.getAttribute("data-state").catch(() => "unmounted"),
    focusTag: await page.evaluate(() => document.activeElement?.tagName)
  }, null, 2));
  await expect(dialog).toBeVisible();
  await expect(page.getByText("Generate Random Value", { exact: true })).toHaveCount(0);
  record("Named generator opens and dismisses without submitting");

  await key.fill("");
  await dialog.getByRole("button", { name: "Advanced Options", exact: true }).click();
  await expect(dialog.getByLabel("Comment", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Tags", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Enable Multiline Encoding", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Create More", { exact: true })).toBeVisible();
  for (let index = 1; index <= 2; index++) {
    await dialog.getByRole("button", { name: "Add Entry", exact: true }).click();
    await expect(dialog.getByLabel(`Metadata ${index} Key`, { exact: true })).toBeVisible();
    await expect(dialog.getByLabel(`Metadata ${index} Value`, { exact: true })).toBeVisible();
    await expect(dialog.getByLabel(`Metadata ${index} Encrypt`, { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: `Remove metadata entry ${index}`, exact: true })).toBeVisible();
  }
  await audit("advanced-desktop");
  await page.screenshot({ path: resolve(evidence, "create-secret-desktop.png"), fullPage: true });
  record("Advanced fields and repeated metadata controls have distinct labels and no selected axe violations");
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await dialog.getByLabel("Metadata 2 Value", { exact: true }).scrollIntoViewIfNeeded();
  assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true,
    "The create-secret sheet must not scroll horizontally at 320 CSS pixels");
  assert.equal((await dialog.getByLabel("Metadata 2 Value", { exact: true }).boundingBox()).width >= 100, true,
    "Metadata inputs need usable width on the narrow sheet");
  await audit("advanced-320-reduced-motion");
  await page.screenshot({ path: resolve(evidence, "create-secret-320.png"), fullPage: true });
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  record("320 CSS-pixel sheet reflow and selected reduced-motion accessibility scan");
  await dialog.getByRole("button", { name: "Remove metadata entry 1", exact: true }).click();
  await expect(dialog.getByLabel("Metadata 2 Key", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("Metadata 1 Key", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  record("Metadata removal preserves unique labels; Cancel closes without creation");
}
