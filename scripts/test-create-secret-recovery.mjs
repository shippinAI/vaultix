// Actual creates plus a separately labelled per-environment outage. No operator instance.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

export async function testCreateSecretRecovery({ page, expect, origin, evidence, expectedFailures, readMetadata }) {
  const secretKey = "VAULTIX_CREATION_RECOVERY";
  const path = `/api/v4/secrets/${secretKey}`;
  const match = url => url.origin === origin && url.pathname === path;
  const attempts = [];
  const responses = [];
  let failProduction = true;
  const handler = async route => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON();
    // Persist only outcome booleans and environment identifiers, never input or response values.
    attempts.push({ environment: body.environment, emptyValue: body.secretValue === "",
      emptyMetadataRetained: body.secretMetadata?.some(item => item.key === "PUBLIC_EMPTY_METADATA" && item.value === "" && item.isEncrypted === true) === true });
    if (failProduction && body.environment === "prod") {
      return route.fulfill({ status: 503, json: { error: "Unavailable", message: "Disposable creation outage fixture." } });
    }
    return route.continue();
  };
  const responseListener = async response => {
    if (new URL(response.url()).pathname !== path || response.request().method() !== "POST") return;
    const body = await response.json();
    responses.push({ environment: response.request().postDataJSON().environment,
      status: response.status(), persisted: response.status() === 200 && Boolean(body.secret?.id) });
  };
  expectedFailures.add(path);
  await page.route(match, handler);
  page.on("response", responseListener);
  try {
    await page.getByRole("button", { name: "Add a New Secret", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Create Secret", exact: true });
    const key = dialog.getByLabel("Key", { exact: true });
    const environments = dialog.getByLabel("Environments", { exact: true });
    for (const name of ["Staging", "Production"]) {
      await environments.fill(name);
      await page.getByRole("option", { name, exact: true }).click();
    }
    const menuExpanded = await environments.getAttribute("aria-expanded");
    writeFileSync(resolve(evidence, "create-secret-environment-menu.json"), JSON.stringify({ menuExpanded }, null, 2));
    if (menuExpanded === "true") {
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveAttribute("data-state", "open");
    }
    await key.fill(secretKey);
    await dialog.getByRole("button", { name: "Advanced Options", exact: true }).click();
    await dialog.getByLabel("Comment", { exact: true }).fill("Public disposable recovery proof");
    await dialog.getByRole("button", { name: "Add Entry", exact: true }).click();
    await dialog.getByLabel("Metadata 1 Key", { exact: true }).fill("PUBLIC_EMPTY_METADATA");
    await dialog.getByLabel("Metadata 1 Encrypt", { exact: true }).click();
    await dialog.getByRole("button", { name: "Create Secret", exact: true }).click();
    await expect(dialog.getByText("Creation needs attention", { exact: true })).toBeVisible({ timeout: 15000 });
    await expect.poll(() => responses.length).toBe(3);
    assert.deepEqual(attempts.map(item => item.environment).sort(), ["dev", "prod", "staging"]);
    assert.equal(attempts.every(item => item.emptyValue && item.emptyMetadataRetained), true);
    assert.equal(responses.filter(item => item.persisted).length, 2);
    assert.equal(responses.filter(item => item.status === 503).length, 1);
    await expect(key).toHaveValue(secretKey);
    assert.equal(await dialog.getByLabel("Comment", { exact: true }).inputValue() === "Public disposable recovery proof", true);
    await expect(dialog.getByLabel("Metadata 1 Key", { exact: true })).toHaveValue("PUBLIC_EMPTY_METADATA");
    await expect(dialog.getByLabel("Metadata 1 Encrypt", { exact: true })).toHaveAttribute("aria-checked", "true");
    // The first-secret nudge has an existing 1500ms delay. Let that timer elapse while
    // the user is still recovering: it must not cover an unfinished create operation.
    await page.waitForTimeout(1800);
    await expect(page.getByRole("dialog", { name: "Invite your team", exact: true })).toHaveCount(0);
    failProduction = false;
    await dialog.getByRole("button", { name: "Create Secret", exact: true }).click();
    await expect.poll(() => responses.length).toBe(4);
    await expect(dialog).toHaveCount(0);
    assert.deepEqual(attempts.slice(3).map(item => item.environment), ["prod"]);
    assert.equal(responses[3].persisted, true);
    const metadataChecks = [];
    for (const environment of ["dev", "staging", "prod"]) {
      const check = await readMetadata(secretKey, environment);
      metadataChecks.push({ environment, ...check });
      assert.equal(check.status, 200);
      assert.equal(check.valueHidden, true);
      assert.equal(check.encryptedMetadataPresent, true);
    }
    const invite = page.getByRole("dialog", { name: "Invite your team", exact: true });
    await expect(invite).toBeVisible();
    await invite.getByRole("button", { name: "Maybe later", exact: true }).click();
    await expect(invite).toHaveCount(0);
    const createdRow = page.getByRole("row", { name: secretKey, exact: true });
    await expect(createdRow).toBeVisible();
    await expect(createdRow.getByRole("textbox", { name: "Secret name", exact: true })).toHaveValue(secretKey);
    writeFileSync(resolve(evidence, "create-secret-recovery.json"), JSON.stringify({
      passed: true,
      scope: "Three real empty-value creates in a disposable image; first production attempt is an injected 503",
      attempts, responses, metadataChecks, retainedInputs: true, retryOnlyUnfinished: true,
      nudgeDeferredUntilCompletion: true, invitationDismissedWithoutSending: true, renderedResource: true
    }, null, 2));
  } finally {
    writeFileSync(resolve(evidence, "create-secret-recovery-attempts.json"), JSON.stringify({ attempts, responses }, null, 2));
    await page.unroute(match, handler);
    page.off("response", responseListener);
    expectedFailures.delete(path);
  }
}
