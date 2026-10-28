// Uses only public reference names in test-image-app's disposable project.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

export async function testDashboardSecretReferences({ page, expect, evidence }) {
  const checks = [];
  let createRequests = 0;
  const countCreate = request => {
    if (request.method() === "POST" && new URL(request.url()).pathname.startsWith("/api/v4/secrets/")) createRequests++;
  };
  page.on("request", countCreate);
  const record = name => {
    checks.push(name);
    writeFileSync(resolve(evidence, "dashboard-secret-references.json"), JSON.stringify({
      scope: "Packaged environment dashboard editor; public fixture references, no secret submission",
      completedChecks: checks
    }, null, 2));
  };
  await page.getByRole("button", { name: "Add Secret", exact: true }).and(page.locator("button")).click();
  const dialog = page.getByRole("dialog", {
    name: "Create Secret Add a secret to this particular environment and folder", exact: true
  });
  const value = dialog.locator("textarea");
  const references = page.getByRole("dialog", { name: "Secret references", exact: true });
  await value.focus();
  await expect(value).toBeFocused();
  await value.fill("${dev.VAULTIX_CRE");
  await expect(page.getByText("VAULTIX_CREATION_RECOVERY", { exact: true })).toBeVisible();
  const baseline = { textareaExpanded: await value.getAttribute("aria-expanded"),
    namedReferencePopup: await references.count() === 1 };
  writeFileSync(resolve(evidence, "dashboard-reference-semantics.json"), JSON.stringify(baseline, null, 2));
  assert.equal(baseline.textareaExpanded, null, "A multiline textbox must not inherit button expansion semantics");
  await expect(references).toBeVisible();
  await expect(references.getByRole("button", { name: "VAULTIX_CREATION_RECOVERY Secret", exact: true })).toBeVisible();
  await value.press("ArrowDown");
  await value.press("Enter");
  await expect(value).toHaveValue("${dev.VAULTIX_CREATION_RECOVERY}");
  record("Named reference popup and suggestion; arrow/Enter insertion closes the reference");

  const prefix = "public-prefix ${dev.VAULTIX_CR";
  await value.fill(`${prefix}} public-suffix`);
  await value.evaluate((element, cursor) => element.setSelectionRange(cursor, cursor), prefix.length);
  await page.keyboard.insertText("E");
  await expect(references).toBeVisible();
  await expect(references).toHaveAttribute("aria-busy", "false");
  await expect(references.getByRole("button", { name: "VAULTIX_CREATION_RECOVERY Secret", exact: true })).toBeEnabled();
  await references.getByRole("button", { name: "VAULTIX_CREATION_RECOVERY Secret", exact: true }).click();
  await expect(value).toHaveValue("public-prefix ${dev.VAULTIX_CREATION_RECOVERY} public-suffix");
  record("Pointer insertion preserves an existing closing brace and surrounding text");

  await value.fill("${dev.PUBLIC_NO_MATCH");
  await expect(references.getByRole("status")).toContainText("No matches found");
  await value.press("Tab");
  await expect(value).not.toBeFocused();
  await expect(references).toHaveCount(0);
  await expect(dialog).toHaveAttribute("data-state", "open");
  record("Tab exits an unmatched reference without trapping focus or closing the form");

  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await value.focus();
  await value.fill("${dev.VAULTIX_CRE");
  await expect(references).toBeVisible();
  await expect(references).toHaveAttribute("aria-busy", "false");
  await expect(references.getByRole("button", { name: "VAULTIX_CREATION_RECOVERY Secret", exact: true })).toBeEnabled();
  const box = await references.boundingBox();
  assert.ok(box && box.width >= 240 && box.x >= 0 && box.x + box.width <= 320,
    "Reference popup must fit the narrow viewport");
  await page.screenshot({ path: resolve(evidence, "dashboard-reference-mobile.png"), fullPage: true });
  await value.press("Shift+Tab");
  await expect(value).not.toBeFocused();
  await expect(references).toHaveCount(0);
  record("Narrow reduced-motion popup fits; Shift+Tab exits populated suggestions");
  await value.focus();
  await value.fill("${dev.VAULTIX_CRE");
  await expect(references).toBeVisible();
  await expect(references).toHaveAttribute("aria-busy", "false");
  await expect(references.getByRole("button", { name: "VAULTIX_CREATION_RECOVERY Secret", exact: true })).toBeEnabled();
  await value.press("Escape");
  await expect(references).toHaveCount(0);
  await expect(dialog).toHaveAttribute("data-state", "open");
  await expect(value).toBeFocused();
  record("Escape dismisses the inner reference popup and retains the editor");
  await value.fill("");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  page.off("request", countCreate);
  assert.equal(createRequests, 0, "Reference navigation and cancellation must not submit a secret");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  record("Cancellation retains the existing dashboard workflow");
}
