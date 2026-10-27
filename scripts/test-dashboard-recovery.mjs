// Deliberate response faults after real image sign-in. These checks prove UI recovery,
// not backend authorization or provider behavior. Keep evidence separate from real API checks.
import assert from "node:assert/strict";
import { resolve } from "node:path";

export async function testDashboardRecovery({ page, expect, origin, orgId, evidence, expectedFailures, audit }) {
  const dashboard = `${origin}/organizations/${orgId}/projects`;
  const failures = [
    ["/api/v1/projects", "Could Not Load Your Projects", "Retry Projects"],
    ["/api/v1/cert-manager/instance", "Could Not Load Certificate Manager", "Retry Certificate Manager"],
    ["/api/v1/organization/product-stats", "Product Counts Are Unavailable", "Retry Counts"]
  ];
  const checks = [];
  for (const [path, title, retry] of failures) {
    const match = url => url.origin === origin && url.pathname === path;
    expectedFailures.add(path);
    await page.route(match, route => route.fulfill({ status: 503, json: { error: "Simulated dependency outage." } }));
    try {
      await page.goto(dashboard);
      await expect(page.getByText(title, { exact: true })).toBeVisible({ timeout: 15000 });
      if (path.includes("cert-manager")) {
        const tile = page.getByRole("button", { name: "Certificate Manager", exact: true });
        await expect(tile).toHaveAttribute("aria-disabled", "true");
        await tile.press("Space");
        assert.equal(await page.getByRole("dialog").count(), 0, "An outage must not open instance setup.");
      }
      await page.screenshot({ path: resolve(evidence, `fixture-${retry.toLowerCase().replaceAll(" ", "-")}.png`), fullPage: true });
    } finally {
      await page.unroute(match);
    }
    const recoveredResponse = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === "GET");
    await page.getByRole("button", { name: retry, exact: true }).click();
    assert.equal((await recoveredResponse).status(), 200, "Retry must obtain a real successful response.");
    await expect(page.getByText(title, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Secrets Management", exact: true })).toBeVisible();
    expectedFailures.delete(path);
    checks.push(`${path}: outage distinguished from empty, retry restores real response`);
  }

  const instanceMatch = url => url.origin === origin && url.pathname === "/api/v1/cert-manager/instance";
  const permissionsMatch = url => url.origin === origin && url.pathname === "/api/v1/organization/permissions";
  await page.route(instanceMatch, route => route.fulfill({ json: { activeProjectId: null, projects: [], isMultiInstance: false } }));
  try {
    await page.goto(dashboard);
    const tile = page.getByRole("button", { name: "Certificate Manager", exact: true });
    await expect(tile).toHaveAttribute("aria-disabled", "false");
    await tile.press("Space");
    const setup = page.getByRole("dialog", { name: "Select an active Certificate Manager project" });
    await expect(setup).toBeVisible();
    await audit("fixture-certificate-setup-dialog");
    await setup.press("Escape");
    await expect(setup).toHaveCount(0);
    checks.push("empty certificate configuration opens setup without losing the existing settings path");
  } finally {
    await page.unroute(instanceMatch);
  }
  const instances = [
    { id: "00000000-0000-4000-8000-000000000001", name: "Certificate One", slug: "certificate-one" },
    { id: "00000000-0000-4000-8000-000000000002", name: "Certificate Two", slug: "certificate-two" }
  ];
  await page.route(instanceMatch, route => route.fulfill({ json: { activeProjectId: "00000000-0000-4000-8000-000000000003", projects: instances, isMultiInstance: true } }));
  try {
    await page.goto(dashboard);
    await page.getByRole("button", { name: "Certificate Manager", exact: true }).press("Space");
    const picker = page.getByRole("dialog", { name: "Select a Certificate Manager project" });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("combobox", { name: "Certificate Manager project" })).toBeVisible();
    await expect(picker.getByRole("button", { name: "Open", exact: true })).toBeDisabled();
    await picker.getByRole("combobox").click();
    await page.getByRole("option", { name: "certificate-two", exact: true }).click();
    await expect(picker.getByRole("button", { name: "Open", exact: true })).toBeEnabled();
    // Do not submit fixture project IDs to a real service.
    await picker.getByRole("button", { name: "Cancel", exact: true }).click();
    checks.push("multiple certificate instances: labelled picker, stale default rejected, explicit valid selection retained");

    await page.route(permissionsMatch, route => route.fulfill({ json: { permissions: [], memberships: [] } }));
    try {
      await page.goto(dashboard);
      const tile = page.getByRole("button", { name: "Certificate Manager", exact: true });
      await expect(tile).toHaveAttribute("aria-disabled", "true");
      await tile.focus();
      await expect(tile).toBeFocused();
      await expect(page.getByText("You do not have access. Ask an organization admin for access.", { exact: true }).first()).toBeVisible();
      await tile.press("Enter");
      await tile.press("Space");
      assert.equal(await page.getByRole("dialog").count(), 0);
      checks.push("denied certificate card: keyboard-readable explanation and no access action");
    } finally {
      await page.unroute(permissionsMatch);
    }
  } finally {
    await page.unroute(instanceMatch);
  }
  await page.goto(dashboard);
  return { fixtures: true, checks };
}
