// Compatibility proof for the separate environment dashboard form.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

export async function testDashboardSecretPaste({ page, expect, origin, orgId, projectId, evidence }) {
  let createRequests = 0;
  const countCreate = request => {
    if (request.method() === "POST" && new URL(request.url()).pathname.startsWith("/api/v4/secrets/")) createRequests++;
  };
  page.on("request", countCreate);
  await page.goto(`${origin}/organizations/${orgId}/projects/secret-management/${projectId}/secrets/dev`);
  await page.getByRole("button", { name: "Add Secret", exact: true }).and(page.locator("button")).click();
  const dialog = page.getByRole("dialog", {
    name: "Create Secret Add a secret to this particular environment and folder", exact: true
  });
  // The existing v2 modal positions its inner card; the role container has no box.
  // Verify the open state and visible working control, not that outer container's dimensions.
  await expect(dialog).toHaveAttribute("data-state", "open");
  const key = dialog.getByPlaceholder("Type your secret name", { exact: true });
  await expect(key).toBeVisible();
  const value = dialog.locator("textarea");
  const paste = async text => key.evaluate((element, content) => {
    element.focus(); element.select();
    const data = new DataTransfer(); data.setData("text/plain", content);
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
  await value.fill("public-dashboard-fixture");
  await paste("VAULTIX_DASHBOARD_KEY");
  await value.focus();
  await expect.poll(async () => await value.inputValue() === "public-dashboard-fixture").toBe(true);
  for (const delimiter of ["=", ":"]) {
    await value.fill("public-dashboard-fixture");
    await paste(`VAULTIX_DASHBOARD_EMPTY${delimiter}`);
    await expect(key).toHaveValue("VAULTIX_DASHBOARD_EMPTY");
    await value.focus();
    await expect(value).toHaveValue("");
  }
  await key.fill("");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  page.off("request", countCreate);
  assert.equal(createRequests, 0, "Dashboard paste and cancellation must not create a secret");
  assert.equal(await page.getByText("VAULTIX_DASHBOARD_EMPTY", { exact: true }).count(), 0);
  writeFileSync(resolve(evidence, "dashboard-secret-paste.json"), JSON.stringify({
    passed: true, scope: "Existing environment dashboard form; public dummy paste and cancellation only",
    plainKeyPreservesValue: true, explicitEqualsClearsValue: true, explicitColonClearsValue: true,
    noSecretSubmitted: true, broaderDashboardAccessibility: "Not covered by this parser compatibility check"
  }, null, 2));
}
