import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Packaged secrets overview: the provider cards load the server's provider runtime, explain
// themselves through keyboard-reachable tooltips, refuse review without a connection and pass axe.
export async function testProviderImportUi({ page, expect, AxeBuilder, evidence }) {
  const checks = [];
  const record = name => {
    checks.push(name);
    writeFileSync(resolve(evidence, "provider-import-ui.json"), JSON.stringify({
      scope: "Packaged secrets overview provider cards against the real provider runtime of a fresh instance (no connections)",
      completedChecks: checks
    }, null, 2));
  };

  const runtimeResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/v3/external-migration/providers" && response.request().method() === "GET");
  await page.getByRole("button", { name: "More ways to add", exact: true }).click();
  await page.getByRole("menuitem", { name: /Browse import providers/ }).click();
  const runtime = await runtimeResponse;
  assert.equal(runtime.status(), 200, "Provider runtime must load");
  const { providers } = await runtime.json();
  assert.deepEqual(providers.map(provider => [provider.provider, provider.connections.length]),
    [["doppler", 0], ["external-vaultix", 0]], "A fresh instance has both providers and no connections");

  const dialog = page.getByRole("dialog", { name: "Import from another provider" });
  await expect(dialog).toBeVisible();
  for (const name of ["Doppler", "Infisical"]) {
    await expect(dialog.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: `${name} status: Not connected`, exact: true })).toBeVisible();
  }
  const reviews = dialog.getByRole("button", { name: "Review import", exact: true });
  await expect(reviews).toHaveCount(2);
  for (const button of await reviews.all()) await expect(button).toBeDisabled();
  await expect(dialog.getByText("0 of 2", { exact: true })).toBeVisible();
  record("Cards render the server runtime: both providers, not connected, review disabled");

  await dialog.getByRole("button", { name: "Name-only review", exact: true }).first().focus();
  await expect(page.getByRole("tooltip")).toContainText("Values never reach your browser");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /^Step 1\s*Review$/ }).first().focus();
  await expect(page.getByRole("tooltip")).toContainText("names");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  record("Capability and lifecycle tooltips open from the keyboard and Escape keeps the dialog");

  const values = await dialog.locator('[data-vaultix-action]').evaluateAll(nodes =>
    nodes.map(node => node.getAttribute("data-vaultix-action")));
  assert.ok(values.includes("vaultix.ui.connect.doppler.import.review") && values.includes("vaultix.ui.connect.external-vaultix.import.connect"),
    "Card actions carry scripted action ids");
  record("Card actions carry scripted action ids");

  const report = await new AxeBuilder({ page }).include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  writeFileSync(resolve(evidence, "provider-import-accessibility.json"), JSON.stringify(report.violations.map(rule => ({
    id: rule.id, impact: rule.impact, nodes: rule.nodes.map(node => node.target) })), null, 2));
  assert.equal(report.violations.length, 0, "Provider cards accessibility");
  await page.screenshot({ path: resolve(evidence, "provider-import-cards.png"), fullPage: true });
  record("No automated WCAG 2.2 AA violations in the dialog");

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  record("Escape closes the provider dialog");
}
