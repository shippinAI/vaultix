// Runs only inside the disposable real-image acceptance harness. Credentials remain in memory.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

export async function testFirstRunSetup({ browser, expect, AxeBuilder, origin, email, password, evidence }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  let signupRequests = 0;
  let completionFailures = 0;
  const accessibility = [];
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  const audit = async state => {
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations()
        .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {})));
    });
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    accessibility.push({ state, violations: result.violations.map(rule => ({ id: rule.id, nodes: rule.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) })), manualReview: result.incomplete.map(rule => rule.id) });
    writeFileSync(resolve(evidence, "onboarding-accessibility.json"), JSON.stringify(accessibility, null, 2));
    assert.equal(result.violations.length, 0, `Accessibility failure in ${state}`);
  };
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/v1/admin/signup" && request.method() === "POST") signupRequests++;
  });
  try {
    await page.goto(origin);
    await expect(page.getByRole("heading", { name: "Name Your Organization", exact: true })).toBeVisible();
    const name = page.getByRole("textbox", { name: "Organization Name", exact: true });
    assert.ok((await name.inputValue()).length > 0, "Provide an editable name suggestion");
    await audit("organization-desktop");
    await page.screenshot({ path: resolve(evidence, "onboarding-organization.png"), fullPage: true });
    await page.getByRole("button", { name: "Help: Use a Name You Recognize" }).click();
    const guide = page.getByRole("dialog", { name: "Name Your Organization" });
    await expect(guide).toBeVisible();
    await audit("organization-help-dialog");
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      assert.equal(await guide.evaluate(element => element.contains(document.activeElement)), true);
    }
    await guide.getByRole("button", { name: "Show This Control" }).click();
    await expect(name).toBeFocused();
    assert.equal(signupRequests, 0, "Help must not submit setup");
    await name.fill("  ");
    await page.getByRole("button", { name: "Continue to Owner Account" }).click();
    await expect(page.getByText("Enter a name for your business, team, brand, or organization.", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 320, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await audit("organization-mobile-error");
    await name.fill("Vaultix Image Proof");
    await page.getByRole("button", { name: "Continue to Owner Account" }).click();
    await expect(page.getByRole("heading", { name: "Create Your Owner Account", exact: true })).toBeVisible();
    assert.equal(await page.getByRole("radio").count(), 0, "No public signup choices during owner creation");
    for (const provider of ["Google", "GitHub", "GitLab", "OIDC", "SAML"]) {
      assert.equal(await page.getByRole("button", { name: new RegExp(provider, "i") }).count(), 0);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await audit("owner-mobile");
    await page.getByRole("button", { name: "Back to Organization" }).click();
    await expect(name).toHaveValue("Vaultix Image Proof");
    await page.getByRole("button", { name: "Continue to Owner Account" }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "Guide Me", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Create Your Owner Account" })).toBeVisible();
    await audit("owner-help-dialog");
    await page.keyboard.press("Escape");
    await page.screenshot({ path: resolve(evidence, "onboarding-owner.png"), fullPage: true });
    await page.getByLabel("First Name", { exact: true }).fill("Image");
    await page.getByLabel("Last Name", { exact: true }).fill("Proof");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await expect.poll(() => page.getByLabel("Confirm Password", { exact: true }).evaluate(element => element.closest("[inert]") === null)).toBe(true);
    await page.getByLabel("Confirm Password", { exact: true }).fill(password);
    assert.equal(await page.getByLabel("Password", { exact: true }).evaluate(element => element.value.length), password.length);
    // Account and organization creation are real. Only completion transport fails twice.
    await page.route("**/api/v1/admin/config", async route => {
      if (route.request().method() === "PATCH" && completionFailures < 2) {
        completionFailures++;
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Completion unavailable", message: "Test transport interruption" }) });
      } else await route.continue();
    });
    const signupResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/admin/signup" && response.request().method() === "POST").catch(() => null);
    const selectedResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v3/auth/select-organization" && response.status() === 200).catch(() => null);
    await page.getByRole("button", { name: "Create Workspace", exact: true }).click();
    const signup = await signupResponse;
    assert.ok(signup, "Owner form did not produce a signup response");
    assert.equal(signup.status(), 200);
    const bootstrap = await signup.json();
    const selection = await selectedResponse;
    assert.ok(selection, "Created owner did not select the organization");
    const selected = await selection.json();
    await expect(page.getByRole("alert").filter({ hasText: "Your account and organization were created" })).toBeVisible();
    assert.equal(await page.locator('input[type="password"]').count(), 0, "Clear credential controls after creation");
    await page.getByRole("button", { name: "Open Workspace", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Your account is ready" })).toBeVisible();
    assert.equal(signupRequests, 1, "Completion retries must not resubmit owner creation");
    await page.goto(origin);
    await expect(page.getByRole("heading", { name: "Your Workspace Is Ready", exact: true })).toBeVisible();
    await expect(page.getByText("Invite-only", { exact: true })).toBeVisible();
    await audit("setup-recovery");
    await page.getByRole("button", { name: "Open Workspace", exact: true }).click();
    await page.waitForURL(`${origin}/organizations/${bootstrap.organization.id}/projects`, { timeout: 30000 });
    await expect(page.getByRole("heading", { name: "Organization Overview", exact: true })).toBeVisible();
    const response = await fetch(`${origin}/api/v1/admin/config`, { headers: { Authorization: `Bearer ${selected.token}` } });
    assert.equal(response.status, 200);
    const { config } = await response.json();
    assert.equal(config.initialized, true);
    assert.equal(config.onboardingCompleted, true);
    assert.equal(config.allowSignUp, false);
    assert.deepEqual(config.enabledLoginMethods, ["email"]);
    const repeat = await fetch(`${origin}/api/v1/admin/signup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, firstName: "Duplicate", organizationName: "Must Not Exist" }) });
    assert.equal(repeat.status, 400, "Bootstrap closes after initialization");
    writeFileSync(resolve(evidence, "onboarding-result.json"), JSON.stringify({ passed: true, signupRequests, completionFailures, actualAccountAndOrganization: true, checks: ["organization first with editable suggestion", "name validation", "contextual dialog and focus return", "320px reflow", "owner custom password", "no public signup or federation choices", "completion retries do not recreate owner", "refresh recovers existing setup", "invite-only and email defaults", "completed dashboard", "repeat bootstrap denied"], fixtures: ["two completion PATCH transport failures"], excluded: ["concurrent bootstrap transactions", "manual screen-reader acceptance", "external identity providers"] }, null, 2));
    return { bootstrap, selected };
  } catch (error) {
    await page.screenshot({ path: resolve(evidence, "onboarding-failure.png"), fullPage: true }).catch(() => {});
    writeFileSync(resolve(evidence, "onboarding-failure.json"), JSON.stringify({
      signupRequests, completionFailures, path: new URL(page.url()).pathname,
      fieldErrors: await page.locator('[data-slot="field-error"]').allTextContents()
    }, null, 2));
    throw error;
  } finally {
    await context.close();
  }
}
