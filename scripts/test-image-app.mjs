// Real browser sign-in against a disposable smoke-test image, never the operator's instance.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const origin = process.argv[2];
assert.equal(process.env.VAULTIX_IMAGE_APP_PROOF, "1", "Only run with a disposable smoke instance.");
assert.match(origin ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const require = createRequire(resolve(root, "core/e2e/package.json"));
const { chromium, expect } = require("@playwright/test");
const config = await (await fetch(`${origin}/api/v1/admin/config`)).json();
assert.equal(config.config.initialized, false, "Refusing to change an initialized instance.");
const password = `Vx9!${randomBytes(24).toString("hex")}`;
const email = `image-proof-${randomBytes(6).toString("hex")}@vaultix.invalid`;
const signup = await fetch(`${origin}/api/v1/admin/signup`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, firstName: "Image", lastName: "Proof", organizationName: "Vaultix Image Proof" })
});
assert.equal(signup.status, 200, "Disposable instance bootstrap failed.");
const bootstrap = await signup.json();
const selection = await fetch(`${origin}/api/v3/auth/select-organization`, {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${bootstrap.token}` },
  body: JSON.stringify({ organizationId: bootstrap.organization.id })
});
assert.equal(selection.status, 200, "Disposable organization selection failed.");
const selected = await selection.json();
const setup = await fetch(`${origin}/api/v1/admin/config`, {
  method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${selected.token}` },
  body: JSON.stringify({ onboardingCompleted: true, enabledLoginMethods: ["email"] })
});
assert.equal(setup.status, 200, "Disposable instance setup failed.");
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache/app-image-proof-"));
const browser = await chromium.launch({ headless: true, ...(process.env.VAULTIX_BROWSER_CHANNEL ? { channel: process.env.VAULTIX_BROWSER_CHANNEL } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // External integrations are outside this local acceptance test. No API/auth responses are mocked.
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith("/api/") && response.status() >= 400 && path !== "/api/v1/auth/token") {
      errors.push(`HTTP ${response.status()} ${path}`);
    }
  });
  await page.goto(origin);
  await expect(page.getByRole("heading", { name: "Welcome back", exact: true })).toBeVisible();
  assert.equal(new URL(page.url()).pathname, "/login");
  await page.screenshot({ path: resolve(evidence, "login.png"), fullPage: true });
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Continue with Email" }).click();
  await page.waitForURL(`${origin}/organizations/${bootstrap.organization.id}/projects`, { timeout: 30000 });
  await expect(page.getByRole("heading", { name: "Organization Overview", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Vaultix home", exact: true })).toBeVisible();
  assert.equal(await page.getByText("Free Pro Trial", { exact: true }).count(), 0);
  for (const product of ["Secrets Management", "Certificate Manager", "KMS", "Secret Scanning", "Privileged Access Manager"]) {
    await expect(page.getByText(product, { exact: true })).toBeVisible({ timeout: 15000 });
  }
  await page.screenshot({ path: resolve(evidence, "authenticated-projects.png"), fullPage: true });
  await page.getByText("Secrets Management", { exact: true }).click();
  await page.waitForURL(`${origin}/organizations/${bootstrap.organization.id}/projects/secret-management`);
  await expect(page.getByRole("heading", { name: "Secrets Management", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Project", exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(evidence, "secrets-projects.png"), fullPage: true });
  await page.goto(origin);
  await page.waitForURL(`${origin}/organizations/${bootstrap.organization.id}/projects`);
  await expect(page.getByRole("heading", { name: "Organization Overview", exact: true })).toBeVisible();
  const anonymous = await browser.newContext();
  const denied = await anonymous.newPage();
  await denied.goto(`${origin}/organizations/${bootstrap.organization.id}/projects`);
  await denied.waitForURL(`${origin}/login`);
  await expect(denied.getByRole("heading", { name: "Welcome back", exact: true })).toBeVisible();
  assert.deepEqual(errors, []);
  writeFileSync(resolve(evidence, "result.json"), JSON.stringify({
    passed: true, fixtures: false, checks: ["root opens login", "real email sign-in", "five loaded product categories", "secrets project navigation", "Vaultix application branding", "authenticated root resumes app", "anonymous project access redirects to login", "no unexpected application API failures"]
  }, null, 2));
  console.log(`Real image application checks passed. Evidence: ${evidence}`);
} finally {
  await browser.close();
}
