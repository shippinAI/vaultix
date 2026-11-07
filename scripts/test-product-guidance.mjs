import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

export async function testProductGuidance({ page, expect, audit, evidence }) {
  const location = page.url();
  const changes = [];
  const observe = request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/") && path !== "/api/v1/auth/token" && !["GET", "HEAD", "OPTIONS"].includes(request.method())) changes.push({ path, method: request.method() });
  };
  page.on("request", observe);
  try {
    for (const title of ["Secrets Management", "Certificate Manager", "KMS", "Secret Scanning", "Privileged Access Manager"]) {
      const help = page.getByRole("button", { name: `Show Me How: ${title}`, exact: true });
      await help.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: `${title}: Getting Started`, exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("listitem")).toHaveCount(3);
      if (title === "Secrets Management") {
        await audit("project-contextual-guidance");
        await page.screenshot({ path: resolve(evidence, "project-contextual-guidance.png") });
      }
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(help).toBeFocused();
      assert.equal(page.url(), location, "Guidance must retain the actual organization workspace");
    }
    assert.deepEqual(changes, [], "Opening guidance must not mutate the product");
    writeFileSync(resolve(evidence, "product-guidance.json"), JSON.stringify({ passed: true, fixtures: false, products: 5, keyboardFocusReturned: true, navigationRetained: true, apiMutations: 0 }, null, 2));
  } finally {
    page.off("request", observe);
  }
}
